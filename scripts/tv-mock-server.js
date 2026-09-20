// Loopback-only protocol simulators for the Android emulator. No real TV commands.
const http=require('node:http');
const tls=require('node:tls');
const crypto=require('node:crypto');
const {identity,pairingSecret}=require('../tv-protocols/certificate');
const {Channel,outer}=require('../tv-protocols/androidtv');
const {decodeFrame}=require('../tv-protocols/websocket');
const p=require('../tv-protocols/protobuf');
const tv=identity();let code='';const commands={androidtv:[],samsung:[],roku:[]};
const pairing=tls.createServer({cert:tv.cert,key:tv.key,requestCert:true,rejectUnauthorized:false,maxVersion:'TLSv1.2'},socket=>{
  const c=new Channel(socket);c.listen(m=>{
    if(m[10])c.send(outer(11,Buffer.alloc(0)));
    else if(m[20])c.send(outer(20,Buffer.alloc(0)));
    else if(m[30]){const hash=pairingSecret(socket.getPeerCertificate().raw,tv.cert,'00A1B2');code=hash[0].toString(16).padStart(2,'0')+'A1B2';c.send(outer(31,Buffer.alloc(0)));}
    else if(m[40]){
      const good=p.decode(m[40])[1].equals(pairingSecret(socket.getPeerCertificate().raw,tv.cert,code));
      c.send(good?outer(41,p.bytes(1,Buffer.alloc(0))):p.join(p.number(1,2),p.number(2,402)));
    }
  });
});
const remote=tls.createServer({cert:tv.cert,key:tv.key,requestCert:true,rejectUnauthorized:false,maxVersion:'TLSv1.2'},socket=>{
  const c=new Channel(socket);c.listen(m=>{
    if(m[1])c.send(p.bytes(2,p.number(1,99)));
    else if(m[2]){c.send(p.bytes(40,p.number(1,1)));c.send(p.bytes(8,p.number(1,10)));}
    else if(m[10])commands.androidtv.push(p.decode(m[10])[1]);
  });c.send(p.bytes(1,p.number(1,99)));
});
const samsung=http.createServer((_req,res)=>res.end(JSON.stringify({type:'Samsung SmartTV'})));
samsung.on('upgrade',(req,socket)=>{
  const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const approved=Buffer.from(JSON.stringify({event:'ms.channel.connect',data:{token:'emulator-token'}}));socket.write(Buffer.concat([Buffer.from([129,approved.length]),approved]));
  let buffer=Buffer.alloc(0);socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);let frame;while((frame=decodeFrame(buffer))){buffer=buffer.subarray(frame.bytes);if(frame.opcode===1)commands.samsung.push(JSON.parse(frame.payload).params.DataOfCmd);else if(frame.opcode===8)socket.end(Buffer.from([136,0]));}});
});
const roku=http.createServer((req,res)=>{if(req.url.startsWith('/keypress/'))commands.roku.push(req.url);res.end('<device-info><is-tv>true</is-tv><friendly-device-name>Test TV</friendly-device-name></device-info>');});
const inspection=http.createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code,commands}));});
for(const [server,port] of [[pairing,6467],[remote,6466],[samsung,8001],[roku,8060],[inspection,16480]]){
 server.on('error',error=>{console.error(error.message);process.exit(1);});server.listen(port,'127.0.0.1');
}
console.log('Protocol mocks listening on loopback; emulator host alias is 10.0.2.2.');
