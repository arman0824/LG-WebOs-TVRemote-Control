const fs = require("fs");
const http = require("http");
const { execFileSync, spawn } = require("child_process");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const pidFile = path.join(root, ".server.pid");
const logFile = path.join(root, ".server.log");
const cliOptions = Object.fromEntries(
  process.argv
    .slice(3)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...value] = arg.slice(2).split("=");
      return [key, value.join("=")];
    })
);
const port = Number(cliOptions.port || process.env.PORT || 4173);
const host = cliOptions.host || process.env.HOST || "127.0.0.1";
const isWindows = process.platform === "win32";
const checkHost = host === "0.0.0.0" ? "127.0.0.1" : host;
const checkUrl = `http://${checkHost}:${port}`;
const displayUrl = `http://${host === "0.0.0.0" ? getLanAddress() : host}:${port}`;

function getLanAddress() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry && entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return "127.0.0.1";
}

function readPid() {
  try {
    return Number(fs.readFileSync(pidFile, "utf8").trim());
  } catch {
    return 0;
  }
}

function isRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && (error.code === "EPERM" || error.code === "EACCES")) return true;
    return false;
  }
}

function findPortPid() {
  try {
    if (isWindows) {
      const output = execFileSync("netstat", ["-ano", "-p", "tcp"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      const needle = `:${port} `;
      for (const line of output.split(/\r?\n/)) {
        if (!line.includes(needle)) continue;
        if (!/LISTENING/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (pid && pid !== 0 && pid !== 4) return pid;
      }
      return 0;
    }
    const output = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return Number(output.trim().split(/\s+/)[0] || 0);
  } catch {
    return 0;
  }
}

function removePid() {
  try {
    fs.unlinkSync(pidFile);
  } catch {
    // Already gone.
  }
}

function waitForServer(timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`${checkUrl}/api/status`, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Server did not answer at ${checkUrl}. Check ${path.basename(logFile)}.`));
        } else {
          setTimeout(tick, 180);
        }
      });
      req.setTimeout(800, () => {
        req.destroy();
      });
    };
    tick();
  });
}

async function start() {
  const existing = readPid() || findPortPid();
  if (isRunning(existing)) {
    fs.writeFileSync(pidFile, String(existing));
    console.log(`Already running at ${displayUrl}`);
    return;
  }
  removePid();
  const log = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    detached: !isWindows,
    windowsHide: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, PORT: String(port), HOST: host }
  });
  if (!isWindows) child.unref();
  fs.writeFileSync(pidFile, String(child.pid));
  await waitForServer();
  console.log(`Started Local LG TV Remote at ${displayUrl}`);
}

function stop() {
  const pid = readPid() || findPortPid();
  if (!isRunning(pid)) {
    removePid();
    console.log("Server is not running.");
    return;
  }
  try {
    process.kill(pid, isWindows ? "SIGKILL" : "SIGTERM");
  } catch (error) {
    // Already gone.
  }
  removePid();
  console.log("Stopped Local LG TV Remote.");
}

function status() {
  const pid = readPid() || findPortPid();
  if (isRunning(pid)) {
    fs.writeFileSync(pidFile, String(pid));
    console.log(`Running at ${displayUrl} (pid ${pid})`);
  } else {
    removePid();
    console.log("Server is not running.");
  }
}

const command = process.argv[2];

if (command === "start") {
  start().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
} else if (command === "stop") {
  stop();
} else if (command === "status") {
  status();
} else {
  console.log("Usage: node scripts/server-manager.js start|stop|status [--host=0.0.0.0] [--port=4173]");
  process.exit(1);
}