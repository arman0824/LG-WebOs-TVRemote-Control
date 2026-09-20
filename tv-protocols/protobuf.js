// Small bounded codec for the integer and nested-message fields used by Remote v2.
const varint = value => {
  const bytes=[]; let n=value>>>0;
  do { bytes.push((n&127)|(n>127?128:0)); n>>>=7; } while(n);
  return Buffer.from(bytes);
};
function number(field,value) { return Buffer.concat([varint(field*8),varint(value)]); }
function bytes(field,value) { const data=Buffer.from(value); return Buffer.concat([varint(field*8+2),varint(data.length),data]); }
function readVarint(data,start=0) {
  let n=0;
  for(let i=0;i<5;i++) {
    if(start+i>=data.length) return null;
    const b=data[start+i]; n+=(b&127)*2**(7*i);
    if(!(b&128)) { if(n>0xffffffff) throw new Error('Invalid protobuf integer.'); return {value:n,end:start+i+1}; }
  }
  throw new Error('Invalid protobuf integer.');
}
function decode(data) {
  const out={}; let at=0;
  while(at<data.length) {
    const tag=readVarint(data,at); if(!tag||tag.value<8) throw new Error('Invalid TV message.');
    at=tag.end; const type=tag.value&7, field=tag.value>>>3;
    if(type===0) {const n=readVarint(data,at); if(!n) throw new Error('Truncated TV message.'); out[field]=n.value; at=n.end;}
    else if(type===2) {const len=readVarint(data,at); if(!len||len.value>1048576||len.end+len.value>data.length) throw new Error('Invalid TV message length.');out[field]=data.subarray(len.end,len.end+len.value);at=len.end+len.value;}
    else if(type===1||type===5) {at+=type===1?8:4; if(at>data.length) throw new Error('Truncated TV message.');}
    else throw new Error('Unsupported TV message encoding.');
  }
  return out;
}
module.exports={varint,number,bytes,decode,readVarint,join:(...parts)=>Buffer.concat(parts)};
