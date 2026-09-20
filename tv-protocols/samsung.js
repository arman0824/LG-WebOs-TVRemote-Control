const { TinyWebSocket } = require('./websocket');
const { SAMSUNG_KEYS, digitKey } = require('./catalog');
class SamsungClient {
  constructor(device, saved={}, options={}) {
    this.host=device.host; this.protocol='samsung'; this.clientKey=saved.key||''; this.pin=saved.pin||'';
    this.options=options; this.ws=null; this.authorized=false;
  }
  get closed() { return !this.authorized || !this.ws || this.ws.closed; }
  async detect() {
    try {
      const res=await fetch(`http://${this.host}:8001/api/v2/`,{redirect:'error',signal:AbortSignal.timeout(1800)});
      const data=await res.json();
      return /samsung/i.test(`${data.type||''} ${data.device?.type||''}`);
    } catch { return false; }
  }
  async connect() {
    let last;
    for (const endpoint of this.options.urls || [`wss://${this.host}:8002`,`ws://${this.host}:8001`]) {
      const url=new URL('/api/v2/channels/samsung.remote.control',endpoint);
      url.searchParams.set('name',Buffer.from('Universal TV Remote').toString('base64'));
      if (url.protocol==='wss:' && this.clientKey) url.searchParams.set('token',this.clientKey);
      const ws=new TinyWebSocket(url,{pin:this.pin}); this.ws=ws;
      this.approval=new Promise((resolve,reject)=>{
        const finish=(error,message)=>{
          clearTimeout(timer); offMessage(); offClose();
          if (error) { reject(error); return; }
          this.clientKey=String(message.data?.token||this.clientKey);
          this.pin=ws.peerPin||''; this.authorized=true; resolve();
        };
        const timer=setTimeout(()=>{finish(new Error('Pairing timed out. Choose Allow on the TV, then try again.')); ws.close();},this.options.timeout||90000);
        const offMessage=ws.onMessage(text=>{
          let message; try { message=JSON.parse(text); } catch { return; }
          if (message.event==='ms.channel.connect') finish(null,message);
          else if (['ms.channel.unauthorized','ms.channel.timeOut','ms.error'].includes(message.event)) finish(new Error('The TV refused pairing. Allow Universal TV Remote on the TV, or forget its saved key and try again.'));
        });
        const offClose=ws.onClose(error=>finish(error));
      });
      this.approval.catch(()=>{});
      try { await ws.connect(); return; }
      catch (error) { ws.close(); last=error; if (error.code==='CERT_CHANGED') throw error; }
    }
    throw new Error('Cannot reach the Samsung remote service. Check its IP, power and network access. '+(last?.message||''));
  }
  async register() { await this.approval; }
  capabilities() { return [...Object.keys(SAMSUNG_KEYS),'digit']; }
  async command(name,payload={}) {
    if (this.closed) throw new Error('Connect to your TV first.');
    const key=name==='digit'?digitKey(payload.digit,'KEY_'):SAMSUNG_KEYS[name];
    if (!key) throw new Error('This control is not available on this Samsung TV.');
    await new Promise((resolve,reject)=>this.ws.sendText(JSON.stringify({method:'ms.remote.control',params:{Cmd:'Click',DataOfCmd:key,Option:'false',TypeOfRemote:'SendRemoteKey'}}),error=>error?reject(error):resolve()));
    if (name==='powerOff') this.close();
    return {ok:true};
  }
  close() { this.authorized=false; this.ws?.close(); }
}
module.exports={SamsungClient};
