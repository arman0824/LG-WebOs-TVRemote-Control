const crypto=require('node:crypto');
function der(tag,...parts) {
  const body=Buffer.concat(parts.map(p=>Buffer.from(p))); let length;
  if(body.length<128) length=Buffer.from([body.length]);
  else {let hex=body.length.toString(16); if(hex.length%2)hex='0'+hex;const b=Buffer.from(hex,'hex');length=Buffer.concat([Buffer.from([128+b.length]),b]);}
  return Buffer.concat([Buffer.from([tag]),length,body]);
}
function identity() {
  const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const algorithm=Buffer.from('300d06092a864886f70d01010b0500','hex');
  const name=der(0x30,der(0x31,der(0x30,Buffer.from('0603550403','hex'),der(0x0c,Buffer.from('Universal TV Remote')))));
  const date=d=>der(0x18,Buffer.from(d.toISOString().replace(/[-:T]/g,'').replace(/\.\d{3}Z$/,'Z')));
  const serial=crypto.randomBytes(16);serial[0]&=127;serial[0]|=1;
  const tbs=der(0x30,Buffer.from('a003020102','hex'),der(2,serial),algorithm,name,
    der(0x30,date(new Date(Date.now()-86400000)),date(new Date(Date.now()+10*365*86400000))),name,
    publicKey.export({format:'der',type:'spki'}));
  const cert=der(0x30,tbs,algorithm,der(3,Buffer.from([0]),crypto.sign('sha256',tbs,privateKey)));
  return {cert:'-----BEGIN CERTIFICATE-----\n'+cert.toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END CERTIFICATE-----\n',key:privateKey.export({format:'pem',type:'pkcs8'})};
}
function pairingSecret(clientCert,serverCert,code) {
  if(!/^[0-9a-f]{6}$/i.test(code)) throw new Error('Enter all six letters/numbers shown on the TV.');
  const parts=[];
  for(const cert of [clientCert,serverCert]) {
    const key=new crypto.X509Certificate(cert).publicKey.export({format:'jwk'});
    if(key.kty!=='RSA') throw new Error('The TV returned an unsupported pairing certificate.');
    parts.push(Buffer.from(key.n,'base64url'),Buffer.from(key.e,'base64url'));
  }
  return crypto.createHash('sha256').update(Buffer.concat([...parts,Buffer.from(code.slice(2),'hex')])).digest();
}
module.exports={identity,pairingSecret};
