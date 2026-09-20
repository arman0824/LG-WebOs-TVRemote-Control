const { ROKU_KEYS, ROKU_TV_KEYS } = require('./catalog');
const { tag } = require('../netcast');
class RokuClient {
  constructor(device, port=8060) {
    this.host=device.host; this.base=`http://${this.host}:${port}`; this.protocol='roku';
    this.closed=true; this.clientKey=''; this.keys=ROKU_KEYS;
  }
  async exchange(path, post=false) {
    const response=await fetch(this.base+path,{method:post?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(2500)});
    if (!response.ok) throw new Error(response.status===403 ? 'On the TV, enable Settings → System → Advanced system settings → Control by mobile apps → Network access.' : `Roku returned ${response.status}. Check network control settings.`);
    const body=await response.text();
    if (body.length>1048576) throw new Error('TV response is too large.');
    return body;
  }
  async detect() {
    try { return /<device-info[\s>]/i.test(await this.exchange('/query/device-info')); } catch { return false; }
  }
  async connect() {
    const xml=await this.exchange('/query/device-info');
    if (!/<device-info[\s>]/i.test(xml)) throw new Error('This address did not report a Roku device.');
    this.keys={...ROKU_KEYS,...(tag(xml,'is-tv')==='true'?ROKU_TV_KEYS:{})};
    this.name=tag(xml,'friendly-device-name') || tag(xml,'user-device-name') || 'Roku';
    this.closed=false;
  }
  async register() {}
  capabilities() { return Object.keys(this.keys); }
  async command(name) {
    if (this.closed) throw new Error('Connect to your TV first.');
    const key=this.keys[name];
    if (!key) throw new Error('This control is not available on this Roku device.');
    await this.exchange('/keypress/'+key,true);
    if (name==='powerOff') this.close();
    return {ok:true};
  }
  async checkStatus() { if (!this.closed) try { await this.exchange('/query/device-info'); } catch { this.close(); } }
  close() { this.closed=true; }
}
module.exports={RokuClient};
