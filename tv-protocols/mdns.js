const SERVICE='_androidtvremote2._tcp.local';
function query() {
  const header=Buffer.alloc(12);header.writeUInt16BE(1,4);
  const labels=SERVICE.split('.').flatMap(s=>[Buffer.from([s.length]),Buffer.from(s)]);
  return Buffer.concat([header,...labels,Buffer.from([0,0,12,128,1])]);
}
function nameAt(data,start,depth=0) {
  if(depth>20)throw new Error('DNS name loop.');let at=start;const labels=[];
  while(at<data.length) {
    const size=data[at++];if(size===0)return {name:labels.join('.'),end:at};
    if((size&192)===192){if(at>=data.length)throw new Error('Truncated DNS name.');const target=((size&63)<<8)|data[at++];labels.push(nameAt(data,target,depth+1).name);return {name:labels.join('.'),end:at};}
    if(size>63||at+size>data.length)throw new Error('Invalid DNS name.');labels.push(data.toString('utf8',at,at+size));at+=size;
  }
  throw new Error('Truncated DNS name.');
}
function response(data) {
  try {
    if(data.length<12||!(data[2]&128))return null;
    let at=12;const q=data.readUInt16BE(4),records=data.readUInt16BE(6)+data.readUInt16BE(8)+data.readUInt16BE(10);
    if(q>32||records>128)return null;
    for(let i=0;i<q;i++)at=nameAt(data,at).end+4;
    for(let i=0;i<records;i++){
      const owner=nameAt(data,at);at=owner.end;
      if(at+10>data.length)return null;
      const type=data.readUInt16BE(at),length=data.readUInt16BE(at+8);at+=10;
      if(at+length>data.length)return null;
      let name=owner.name;
      if(type===12&&owner.name===SERVICE)name=nameAt(data,at).name;
      if((type===12||type===33)&&name.endsWith('.'+SERVICE))return name.slice(0,-SERVICE.length-1)||'Android / Google TV';
      at+=length;
    }
  } catch { }
  return null;
}
module.exports={query,response,SERVICE};
