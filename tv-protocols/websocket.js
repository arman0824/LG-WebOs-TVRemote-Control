const crypto = require("node:crypto");
const net = require("node:net");
const tls = require("node:tls");

class TinyWebSocket {
  constructor(url, options = {}) {
    this.url = new URL(url);
    this.options = options;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.handlers = new Set();
    this.closeHandlers = new Set();
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
        if (isSecure) {
          this.peerPin = crypto.createHash('sha256').update(socket.getPeerCertificate().raw).digest('hex');
          if (this.options.pin && this.options.pin !== this.peerPin) {
            const error = new Error('The TV certificate changed. Forget its saved pairing and pair again.');
            error.code = 'CERT_CHANGED';
            onError(error); this.close(); return;
          }
        }
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
      socket.once("close", () => {
        if (!this.connected) onError(new Error("WebSocket closed before the connection was ready."));
      });

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

  sendText(text, callback) {
    if (!this.socket || this.closed) throw new Error("WebSocket is not connected.");
    this.socket.write(encodeFrame(Buffer.from(text), 0x1), callback);
  }

  request(payload, timeoutMs = 15000, accept = () => true) {
    const id = payload.id || `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const message = { ...payload, id };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${message.uri || message.type || id}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, accept });
      try { this.sendText(JSON.stringify(message)); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
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
          if (message.type !== "error" && !pending.accept(message)) continue;
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.type === "error") {
            pending.reject(new Error(message.error || "TV returned an error."));
          } else {
            pending.resolve(message);
          }
        }
      } catch {
        // Pointer sockets may send plain text. Keep the connection alive.
      }
    }
  }

  onClose(handler) { this.closeHandlers.add(handler); return () => this.closeHandlers.delete(handler); }

  rejectAll(error) {
    for (const handler of this.closeHandlers) handler(error);
    this.closeHandlers.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.closed = true;
    this.rejectAll(new Error("WebSocket closed."));
    try {
      if (this.socket && !this.socket.destroyed) this.socket.destroy();
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


module.exports = { TinyWebSocket, encodeFrame, decodeFrame };
