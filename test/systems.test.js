const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const tls=require('node:tls');
const crypto=require('node:crypto');
const {once}=require('node:events');
const {RokuClient}=require('../tv-protocols/roku');
const {SamsungClient}=require('../tv-protocols/samsung');
const {AndroidTvClient,Channel,outer}=require('../tv-protocols/androidtv');
const {identity,pairingSecret}=require('../tv-protocols/certificate');
const p=require('../tv-protocols/protobuf');
const {identifySystem,isLocalHost}=require('../tv-protocols/catalog');
const mdns=require('../tv-protocols/mdns');
const {decodeFrame}=require('../tv-protocols/websocket');
async function listen(server,t) {
  const sockets=new Set();server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{for(const s of sockets)s.destroy();server.close();});return server.address().port;
}
function wsFrame(message) {
  const data=Buffer.from(JSON.stringify(message));
  if(data.length<126)return Buffer.concat([Buffer.from([129,data.length]),data]);
  const head=Buffer.alloc(4);head[0]=129;head[1]=126;head.writeUInt16BE(data.length,2);return Buffer.concat([head,data]);
}
test('system classification never assumes every network TV is supported',()=>{
  for(const [text,expected] of [['Roku ECP','roku'],['Samsung TV','samsung'],['Android TV Remote','androidtv'],['webOS TV','webos'],['ROAP NetCast','netcast'],['Unknown MediaRenderer','auto'],['Sony television','auto']]) assert.equal(identifySystem(text),expected);
  assert.equal(isLocalHost('192.168.43.100'),true);assert.equal(isLocalHost('172.20.10.3'),true);
  for(const host of ['127.0.0.1','8.8.8.8','evil.test','192.168.1.256'])assert.equal(isLocalHost(host),false);
});
test('Roku detects the actual service, sends ECP keys, and distinguishes TV and player controls',async t=>{
  let television=true,denied=false;const requests=[];
  const port=await listen(http.createServer((req,res)=>{
    requests.push([req.method,req.url]);
    if(denied){res.writeHead(403);res.end();return;}
    res.end(req.url==='/query/device-info'?`<device-info><is-tv>${television}</is-tv><friendly-device-name>Living room</friendly-device-name></device-info>`:'');
  }),t);
  const client=new RokuClient({host:'127.0.0.1'},port);
  assert.equal(await client.detect(),true);await client.connect();assert.equal(client.closed,false);
  assert.ok(client.capabilities().includes('volumeUp'));await client.command('buttonHome');await client.command('volumeUp');
  assert.deepEqual(requests.slice(-2),[['POST','/keypress/Home'],['POST','/keypress/VolumeUp']]);
  await assert.rejects(client.command('digit'),/not available/);
  television=false;await client.connect();assert.ok(!client.capabilities().includes('volumeUp'));
  denied=true;await assert.rejects(client.command('buttonHome'),/Control by mobile apps/);await client.checkStatus();assert.equal(client.closed,true);
});
test('Samsung waits for TV approval and retains its token before sending commands',async t=>{
  const server=http.createServer();let peer;const messages=[];
  server.on('upgrade',(req,socket)=>{
    peer=socket;assert.match(req.url,/samsung.remote.control/);
    const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buffer=Buffer.alloc(0);socket.on('data',data=>{buffer=Buffer.concat([buffer,data]);let frame;while((frame=decodeFrame(buffer))){buffer=buffer.subarray(frame.bytes);if(frame.opcode===1)messages.push(JSON.parse(frame.payload));}});
  });
  const port=await listen(server,t);const client=new SamsungClient({host:'127.0.0.1'},{},{urls:[`ws://127.0.0.1:${port}`],timeout:1000});t.after(()=>client.close());
  await client.connect();assert.equal(client.closed,true);
  peer.write(wsFrame({event:'ms.channel.connect',data:{token:'test-token'}}));await client.register();assert.equal(client.clientKey,'test-token');assert.equal(client.closed,false);
  await client.command('volumeUp');await client.command('digit',{digit:'9'});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(messages[0].params.DataOfCmd,'KEY_VOLUP');assert.equal(messages[1].params.DataOfCmd,'KEY_9');
  await assert.rejects(client.command('digit',{digit:'99'}),/single digit/);
  await client.command('powerOff');assert.equal(client.closed,true);
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(messages.at(-1).params.DataOfCmd,'KEY_POWEROFF');
});
test('Samsung denial and close fail pairing without reporting connected',async t=>{
  const server=http.createServer();
  server.on('upgrade',(_req,socket)=>{socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');socket.write(wsFrame({event:'ms.channel.unauthorized'}));});
  const port=await listen(server,t);const client=new SamsungClient({host:'127.0.0.1'},{},{urls:[`ws://127.0.0.1:${port}`],timeout:1000});t.after(()=>client.close());
  await client.connect();await assert.rejects(client.register(),/refused pairing/);assert.equal(client.closed,true);
});
test('Android TV protobuf matches wire fields and rejects malformed lengths',()=>{
  assert.equal(p.join(p.number(1,2),p.number(2,200)).toString('hex'),'080210c801');
  assert.equal(p.bytes(10,p.join(p.number(1,3),p.number(2,3))).toString('hex'),'520408031003');
  assert.equal(p.decode(p.number(50,65535))[50],65535);
  assert.throws(()=>p.decode(Buffer.from([10,255,255,255,255,127])),/integer|length/);
  assert.throws(()=>p.decode(Buffer.from([10,10,1])),/length/);
  assert.equal(p.readVarint(Buffer.from([128])),null);
});
test('Android TV performs mutual TLS pairing, verifies code, negotiates control, answers pings and reconnects', {timeout:12000},async t=>{
  const tv=identity();assert.equal(new crypto.X509Certificate(tv.cert).verify(crypto.createPublicKey(tv.key)),true);
  let validCode,verified=false,pongs=0;const keys=[];
  const pairServer=tls.createServer({cert:tv.cert,key:tv.key,requestCert:true,rejectUnauthorized:false},socket=>{
    const channel=new Channel(socket);channel.listen(message=>{
      assert.equal(message[2],200);
      if(message[10])channel.send(outer(11,Buffer.alloc(0)));
      else if(message[20])channel.send(outer(20,Buffer.alloc(0)));
      else if(message[30]) {
        const tail='A1B2';const digest=pairingSecret(socket.getPeerCertificate().raw,tv.cert,'00'+tail);
        validCode=digest[0].toString(16).padStart(2,'0')+tail;
        // Split a protobuf length varint across TCP writes, including an unknown field.
        const ack=outer(31,Buffer.alloc(0));const padded=p.join(ack,p.bytes(99,Buffer.alloc(160)));
        const frame=p.join(p.varint(padded.length),padded);socket.write(frame.subarray(0,1));setTimeout(()=>socket.write(frame.subarray(1)),5);
      } else if(message[40]) {assert.deepEqual(p.decode(message[40])[1],pairingSecret(socket.getPeerCertificate().raw,tv.cert,validCode));verified=true;channel.send(outer(41,p.bytes(1,Buffer.alloc(0))));}
    });
  });
  const remoteServer=tls.createServer({cert:tv.cert,key:tv.key,requestCert:true,rejectUnauthorized:false},socket=>{
    const channel=new Channel(socket);
    channel.listen(message=>{
      if(message[1])channel.send(p.bytes(2,p.number(1,99)));
      else if(message[2]){channel.send(p.bytes(40,p.number(1,1)));channel.send(p.bytes(8,p.number(1,321)));}
      else if(message[9]){assert.equal(p.decode(message[9])[1],321);pongs++;}
      else if(message[10])keys.push(p.decode(message[10])[1]);
    });
    channel.send(p.bytes(1,p.number(1,99)));
  });
  const pairPort=await listen(pairServer,t),port=await listen(remoteServer,t);
  const client=new AndroidTvClient({host:'127.0.0.1'},{},{pairPort,port});t.after(()=>client.close());
  await client.startPairing();assert.equal(client.closed,true);
  const wrong=((parseInt(validCode.slice(0,2),16)+1)%256).toString(16).padStart(2,'0')+validCode.slice(2);
  await assert.rejects(client.finishPairing(wrong),/does not match/);assert.equal(verified,false);
  await client.finishPairing(validCode);assert.equal(verified,true);assert.equal(client.closed,false);
  await client.command('buttonHome');await client.command('digit',{digit:'9'});
  await new Promise(resolve=>setTimeout(resolve,50));assert.deepEqual(keys,[3,16]);assert.equal(pongs,1);
  const saved={credentials:client.credentials,pin:client.pin};client.close();
  const next=new AndroidTvClient({host:'127.0.0.1'},saved,{port});t.after(()=>next.close());await next.connect();assert.equal(next.closed,false);
  await next.command('powerOff');assert.equal(next.closed,true);
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(keys.at(-1),223);
  const changed=new AndroidTvClient({host:'127.0.0.1'},{...saved,pin:'wrong'},{port});t.after(()=>changed.close());await assert.rejects(changed.connect(),/certificate changed/);
});
test('Android TV mDNS handles compressed service names and ignores unrelated packets',()=>{
  const query=mdns.query();const header=Buffer.from(query.subarray(0,12));header[2]=128;header.writeUInt16BE(1,6);
  const ptr=Buffer.from([0xc0,12,0,12,0,1,0,0,0,60,0,10]);
  const data=Buffer.concat([header,query.subarray(12),ptr,Buffer.from([7]),Buffer.from('Bedroom'),Buffer.from([0xc0,12])]);
  assert.equal(mdns.response(data),'Bedroom');assert.equal(mdns.response(Buffer.from('HTTP/1.1 200 OK')),null);
  assert.equal(mdns.response(data.subarray(0,data.length-1)),null);
});
