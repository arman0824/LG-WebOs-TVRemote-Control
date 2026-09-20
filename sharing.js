const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function validateFixedConfig(input, previous = {}) {
  let url;
  try { url = new URL(String(input.url || "").trim()); }
  catch { throw new Error("Paste the HTTPS domain assigned in your ngrok dashboard."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash ||
      !/^[a-z0-9-]+\.(?:ngrok-free\.app|ngrok-free\.dev|ngrok\.app|ngrok\.dev|ngrok\.io)$/.test(url.hostname)) {
    throw new Error("Use your assigned ngrok HTTPS address without a path or query string.");
  }
  const authtoken = String(input.authtoken || previous.authtoken || "").trim();
  if (!/^[a-zA-Z0-9_-]{20,512}$/.test(authtoken)) throw new Error("Paste your ngrok authtoken from the ngrok dashboard.");
  return { provider: "ngrok", url: url.origin, authtoken };
}

// The public link shares the existing TV session, not the host's setup screens.
function createFamilyHandler({ handleApi, serveStatic, sendJson }) {
  return (req, res) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Referrer-Policy", "no-referrer");
    let pathname;
    try { pathname = new URL(req.url, "http://localhost").pathname; }
    catch { return sendJson(res, 400, { error: "Invalid request." }); }

    if (req.method === "GET" && pathname === "/api/mode") {
      return sendJson(res, 200, { shared: true });
    }
    if ((req.method === "GET" && pathname === "/api/status") ||
        (req.method === "POST" && pathname === "/api/command")) {
      return handleApi(req, res, pathname, true);
    }
    if (req.method === "GET" && ["/", "/index.html", "/app.js", "/styles.css"].includes(pathname)) {
      return serveStatic(req, res, pathname);
    }
    return sendJson(res, 404, { error: "This link controls the connected TV. Manage pairing on the laptop." });
  };
}

class RemoteSharing {
  constructor(handler, { spawnProcess = spawn, timeoutMs = 60000, configFile = null } = {}) {
    this.handler = handler;
    this.spawnProcess = spawnProcess;
    this.timeoutMs = timeoutMs;
    this.current = null;
    this.lastError = "";
    this.configFile = configFile;
    this.configuration = null;
    this.configLoadError = "";
    if (configFile && fs.existsSync(configFile)) {
      try { this.configuration = validateFixedConfig(JSON.parse(fs.readFileSync(configFile, "utf8"))); }
      catch { this.configLoadError = "The saved permanent-link settings could not be read. Save your ngrok domain and authtoken again."; }
    }
  }

  status() {
    const run = this.current;
    return {
      active: Boolean(run?.ready),
      starting: Boolean(run && !run.ready),
      url: run?.ready ? run.url : this.configuration?.url || "",
      error: this.lastError || this.configLoadError,
      ...(this.configuration ? { permanent: true } : {})
    };
  }

  start() {
    if (this.current) return this.current.promise;
    if (this.configLoadError) return Promise.reject(new Error(this.configLoadError));
    this.lastError = "";
    const run = { ready: false, url: this.configuration?.url || "", server: http.createServer(this.handler), child: null, configuration: this.configuration };
    this.current = run;
    run.promise = this.launch(run).catch(error => {
      if (this.current === run) {
        this.lastError = error.message;
        this.current = null;
      }
      this.cleanup(run);
      throw error;
    });
    return run.promise;
  }

  configure(input) {
    if (!this.configFile) throw new Error("Permanent sharing is not configured on this server.");
    const next = validateFixedConfig(input, this.configuration || {});
    const temporary = `${this.configFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, this.configFile);
    this.stop();
    this.configuration = next;
    this.configLoadError = "";
    return this.status();
  }

  async launch(run) {
    await new Promise((resolve, reject) => {
      run.server.once("error", reject);
      run.server.listen(0, "127.0.0.1", resolve);
    });
    if (this.current !== run) throw new Error("Sharing stopped.");
    // An isolated config avoids changing or inheriting the owner's other tunnels.
    run.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-remote-tunnel-"));
    const config = path.join(run.tempDir, "config.yml");
    const fixed = run.configuration;
    const target = `http://127.0.0.1:${run.server.address().port}`;
    const agentConfig = fixed ? JSON.stringify({ version: "3", agent: {
      authtoken: fixed.authtoken, log: "stdout", log_format: "json", web_addr: "false",
      update_check: false, remote_management: false
    } }) : "no-autoupdate: true\n";
    fs.writeFileSync(config, agentConfig, { mode: 0o600 });
    const binary = fixed ? process.env.NGROK_BIN || "ngrok" : process.env.CLOUDFLARED_BIN || "cloudflared";
    const args = fixed ? ["http", target, "--config", config, "--url", fixed.url, "--inspect=false"] : [
      "tunnel", "--config", config, "--no-autoupdate", "--protocol", "http2",
      "--url", target
    ];
    const child = this.spawnProcess(binary, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    run.child = child;

    await new Promise((resolve, reject) => {
      let log = "";
      let lines = "";
      let ngrokError = "";
      let registered = false;
      const timer = setTimeout(() => reject(new Error("Could not create the family link. Check the laptop's internet connection and try again.")), this.timeoutMs);
      run.cancel = () => { clearTimeout(timer); reject(new Error("Sharing stopped.")); };
      const finish = () => {
        if (!registered || !run.url) return;
        clearTimeout(timer);
        run.ready = true;
        resolve();
      };
      const read = chunk => {
        log = (log + chunk.toString()).slice(-32768);
        if (fixed) {
          ngrokError = log.match(/ERR_NGROK_\d+/)?.[0] || ngrokError;
          lines += chunk.toString();
          const records = lines.split(/\r?\n/);
          lines = records.pop().slice(-32768);
          for (const line of records) {
            try {
              const record = JSON.parse(line);
              if (record.msg === "started tunnel" && record.url === fixed.url) registered = true;
            } catch { /* Ignore non-JSON diagnostic lines. */ }
          }
        } else {
          run.url = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0] || run.url;
          registered ||= log.includes("Registered tunnel connection");
        }
        finish();
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.once("error", error => {
        clearTimeout(timer);
        reject(new Error(error.code === "ENOENT"
          ? fixed ? "Install ngrok on the laptop first: https://ngrok.com/download" : "Install cloudflared on the laptop first: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
          : `Could not start sharing: ${error.message}`));
      });
      child.once("exit", () => {
        clearTimeout(timer);
        const connectionError = new Error(fixed
          ? `ngrok could not open the saved address${ngrokError ? ` (${ngrokError})` : ""}. Check the account authtoken, assigned domain, and internet connection.`
          : "The sharing connection closed. Check the laptop's internet connection and try again.");
        if (this.current === run) {
          this.current = null;
          this.lastError = run.ready ? fixed ? "Sharing stopped. Start sharing again to use the same saved link." : "Sharing stopped. Start sharing again to create a new link." : connectionError.message;
        }
        reject(connectionError);
        this.cleanup(run);
      });
    });

    if (process.platform === "darwin") {
      // Prevent idle sleep only for the lifetime of this sharing session.
      run.keepAwake = this.spawnProcess("/usr/bin/caffeinate", ["-i", "-w", String(child.pid)], { stdio: "ignore" });
      run.keepAwake.on("error", () => {});
    }
    return this.status();
  }

  cleanup(run) {
    run.cancel?.();
    if (run.child && run.child.exitCode == null && !run.child.killed) run.child.kill();
    if (run.keepAwake && !run.keepAwake.killed) run.keepAwake.kill();
    run.server.closeAllConnections();
    run.server.close();
    if (run.tempDir) fs.rmSync(run.tempDir, { recursive: true, force: true });
  }

  stop() {
    const run = this.current;
    this.current = null;
    this.lastError = "";
    if (run) this.cleanup(run);
    return this.status();
  }
}

module.exports = { RemoteSharing, createFamilyHandler, validateFixedConfig };
