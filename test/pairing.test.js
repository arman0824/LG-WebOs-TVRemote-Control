const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { NetcastClient } = require("../netcast");
const { TinyWebSocket, WebOsClient, encodeFrame } = require("../server");
const fs = require("node:fs");
const path = require("node:path");

test("every visible remote command has a webOS and NetCast implementation", () => {
  const { COMMANDS } = require("../server");
  const { KEY_CODES } = require("../netcast");
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  for (const [, name] of html.matchAll(/data-command="([^"]+)"/g)) {
    assert.ok(COMMANDS[name], `Missing webOS command: ${name}`);
    assert.ok(Number.isInteger(KEY_CODES[name]), `Missing NetCast command: ${name}`);
  }
});

test("NetCast number keys send individual key presses and reject invalid digits", async () => {
  const client = new NetcastClient({ host: "127.0.0.1" });
  client.closed = false;
  const pressed = [];
  client.sendKey = async code => pressed.push(code);
  await client.command("digit", { digit: "0" });
  await client.command("digit", { digit: "9" });
  await client.command("toggleMute");
  await client.command("guide");
  assert.deepEqual(pressed, [2, 11, 26, 44]);
  for (const digit of ["10", "-1", "", "<value>", null]) {
    await assert.rejects(client.command("digit", { digit }), /single digit/);
  }
  assert.equal(pressed.length, 4);
});

test("NetCast detects ROAP, requests a code, authenticates and sends session-bound keys", async (t) => {
  const requests = [];
  let authenticated = false;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, body });
    if (body.includes("<type>AuthReq</type>")) authenticated = body.includes("<value>123456</value>");
    const denied = (req.method === "GET" || body.includes("<type>AuthReq</type>")) && !authenticated;
    res.writeHead(denied ? 401 : 200, { "Content-Type": "application/atom+xml" });
    res.end(`<envelope><ROAPError>${denied ? 401 : 200}</ROAPError>${authenticated ? "<session>42</session>" : ""}</envelope>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new NetcastClient({ host: "127.0.0.1" }, "", server.address().port);
  assert.equal(await client.detect(), true);
  assert.equal(client.closed, true);
  await client.showPairingCode();
  assert.match(requests.at(-1).body, /AuthKeyReq/);
  await assert.rejects(client.register("<bad>"), /six-digit/);
  await assert.rejects(client.register("111111"), /401/);
  assert.equal(client.closed, true);
  await client.register("123456");
  assert.equal(client.closed, false);
  await client.command("buttonHome");
  assert.match(requests.at(-1).body, /<session>42<\/session><type>HandleKeyInput<\/type><value>21<\/value>/);
  await client.command("channel", { major: "12" });
  assert.deepEqual(requests.slice(-3).map(r => r.body.match(/<value>(\d+)<\/value>/)[1]), ["3", "4", "20"]);
  await assert.rejects(client.command("getApps"), /not available/);
  const saved = new NetcastClient({ host: "127.0.0.1" }, client.clientKey, server.address().port);
  await saved.register();
  assert.equal(saved.closed, false);
  authenticated = false;
  await client.checkStatus();
  assert.equal(client.closed, true);
});

test("an unrelated HTTP service is not detected as a NetCast TV", async (t) => {
  const server = http.createServer((req, res) => res.end("hello"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new NetcastClient({ host: "127.0.0.1" }, "", server.address().port);
  assert.equal(await client.detect(), false);
});

function registrationClient() {
  const client = new WebOsClient({ host: "127.0.0.1" });
  client.ws = new TinyWebSocket("ws://127.0.0.1:3000");
  let sent;
  client.ws.sendText = (text) => { sent = JSON.parse(text); };
  const promise = client.register();
  return { client, promise, sent, reply: message => client.ws.consume(encodeFrame(Buffer.from(JSON.stringify({ id: sent.id, ...message })), 1)) };
}

test("webOS waits for registered after the prompt acknowledgement", async () => {
  const { client, promise, sent, reply } = registrationClient();
  assert.equal(sent.payload.manifest.signed, undefined);
  reply({ type: "response", payload: { pairingType: "PROMPT" } });
  assert.equal(client.ws.pending.size, 1);
  assert.equal(client.clientKey, "");
  reply({ type: "registered", payload: { "client-key": "test-key" } });
  await promise;
  assert.equal(client.clientKey, "test-key");
  assert.equal(client.ws.pending.size, 0);
  client.close();
});

test("webOS pairing rejection and socket close fail without waiting for timeout", async () => {
  const rejected = registrationClient();
  rejected.reply({ type: "error", error: "403 User denied access" });
  await assert.rejects(rejected.promise, /denied/);
  rejected.client.close();
  const closed = registrationClient();
  closed.client.close();
  await assert.rejects(closed.promise, /closed/);
  assert.equal(closed.client.ws.pending.size, 0);
});
