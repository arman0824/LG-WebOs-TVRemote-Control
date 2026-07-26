const crypto = require("crypto");
const dgram = require("dgram");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const tls = require("tls");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const KEY_FILE = path.join(ROOT, ".tv-keys.json");

let activeClient = null;
let activeDevice = null;
let activeInputSocket = null;

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
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
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

async function describeDevice(headers, remoteAddress) {
  const location = headers.location;
  const server = headers.server || "";
  const usn = headers.usn || "";
  let host = remoteAddress;
  let name = "LG webOS TV";
  let manufacturer = "";
  let model = "";
  let isLikelyTv = /lg|webos|web0s|smartshare|mediarenderer/i.test(`${server} ${usn} ${headers.st || ""}`);

  if (location) {
    try {
      const locationUrl = new URL(location);
      host = locationUrl.hostname || host;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2200);
      try {
        const response = await fetch(location, { signal: controller.signal });
        if (response.ok) {
          const xml = await response.text();
          name = extractTag(xml, "friendlyName") || name;
          manufacturer = extractTag(xml, "manufacturer");
          model = extractTag(xml, "modelName") || extractTag(xml, "modelNumber");
          isLikelyTv = isLikelyTv || /lg|webos/i.test(`${name} ${manufacturer} ${model} ${xml}`);
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // Some TVs respond to SSDP but block the description fetch. The IP is still useful.
    }
  }

  return {
    id: crypto.createHash("sha1").update(`${host}:${usn || location || server}`).digest("hex").slice(0, 12),
    name,
    host,
    location: location || "",
    manufacturer,
    model,
    server,
    usn,
    likelyLg: isLikelyTv
  };
}

function localInterfaces() {
  const interfaces = os.networkInterfaces();
  return Object.values(interfaces)
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => ({ address: entry.address, netmask: entry.netmask, name: entry.mac }));
}

async function scanSsdp(waitMs = 4200) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const seen = new Map();
  const descriptions = [];
  const searchTargets = [
    "urn:schemas-upnp-org:device:MediaRenderer:1",
    "urn:schemas-upnp-org:service:AVTransport:1",
    "ssdp:all"
  ];

  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, () => {
      socket.removeListener("error", reject);
      resolve();
    });
  });

  socket.on("message", async (message, remote) => {
    const headers = parseSsdpPacket(message);
    if (!headers.location && !headers.server && !headers.usn) return;
    const fingerprint = `${remote.address}|${headers.location || ""}|${headers.usn || ""}`;
    if (seen.has(fingerprint)) return;
    seen.set(fingerprint, {
      id: crypto.createHash("sha1").update(fingerprint).digest("hex").slice(0, 12),
      name: "Discovered TV",
      host: remote.address,
      location: headers.location || "",
      manufacturer: "",
      model: "",
      server: headers.server || "",
      usn: headers.usn || "",
      likelyLg: /lg|webos|smartshare|mediarenderer/i.test(`${headers.server || ""} ${headers.usn || ""} ${headers.st || ""}`)
    });
    const description = describeDevice(headers, remote.address).then((device) => {
      const key = `${device.host}|${device.location || device.usn || fingerprint}`;
      seen.delete(fingerprint);
      seen.set(key, device);
    });
    descriptions.push(description);
  });

  for (const st of searchTargets) {
    const packet = [
      "M-SEARCH * HTTP/1.1",
      "HOST: 239.255.255.250:1900",
      "MAN: \"ssdp:discover\"",
      "MX: 2",
      `ST: ${st}`,
      "",
      ""
    ].join("\r\n");
    socket.send(Buffer.from(packet), 1900, "239.255.255.250");
  }

  await new Promise((resolve) => setTimeout(resolve, waitMs));
  socket.close();
  await Promise.allSettled(descriptions);

  const byHost = new Map();
  for (const device of seen.values()) {
    const previous = byHost.get(device.host);
    if (!previous || Number(device.likelyLg) > Number(previous.likelyLg) || device.name !== "Discovered TV") {
      byHost.set(device.host, device);
    }
  }
  return [...byHost.values()].sort((a, b) => Number(b.likelyLg) - Number(a.likelyLg) || a.name.localeCompare(b.name));
}

class TinyWebSocket {
  constructor(url, options = {}) {
    this.url = new URL(url);
    this.options = options;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.handlers = new Set();
    this.closed = false;
    this.handshakeBuffer = Buffer.alloc(0);
  }

  connect(timeoutMs = 7000) {
    const isSecure = this.url.protocol === "wss:";
    const port = Number(this.url.port || (isSecure ? 443 : 80));
    const socketOptions = {
      host: this.url.hostname,
      port,
      servername: this.url.hostname,
      rejectUnauthorized: false
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out connecting to ${this.url.hostname}:${port}.`));
        this.close();
      }, timeoutMs);

      const onError = (error) => {
        clearTimeout(timer);
        reject(error);
      };

      const onReady = () => {
        const key = crypto.randomBytes(16).toString("base64");
        const requestPath = `${this.url.pathname || "/"}${this.url.search || ""}`;
        const request = [
          `GET ${requestPath} HTTP/1.1`,
          `Host: ${this.url.host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "",
          ""
        ].join("\r\n");
        socket.write(request);
      };
      const socket = isSecure ? tls.connect(socketOptions, onReady) : net.connect(socketOptions, onReady);
      this.socket = socket;
      socket.once("error", onError);

      socket.on("data", (chunk) => {
        if (!this.connected) {
          this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, chunk]);
          const marker = this.handshakeBuffer.indexOf("\r\n\r\n");
          if (marker === -1) return;
          const header = this.handshakeBuffer.slice(0, marker).toString("utf8");
          const rest = this.handshakeBuffer.slice(marker + 4);
          if (!/^HTTP\/1\.1 101/i.test(header)) {
            clearTimeout(timer);
            reject(new Error(`WebSocket handshake failed: ${header.split("\r\n")[0] || "unknown response"}`));
            this.close();
            return;
          }
          this.connected = true;
          socket.removeListener("error", onError);
          socket.on("error", (error) => this.rejectAll(error));
          socket.on("close", () => {
            this.closed = true;
            this.rejectAll(new Error("WebSocket closed."));
          });
          clearTimeout(timer);
          if (rest.length) this.consume(rest);
          resolve(this);
          return;
        }
        this.consume(chunk);
      });
    });
  }

  onMessage(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  sendText(text) {
    if (!this.socket || this.closed) throw new Error("WebSocket is not connected.");
    this.socket.write(encodeFrame(Buffer.from(text), 0x1));
  }

  request(payload, timeoutMs = 15000) {
    const id = payload.id || `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const message = { ...payload, id };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${message.uri || message.type || id}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.sendText(JSON.stringify(message));
    });
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const frame = decodeFrame(this.buffer);
      if (!frame) return;
      this.buffer = this.buffer.slice(frame.bytes);
      if (frame.opcode === 0x8) {
        this.close();
        return;
      }
      if (frame.opcode === 0x9) {
        this.socket.write(encodeFrame(frame.payload, 0xA));
        continue;
      }
      if (frame.opcode !== 0x1) continue;
      const text = frame.payload.toString("utf8");
      for (const handler of this.handlers) handler(text);
      try {
        const message = JSON.parse(text);
        if (message.id && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id);
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.type === "error") {
            pending.reject(new Error(message.error || "LG TV returned an error."));
          } else {
            pending.resolve(message);
          }
        }
      } catch {
        // Pointer sockets may send plain text. Keep the connection alive.
      }
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.closed = true;
    try {
      if (this.socket && !this.socket.destroyed) this.socket.end();
    } catch {
      // Nothing else to do.
    }
  }
}

function encodeFrame(payload, opcode) {
  const length = payload.length;
  let headerLength = 2;
  if (length >= 126 && length <= 65535) headerLength += 2;
  if (length > 65535) headerLength += 8;
  const mask = crypto.randomBytes(4);
  const frame = Buffer.alloc(headerLength + 4 + length);
  frame[0] = 0x80 | opcode;
  if (length < 126) {
    frame[1] = 0x80 | length;
  } else if (length <= 65535) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(length, 2);
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
  }
  mask.copy(frame, headerLength);
  for (let index = 0; index < length; index += 1) {
    frame[headerLength + 4 + index] = payload[index] ^ mask[index % 4];
  }
  return frame;
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Frame is too large.");
    length = Number(bigLength);
    offset += 8;
  }
  const masked = Boolean(second & 0x80);
  let mask;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.slice(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.slice(offset, offset + length));
  if (masked) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] = payload[index] ^ mask[index % 4];
    }
  }
  return { opcode: first & 0x0f, payload, bytes: offset + length };
}

class WebOsClient {
  constructor(device, clientKey = "") {
    this.device = device;
    this.host = device.host;
    this.clientKey = clientKey;
    this.ws = null;
  }

  async connect() {
    const urls = [
      `wss://${this.host}:3001/`,
      `ws://${this.host}:3000/`
    ];
    let lastError;
    for (const url of urls) {
      try {
        const ws = new TinyWebSocket(url);
        await ws.connect();
        this.ws = ws;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Could not connect to LG TV.");
  }

  async register() {
    const payload = {
      forcePairing: false,
      pairingType: "PROMPT",
      manifest: {
        manifestVersion: 1,
        appVersion: "1.0",
        signed: {
          created: "2026-06-30T00:00:00.000Z",
          appId: "com.local.codex.lgremote",
          vendorId: "com.local",
          localizedAppNames: { "": "Local LG Remote" },
          localizedVendorNames: { "": "Local" },
          permissions: webOsPermissions(),
          serial: "local-lg-remote"
        },
        permissions: webOsPermissions(),
        signatures: []
      }
    };
    if (this.clientKey) payload["client-key"] = this.clientKey;
    const response = await this.ws.request({ type: "register", payload }, 90000);
    const key = response.payload && response.payload["client-key"];
    if (key) this.clientKey = key;
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

async function connectToDevice(device) {
  const host = normalizeHost(device.host);
  if (!host) throw new Error("Missing TV IP address.");
  const keys = readJsonFile(KEY_FILE, {});
  const key = keys[host] || "";
  const client = new WebOsClient({ ...device, host }, key);
  await client.connect();
  const registration = await client.register();
  if (client.clientKey) {
    keys[host] = client.clientKey;
    writeJsonFile(KEY_FILE, keys);
  }
  if (activeClient) activeClient.close();
  if (activeInputSocket) activeInputSocket.close();
  activeClient = client;
  activeDevice = {
    name: device.name || "LG webOS TV",
    host,
    model: device.model || "",
    manufacturer: device.manufacturer || "LG"
  };
  activeInputSocket = null;
  return {
    ok: true,
    device: activeDevice,
    paired: Boolean(registration.payload && registration.payload["client-key"])
  };
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === "GET" && pathname === "/api/status") {
      return sendJson(res, 200, {
        connected: Boolean(activeClient && activeClient.ws && !activeClient.ws.closed),
        device: activeDevice,
        localInterfaces: localInterfaces()
      });
    }

    if (req.method === "GET" && pathname === "/api/scan") {
      const devices = await scanSsdp();
      return sendJson(res, 200, { devices });
    }

    if (req.method === "POST" && pathname === "/api/connect") {
      const body = await readBody(req);
      const device = {
        name: body.name || body.host || "LG webOS TV",
        host: normalizeHost(body.host),
        model: body.model || "",
        manufacturer: body.manufacturer || "LG"
      };
      const result = await connectToDevice(device);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && pathname === "/api/disconnect") {
      if (activeInputSocket) activeInputSocket.close();
      if (activeClient) activeClient.close();
      activeInputSocket = null;
      activeClient = null;
      activeDevice = null;
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && pathname === "/api/command") {
      if (!activeClient || activeClient.ws.closed) throw new Error("Connect to a TV first.");
      const body = await readBody(req);
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url.pathname);
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Local LG TV Remote is running at http://${HOST}:${PORT}`);
  console.log("Keep your LG TV powered on and on the same Wi-Fi/network as this Mac.");
});
