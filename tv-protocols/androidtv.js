const tls=require('node:tls');
const crypto=require('node:crypto');
const p=require('./protobuf');
const {identity,pairingSecret}=require('./certificate');
const {ANDROID_KEYS,digitKey}=require('./catalog');
const outer=(field,body)=>p.join(p.number(1,2),p.number(2,200),p.bytes(field,body));
class Channel {
  constructor(socket) {
    this.socket=socket;this.buffer=Buffer.alloc(0);this.queue=[];this.waiters=[];this.failure=null;this.handler=null;
    socket.on('data',data=>{
      try {
        this.buffer=Buffer.concat([this.buffer,data]);
        if(this.buffer.length>2097152) throw new Error('TV message is too large.');
        while(this.buffer.length) {
          const size=p.readVarint(this.buffer);if(!size)break;
          if(size.value>1048576)throw new Error('TV message is too large.');
          if(this.buffer.length<size.end+size.value)break;
          const message=p.decode(this.buffer.subarray(size.end,size.end+size.value));
          this.buffer=this.buffer.subarray(size.end+size.value);
          if(this.handler)this.handler(message);else{this.queue.push(message);if(this.queue.length>32)throw new Error('Too many unexpected TV messages.');this.flush();}
        }
      }catch(error){this.fail(error);socket.destroy();}
    });
    socket.on('error',error=>this.fail(error));
    socket.on('close',()=>this.fail(new Error('TV connection closed. Reconnect or pair again.')));
  }
  fail(error) {if(this.failure)return;this.failure=error;for(const w of this.waiters){clearTimeout(w.timer);w.reject(error);}this.waiters=[];}
  flush() {
    for(const w of [...this.waiters]) {
      const index=this.queue.findIndex(m=>m[w.field]!==undefined || m[2]!==undefined&&typeof m[2]==='number'&&m[2]!==200);
      if(index<0)continue;
      const message=this.queue.splice(index,1)[0];this.waiters.splice(this.waiters.indexOf(w),1);clearTimeout(w.timer);
      if(typeof message[2]==='number'&&message[2]!==200)w.reject(new Error('TV rejected the pairing code. Start pairing again.'));else w.resolve(message);
    }
  }
  wait(field,timeout=10000) {
    if(this.failure)return Promise.reject(this.failure);
    return new Promise((resolve,reject)=>{
      const waiter={field,resolve,reject};waiter.timer=setTimeout(()=>{this.waiters=this.waiters.filter(w=>w!==waiter);reject(new Error('The TV did not answer. Check Android TV Remote Service and try again.'));},timeout);
      this.waiters.push(waiter);this.flush();
    });
  }
  send(message,callback) {if(this.failure)throw this.failure;this.socket.write(p.join(p.varint(message.length),message),callback);}
  async exchange(field,message) {const reply=this.wait(field);this.send(message);return reply;}
  listen(handler) {this.handler=handler;for(const m of this.queue.splice(0))handler(m);}
  close() {this.fail(new Error('TV connection closed.'));this.socket.destroy();}
}
class AndroidTvClient {
  constructor(device,saved={},options={}) {
    this.host=device.host;this.protocol='androidtv';this.credentials=saved.credentials||identity();this.pin=saved.pin||'';
    this.clientKey='';this.options=options;this.channel=null;this.pairing=null;this.ready=false;
  }
  get closed(){return !this.ready||!this.channel||!!this.channel.failure;}
  async open(port,pin='') {
    const socket=tls.connect({host:this.host,port,cert:this.credentials.cert,key:this.credentials.key,rejectUnauthorized:false,minVersion:'TLSv1.2'});
    const channel=new Channel(socket);
    try {
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{socket.destroy();reject(new Error('Cannot reach Android TV Remote Service. Check the TV IP and network.'));},5000);
        socket.once('secureConnect',()=>{clearTimeout(timer);resolve();});socket.once('error',e=>{clearTimeout(timer);reject(e);});
      });
      channel.peer=socket.getPeerCertificate().raw;
      channel.pin=crypto.createHash('sha256').update(channel.peer).digest('hex');
      if(pin && pin!==channel.pin)throw new Error('The TV certificate changed. Forget its saved pairing and pair again.');
      return channel;
    }catch(error){channel.close();throw error;}
  }
  async startPairing() {
    this.pairing=await this.open(this.options.pairPort||6467);
    const c=this.pairing,encoding=p.join(p.number(1,3),p.number(2,6));
    await c.exchange(11,outer(10,p.join(p.bytes(1,'atvremote'),p.bytes(2,'Universal TV Remote'))));
    await c.exchange(20,outer(20,p.join(p.bytes(1,encoding),p.number(3,1))));
    await c.exchange(31,outer(30,p.join(p.bytes(1,encoding),p.number(2,1))));
    this.expiry=setTimeout(()=>c.close(),120000);this.expiry.unref?.();
  }
  async finishPairing(code) {
    if(!this.pairing||this.pairing.failure)throw new Error('Pairing expired. Tap Connect to request a new code.');
    const secret=pairingSecret(this.credentials.cert,this.pairing.peer,code);
    if(secret[0]!==parseInt(code.slice(0,2),16))throw new Error('That code does not match the TV. Check all six characters.');
    await this.pairing.exchange(41,outer(40,p.bytes(1,secret)));
    this.pin=this.pairing.pin;clearTimeout(this.expiry);this.pairing.close();this.pairing=null;
    await this.connect();
  }
  async connect() {
    this.channel=await this.open(this.options.port||6466,this.pin);
    const c=this.channel;let features=1|2|32|64;
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{reject(new Error('Android TV did not finish the remote handshake. Pair again if needed.'));c.close();},10000);
      const failed=error=>{clearTimeout(timer);reject(error);};
      c.socket.once('close',()=>failed(new Error('TV refused the saved pairing. Forget its key and pair again.')));
      c.socket.once('error',failed);
      c.listen(message=>{
        try {
          if(message[1]) {
            const config=p.decode(message[1]);features &= config[1]||0;
            if(!(features&2))throw new Error('This TV does not expose remote key control.');
            c.send(p.bytes(1,p.join(p.number(1,features),p.bytes(2,p.join(p.number(3,1),p.bytes(4,'1'),p.bytes(5,'tvremote'),p.bytes(6,'2.0.0'))))));
          } else if(message[2])c.send(p.bytes(2,p.number(1,features)));
          else if(message[8])c.send(p.bytes(9,p.number(1,p.decode(message[8])[1]||0)));
          else if(message[40]){clearTimeout(timer);this.ready=true;resolve();}
          else if(message[3])throw new Error('TV refused the remote request. Reconnect to try again.');
        }catch(error){failed(error);c.close();}
      });
      c.socket.setTimeout(20000,()=>c.close());
    });
  }
  capabilities(){return [...Object.keys(ANDROID_KEYS),'digit'];}
  async command(name,payload={}) {
    if(this.closed)throw new Error('Connect to your TV first.');
    const key=name==='digit'?digitKey(payload.digit,'',7):ANDROID_KEYS[name];
    if(key==null)throw new Error('This control is not available on Android / Google TV.');
    await new Promise((resolve,reject)=>this.channel.send(p.bytes(10,p.join(p.number(1,key),p.number(2,3))),error=>error?reject(error):resolve()));
    if(name==='powerOff')this.close();
    return {ok:true};
  }
  close(){clearTimeout(this.expiry);this.ready=false;this.channel?.close();this.pairing?.close();}
}
module.exports={AndroidTvClient,Channel,outer};
