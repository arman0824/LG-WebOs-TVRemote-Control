const net=require('node:net');
const {NetcastClient}=require('../netcast');
const {RokuClient}=require('./roku');
const {SamsungClient}=require('./samsung');
const {SYSTEMS}=require('./catalog');
function portOpen(host,port) {
  return new Promise(resolve=>{const socket=net.createConnection({host,port});const finish=value=>{socket.destroy();resolve(value);};socket.setTimeout(1200,()=>finish(false));socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));});
}
async function detectSystem(device,saved={}) {
  const requested=device.protocol||'auto';
  if(!SYSTEMS.includes(requested))throw new Error('Choose a supported TV system.');
  if(requested!=='auto')return requested;
  if(SYSTEMS.includes(saved.protocol)&&saved.protocol!=='auto')return saved.protocol;
  const [roku,samsung,netcast,androidtv,webos]=await Promise.all([
    new RokuClient(device).detect(),new SamsungClient(device).detect(),new NetcastClient(device).detect(),
    portOpen(device.host,6466),Promise.all([portOpen(device.host,3000),portOpen(device.host,3001)]).then(p=>p.some(Boolean))
  ]);
  if(roku)return 'roku';if(samsung)return 'samsung';if(netcast)return 'netcast';if(androidtv)return 'androidtv';if(webos)return 'webos';
  throw new Error('No supported remote service found. Check the TV IP and network settings, or select its TV system. A Wi-Fi connection alone does not make every TV compatible.');
}
module.exports={detectSystem,portOpen};
