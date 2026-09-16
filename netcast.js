// LG NetCast ROAP protocol (port 8080), used by older Smart TVs.
const KEY_CODES = {
  powerOff: 1, buttonUp: 12, buttonDown: 13, buttonLeft: 14, buttonRight: 15,
  buttonEnter: 20, buttonHome: 21, buttonBack: 23, volumeUp: 24, volumeDown: 25,
  mute: 26, unmute: 26, channelUp: 27, channelDown: 28, blue: 29, green: 30,
  red: 31, yellow: 32, play: 33, pause: 34, stop: 35, fastForward: 36,
  rewind: 37, input: 47, buttonExit: 412, openApps: 417
};

function tag(xml, name) {
  return xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, "i"))?.[1] || "";
}

class NetcastClient {
  constructor(device, clientKey = "", port = 8080) {
    this.device = device;
    this.host = device.host;
    this.clientKey = clientKey;
    this.baseUrl = `http://${this.host}:${port}/roap/api/`;
    this.protocol = "netcast";
    this.session = "";
    this.closed = true;
  }

  async exchange(endpoint, body, probe = false) {
    const response = await fetch(this.baseUrl + endpoint, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/atom+xml" },
      body: body ? `<?xml version="1.0" encoding="utf-8"?>${body}` : undefined,
      signal: AbortSignal.timeout(probe ? 1800 : 5000)
    });
    const xml = await response.text();
    const code = tag(xml, "ROAPError");
    if (probe) return /<ROAPError>/.test(xml);
    if (!response.ok || (code && code !== "200")) {
      const error = new Error(`LG NetCast: ${tag(xml, "ROAPErrorDetail") || response.statusText} (${code || response.status}).`);
      error.code = Number(code || response.status);
      if (error.code === 401) this.close();
      throw error;
    }
    return xml;
  }

  async detect() {
    try { return await this.exchange("data?target=volume_info", null, true); }
    catch { return false; }
  }

  async showPairingCode() {
    await this.exchange("auth", "<auth><type>AuthKeyReq</type></auth>");
  }

  async register(code = this.clientKey) {
    if (!/^\d{6}$/.test(code)) throw new Error("Enter the six-digit pairing code shown on the TV.");
    const xml = await this.exchange("auth", `<auth><type>AuthReq</type><value>${code}</value></auth>`);
    const session = tag(xml, "session");
    if (!/^\d+$/.test(session)) throw new Error("The TV did not provide a NetCast session. Request a new pairing code.");
    this.session = session;
    this.clientKey = code;
    this.closed = false;
  }

  async command(name, payload = {}) {
    if (this.closed) throw new Error("Connect to a TV first.");
    if (name === "channel") {
      const digits = String(payload.major || payload.channelId || "");
      if (!/^\d{1,5}$/.test(digits)) throw new Error("Enter a valid channel number.");
      for (const digit of digits) await this.sendKey(Number(digit) + 2);
      await this.sendKey(20);
      return { ok: true };
    }
    const code = KEY_CODES[name];
    if (code == null) throw new Error("This feature is not available on this NetCast TV. Use Home or Apps on the TV.");
    await this.sendKey(code);
    if (name === "powerOff") this.close();
    return { ok: true };
  }

  async sendKey(code) {
    await this.exchange("command", `<command><session>${this.session}</session><type>HandleKeyInput</type><value>${code}</value></command>`);
  }

  async checkStatus() {
    if (this.closed) return;
    try { await this.exchange("data?target=volume_info"); }
    catch { this.close(); }
  }

  close() { this.closed = true; this.session = ""; }
}

module.exports = { NetcastClient };
