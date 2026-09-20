const crypto = require("crypto");
const dgram = require("dgram");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { TinyWebSocket, encodeFrame, decodeFrame } = require("./tv-protocols/websocket");
const { URL } = require("url");
const { NetcastClient, KEY_CODES } = require("./netcast");
const { RokuClient } = require("./tv-protocols/roku");
const { SamsungClient } = require("./tv-protocols/samsung");
const { AndroidTvClient } = require("./tv-protocols/androidtv");
const { detectSystem } = require("./tv-protocols/detect");
const { isLocalHost, identifySystem } = require("./tv-protocols/catalog");
const { RemoteSharing, createFamilyHandler } = require("./sharing");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const KEY_FILE = path.join(ROOT, ".tv-keys.json");

let activeClient = null;
let activeDevice = null;
let activeInputSocket = null;
let connecting = false;
let pendingPairing = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const COMMANDS = {
  volumeUp: { uri: "ssap://audio/volumeUp" },
  volumeDown: { uri: "ssap://audio/volumeDown" },
  mute: { uri: "ssap://audio/setMute", payload: { mute: true } },
  unmute: { uri: "ssap://audio/setMute", payload: { mute: false } },
  play: { uri: "ssap://media.controls/play" },
  pause: { uri: "ssap://media.controls/pause" },
  stop: { uri: "ssap://media.controls/stop" },
  rewind: { uri: "ssap://media.controls/rewind" },
  fastForward: { uri: "ssap://media.controls/fastForward" },
  powerOff: { uri: "ssap://system/turnOff" },
  toast: { uri: "ssap://system.notifications/createToast" },
  getApps: { uri: "ssap://com.webos.applicationManager/listApps" },
  launch: { uri: "ssap://system.launcher/launch" },
  buttonHome: { button: "HOME" },
  buttonBack: { button: "BACK" },
  buttonUp: { button: "UP" },
  buttonDown: { button: "DOWN" },
  buttonLeft: { button: "LEFT" },
  buttonRight: { button: "RIGHT" },
  buttonEnter: { button: "ENTER" },
  buttonExit: { button: "EXIT" },
  channelUp: { button: "CHANNELUP" },
  channelDown: { button: "CHANNELDOWN" },
  input: { button: "INPUT" },
  toggleMute: { button: "MUTE" },
  liveTv: { button: "TV" },
  guide: { button: "GUIDE" },
  info: { button: "INFO" },
  captions: { button: "CC" },
  quickMenu: { button: "QMENU" },
  buttonList: { button: "LIST" },
  previousChannel: { button: "FLASHBACK" },
  teletext: { button: "TELETEXT" },
  textOption: { button: "TEXTOPTION" },
  audioDescription: { button: "AD" },
  aspectRatio: { button: "ASPECT_RATIO" },
  record: { button: "RECORD" },
  recordings: { button: "RECLIST" },
  red: { button: "RED" },
  green: { button: "GREEN" },
  yellow: { button: "YELLOW" },
  blue: { button: "BLUE" }
};

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function normalizeHost(value) {
  if (!value || typeof value !== "string") return "";
  return value.trim().replace(/^https?:\/\//, "").replace(/^wss?:\/\//, "").split("/")[0].split(":")[0];
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function parseSsdpPacket(message) {
  const lines = String(message).split(/\r?\n/);
  const headers = {};
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index > 0) {
      headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }
  }
  return headers;
}

async function describeDevice(headers, host) {
  let name = headers.name || "Network TV", manufacturer = "", model = "";
  try {
    const location = new URL(headers.location);
    if (location.protocol !== "http:" || location.hostname !== host) throw new Error("Unrelated description URL.");
    const response = await fetch(location, { redirect: "error", signal: AbortSignal.timeout(1500) });
    if (response.ok) {
      const xml = (await response.text()).slice(0, 65536);
      name = extractTag(xml, "friendlyName") || name;
      manufacturer = extractTag(xml, "manufacturer"); model = extractTag(xml, "modelName");
    }
  } catch { }
  const marker = `${name} ${manufacturer} ${model} ${JSON.stringify(headers)}`;
  const protocol = identifySystem(marker);
  return { host, name, manufacturer, model, protocol, supported: protocol !== "auto" };
}

function localInterfaces() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(entry => entry && entry.family === "IPv4" && !entry.internal && isLocalHost(entry.address))
    .map(entry => ({ address: entry.address, netmask: entry.netmask }));
}

async function scanSsdp(waitMs = 4200) {
  const mdns = require("./tv-protocols/mdns");
  const found = new Map();
  const sockets = [];
  await Promise.all(localInterfaces().map(async entry => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    sockets.push(socket);
    socket.on("error", () => {});
    socket.on("message", (message, remote) => {
      if (!isLocalHost(remote.address) || remote.address === entry.address || found.size >= 32) return;
      const androidName = mdns.response(message);
      const headers = androidName ? { name: androidName, server: "androidtvremote2" } : parseSsdpPacket(message);
      const marker = JSON.stringify(headers);
      if (!/roku|samsung|androidtv|webos|web0s|lg|netcast|roap|smartshare|mediarenderer/i.test(marker)) return;
      if (!found.has(remote.address) || androidName) found.set(remote.address, headers);
    });
    try {
      await new Promise((resolve, reject) => { socket.once("error", reject); socket.bind(0, entry.address, resolve); });
      socket.setMulticastInterface(entry.address); socket.setMulticastTTL(2);
      for (const st of ["urn:schemas-upnp-org:device:MediaRenderer:1", "roku:ecp", "ssdp:all"]) {
        socket.send(Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`), 1900, "239.255.255.250");
      }
      socket.send(mdns.query(), 5353, "224.0.0.251");
    } catch { }
  }));
  await new Promise(resolve => setTimeout(resolve, waitMs));
  for (const socket of sockets) try { socket.close(); } catch { }
  const devices = await Promise.all([...found.entries()].map(([host, headers]) => describeDevice(headers, host)));
  return devices.sort((a, b) => Number(b.supported) - Number(a.supported) || a.name.localeCompare(b.name));
}

class WebOsClient {
  constructor(device, clientKey = "") {
    this.device = device;
    this.host = device.host;
    this.clientKey = clientKey;
    this.ws = null;
    this.protocol = "webos";
  }

  get closed() { return !this.ws || this.ws.closed; }

  async connect() {
    const urls = [
      `wss://${this.host}:3001/`,
      `ws://${this.host}:3000/`
    ];
    let lastError;
    for (const url of urls) {
      const ws = new TinyWebSocket(url);
      try {
        await ws.connect();
        this.ws = ws;
        return;
      } catch (error) {
        ws.close();
        lastError = error;
      }
    }
    throw new Error(`Cannot reach the TV's webOS control service at ${this.host} (ports 3001/3000). Check the TV IP, power and network remote-control settings. ${lastError?.message || ""}`);
  }

  async register() {
    const payload = {
      forcePairing: false,
      pairingType: "PROMPT",
      manifest: {
        manifestVersion: 1,
        appVersion: "1.0",
        permissions: webOsPermissions()
      }
    };
    if (this.clientKey) payload["client-key"] = this.clientKey;
    // A 'response' with pairingType PROMPT is only an acknowledgement.
    const response = await this.ws.request({ type: "register", payload }, 90000,
      (message) => message.type === "registered");
    const key = response.payload && response.payload["client-key"];
    if (!key) throw new Error("The TV did not return a pairing key.");
    this.clientKey = key;
    return response;
  }

  request(uri, payload = {}, timeoutMs = 15000) {
    return this.ws.request({ type: "request", uri, payload }, timeoutMs);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

function webOsPermissions() {
  return [
    "LAUNCH",
    "LAUNCH_WEBAPP",
    "APP_TO_APP",
    "CLOSE",
    "TEST_OPEN",
    "TEST_PROTECTED",
    "CONTROL_AUDIO",
    "CONTROL_DISPLAY",
    "CONTROL_INPUT_JOYSTICK",
    "CONTROL_INPUT_MEDIA_PLAYBACK",
    "CONTROL_INPUT_MEDIA_RECORDING",
    "CONTROL_INPUT_TEXT",
    "CONTROL_MOUSE_AND_KEYBOARD",
    "CONTROL_POWER",
    "READ_APP_STATUS",
    "READ_CURRENT_CHANNEL",
    "READ_INPUT_DEVICE_LIST",
    "READ_INSTALLED_APPS",
    "READ_LGE_SDX",
    "READ_NETWORK_STATE",
    "READ_RUNNING_APPS",
    "READ_TV_CHANNEL_LIST",
    "WRITE_NOTIFICATION_TOAST"
  ];
}

async function getInputSocket() {
  if (activeInputSocket && !activeInputSocket.closed) return activeInputSocket;
  if (!activeClient) throw new Error("Connect to a TV first.");
  const response = await activeClient.request("ssap://com.webos.service.networkinput/getPointerInputSocket", {}, 15000);
  const socketPath = response.payload && response.payload.socketPath;
  if (!socketPath) throw new Error("TV did not provide a pointer input socket.");
  const ws = new TinyWebSocket(socketPath);
  await ws.connect();
  activeInputSocket = ws;
  return ws;
}

async function sendButton(name) {
  const socket = await getInputSocket();
  socket.sendText(`type:button\nname:${name}\n\n`);
  return { ok: true, button: name };
}

async function connectToDevice(device, pairingCode = "") {
  const host = normalizeHost(device.host);
  if (!isLocalHost(host)) throw new Error("Enter the TV's local IPv4 address from its network settings.");
  const keys = readJsonFile(KEY_FILE, {});
  const old = keys[host];
  const saved = typeof old === "string" ? { protocol: "webos", key: old } : old || {};
  const protocol = await detectSystem({ ...device, host }, saved);
  const selected = { name: device.name || "Smart TV", host, protocol, model: device.model || "", manufacturer: device.manufacturer || "" };
  if (pendingPairing && (!pairingCode || pendingPairing.host !== host || protocol !== "androidtv")) {
    pendingPairing.close(); pendingPairing = null;
  }
  let client;
  try {
    if (protocol === "androidtv") {
      client = pendingPairing?.host === host ? pendingPairing : new AndroidTvClient(selected, saved.protocol === protocol ? saved : {});
      if (pairingCode) {
        if (client !== pendingPairing) throw new Error("Tap Connect first to request a new TV pairing code.");
        await client.finishPairing(pairingCode); pendingPairing = null;
      } else if (saved.protocol === protocol && saved.credentials && saved.pin) await client.connect();
      else {
        pendingPairing = client;
        await client.startPairing();
        return { ok: true, pairingRequired: true, codeFormat: "hex", device: selected };
      }
    } else if (protocol === "netcast") {
      client = new NetcastClient(selected, saved.protocol === protocol ? saved.key : "");
      if (!pairingCode && client.clientKey) {
        try { await client.register(); } catch (error) { if (error.code !== 401) throw error; }
      }
      if (pairingCode) await client.register(pairingCode);
      if (client.closed) {
        await client.showPairingCode();
        return { ok: true, pairingRequired: true, codeFormat: "numeric", device: selected };
      }
    } else {
      if (pairingCode) throw new Error("This TV system does not use a typed pairing code. Tap Connect and follow the TV prompt.");
      client = protocol === "roku" ? new RokuClient(selected)
        : protocol === "samsung" ? new SamsungClient(selected, saved.protocol === protocol ? saved : {})
        : new WebOsClient(selected, saved.protocol === protocol ? saved.key : "");
      await client.connect(); await client.register();
    }
    selected.capabilities = client.capabilities ? client.capabilities()
      : protocol === "netcast" ? [...Object.keys(KEY_CODES), "digit"] : [...Object.keys(COMMANDS), "digit"];
    if (client.name) selected.name = client.name;
    keys[host] = { protocol, key: client.clientKey || "", pin: client.pin || "", ...(client.credentials ? { credentials: client.credentials } : {}) };
    writeJsonFile(KEY_FILE, keys);
  } catch (error) {
    client?.close(); if (pendingPairing === client) pendingPairing = null;
    throw error;
  }
  activeClient?.close(); activeInputSocket?.close();
  activeClient = client; activeDevice = selected; activeInputSocket = null;
  return { ok: true, device: activeDevice, paired: true };
}

async function handleApi(req, res, pathname, shared = false) {
  try {
    if (req.method === "GET" && pathname === "/api/mode") {
      return sendJson(res, 200, { shared });
    }
    if (!shared && pathname === "/api/share") {
      if (req.method === "GET") return sendJson(res, 200, sharing.status());
      if (req.method === "POST") return sendJson(res, 200, await sharing.start());
      if (req.method === "DELETE") return sendJson(res, 200, sharing.stop());
    }
    if (!shared && pathname === "/api/share/config" && req.method === "POST") {
      sharing.configure(await readBody(req));
      return sendJson(res, 200, await sharing.start());
    }
    if (req.method === "GET" && pathname === "/api/status") {
      if (activeClient?.checkStatus) await activeClient.checkStatus();
      return sendJson(res, 200, {
        connected: Boolean(activeClient && !activeClient.closed),
        device: shared && activeDevice ? { name: activeDevice.name, model: activeDevice.model, protocol: activeDevice.protocol, capabilities: activeDevice.capabilities } : activeDevice,
        shared,
        ...(shared ? {} : { localInterfaces: localInterfaces() })
      });
    }

    if (req.method === "GET" && pathname === "/api/scan") {
      const devices = await scanSsdp();
      return sendJson(res, 200, { devices });
    }

    if (req.method === "POST" && pathname === "/api/connect") {
      const body = await readBody(req);
      if (connecting) return sendJson(res, 409, { error: "A pairing attempt is already in progress." });
      const device = {
        name: body.name || body.host || "Smart TV",
        host: normalizeHost(body.host),
        model: body.model || "",
        manufacturer: body.manufacturer || "",
        protocol: body.protocol || "auto"
      };
      connecting = true;
      try {
        const result = await connectToDevice(device, String(body.pairingCode || "").trim());
        return sendJson(res, 200, result);
      } finally { connecting = false; }
    }

    if (req.method === "POST" && pathname === "/api/forget") {
      const body = await readBody(req);
      const host = normalizeHost(body.host);
      if (!host) throw new Error("Enter or select the TV IP to forget first.");
      if (connecting) throw new Error("Wait for the current pairing attempt to finish.");
      const keys = readJsonFile(KEY_FILE, {});
      if (pendingPairing?.host === host) { pendingPairing.close(); pendingPairing = null; }
      delete keys[host];
      writeJsonFile(KEY_FILE, keys);
      if (activeDevice?.host === host) {
        activeInputSocket?.close();
        activeClient?.close();
        activeInputSocket = activeClient = activeDevice = null;
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && pathname === "/api/disconnect") {
      pendingPairing?.close(); pendingPairing = null;
      if (activeInputSocket) activeInputSocket.close();
      if (activeClient) activeClient.close();
      activeInputSocket = null;
      activeClient = null;
      activeDevice = null;
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && pathname === "/api/command") {
      if (!activeClient || activeClient.closed) throw new Error(shared ? "The TV is offline. Ask the person using the laptop to reconnect it." : "Connect to a TV first.");
      const body = await readBody(req);
      if (activeClient.protocol !== "webos") return sendJson(res, 200, await activeClient.command(body.command, body.payload));
      if (body.command === "digit") {
        const digit = String(body.payload?.digit);
        if (!/^[0-9]$/.test(digit)) throw new Error("Enter a single digit from 0 to 9.");
        return sendJson(res, 200, await sendButton(digit));
      }
      const command = COMMANDS[body.command];
      if (!command) throw new Error(`Unknown command: ${body.command}`);
      if (command.button) {
        return sendJson(res, 200, await sendButton(command.button));
      }
      const payload = { ...(command.payload || {}), ...(body.payload || {}) };
      const response = await activeClient.request(command.uri, payload);
      return sendJson(res, 200, { ok: true, response });
    }

    return sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
}

function serveStatic(req, res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, cleanPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

const sharing = new RemoteSharing(createFamilyHandler({ handleApi, serveStatic, sendJson }), {
  configFile: path.join(ROOT, ".sharing-config.json")
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url.pathname);
    return;
  }
  serveStatic(req, res, url.pathname);
});

if (require.main === module) {
  const shutdown = () => {
    sharing.stop();
    pendingPairing?.close();
    activeInputSocket?.close();
    activeClient?.close();
    server.closeAllConnections();
    server.close(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  server.listen(PORT, HOST, () => {
  console.log(`Universal TV Remote is running at http://${HOST}:${PORT}`);
  console.log("Keep your TV powered on and on the same Wi-Fi/network as this laptop.");
});
}

module.exports = { TinyWebSocket, WebOsClient, encodeFrame, decodeFrame, server, COMMANDS, connectToDevice };
