const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once, EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { RemoteSharing, createFamilyHandler } = require("../sharing");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("family links reuse status and commands without exposing setup or files", async t => {
  const calls = [];
  const json = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  const server = http.createServer(createFamilyHandler({
    sendJson: json,
    handleApi: (req, res, path, shared) => { calls.push({ path, shared }); json(res, 200, { connected: true, shared }); },
    serveStatic: (req, res, path) => { res.end(`static: ${path}`); }
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(base + "/api/mode")).json(), { shared: true });
  const status = await fetch(base + "/api/status");
  assert.equal(status.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.deepEqual(await status.json(), { connected: true, shared: true });
  assert.equal((await fetch(base + "/api/command", { method: "POST" })).status, 200);
  assert.deepEqual(calls, [{ path: "/api/status", shared: true }, { path: "/api/command", shared: true }]);
  for (const path of ["/api/connect", "/api/forget", "/api/disconnect", "/api/share", "/api/share/config", "/api/scan", "/.tv-keys.json", "/.sharing-config.json"]) {
    assert.equal((await fetch(base + path, { method: "POST" })).status, 404);
    assert.equal((await fetch(base + path)).status, 404);
  }
  assert.equal(await (await fetch(base + "/app.js")).text(), "static: /app.js");
});

test("a fixed ngrok URL survives stopping and a new manager without leaking the token", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-sharing-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configFile = path.join(dir, "config.json");
  const url = "https://family-remote-test.ngrok-free.app";
  const secret = "test_token_not_a_real_account_12345";
  const commands = [];
  const spawnProcess = (binary, args) => {
    const child = childProcess();
    if (binary.includes("caffeinate")) return child;
    commands.push({ binary, args });
    assert.equal(args[args.indexOf("--url") + 1], url);
    assert.ok(!args.some(arg => arg.includes(secret)));
    const config = JSON.parse(fs.readFileSync(args[args.indexOf("--config") + 1], "utf8"));
    assert.equal(config.agent.authtoken, secret);
    process.nextTick(() => {
      // Fragmented JSON output must not report success until the record is complete.
      child.stdout.write('{"msg":"started tunnel",');
      child.stdout.write(`"url":"${url}"}\n`);
    });
    return child;
  };
  const first = new RemoteSharing(() => {}, { configFile, spawnProcess });
  first.configure({ url: url + "/", authtoken: secret });
  assert.ok(!JSON.stringify(first.status()).includes(secret));
  assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
  assert.equal((await first.start()).url, url);
  first.stop();
  assert.equal(first.status().url, url);
  const second = new RemoteSharing(() => {}, { configFile, spawnProcess });
  assert.equal((await second.start()).url, url);
  assert.equal(second.status().permanent, true);
  second.stop();
  assert.equal(commands.length, 2);
  assert.ok(commands.every(command => command.binary === "ngrok"));
  assert.throws(() => second.configure({ url: "http://example.com", authtoken: secret }), /assigned ngrok/);
  assert.equal(second.status().url, url);
});

test("invalid saved permanent settings never fall back to a random link", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-sharing-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configFile = path.join(dir, "config.json");
  fs.writeFileSync(configFile, "invalid json");
  const manager = new RemoteSharing(() => {}, { configFile, spawnProcess: () => assert.fail("Must not start a random tunnel") });
  await assert.rejects(manager.start(), /settings could not be read/);
});

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 123;
  child.exitCode = null;
  child.kill = () => { child.killed = true; child.exitCode = 0; child.emit("exit", 0); };
  return child;
}

test("sharing starts once, waits for the tunnel, and stops all owned resources", async () => {
  let tunnel;
  const manager = new RemoteSharing((req, res) => res.end("remote"), {
    spawnProcess: (binary) => {
      const child = childProcess();
      if (binary.includes("caffeinate")) return child;
      tunnel = child;
      process.nextTick(() => {
        child.stderr.write("https://family-remote-test.trycloudflare.com\n");
        child.stderr.write("Registered tunnel connection\n");
      });
      return child;
    }
  });
  const pending = manager.start();
  assert.equal(manager.start(), pending);
  assert.equal(manager.status().starting, true);
  const result = await pending;
  assert.equal(result.active, true);
  assert.equal(result.url, "https://family-remote-test.trycloudflare.com");
  const port = manager.current.server.address().port;
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "remote");
  manager.stop();
  assert.equal(tunnel.killed, true);
  assert.deepEqual(manager.status(), { active: false, starting: false, url: "", error: "" });
});

test("startup failure clears the URL and allows retry", async () => {
  const manager = new RemoteSharing(() => {}, {
    spawnProcess: () => {
      const child = childProcess();
      process.nextTick(() => child.emit("error", Object.assign(new Error("not installed"), { code: "ENOENT" })));
      return child;
    }
  });
  await assert.rejects(manager.start(), /Install cloudflared/);
  assert.equal(manager.status().active, false);
  assert.equal(manager.status().url, "");
  await assert.rejects(manager.start(), /Install cloudflared/);
});

test("stopping a starting tunnel cancels the pending request", async () => {
  let spawned;
  const ready = new Promise(resolve => { spawned = resolve; });
  const manager = new RemoteSharing(() => {}, {
    spawnProcess: () => { const child = childProcess(); spawned(); return child; }
  });
  const pending = manager.start();
  await ready;
  manager.stop();
  await assert.rejects(pending, /Sharing stopped/);
  assert.equal(manager.status().starting, false);
});
