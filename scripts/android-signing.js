// Creates a persistent local signing key. Keep the ignored keystore and properties
// together: Android requires this same key when installing future app updates.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../android');
const props = path.join(root, 'signing.properties');
const directory = path.join(root, 'keystore');
const store = path.join(directory, 'lg-remote-release.jks');
if (fs.existsSync(props) && fs.existsSync(store)) {
  console.log('Using the existing local APK signing key.');
  process.exit(0);
}
if (fs.existsSync(props) || fs.existsSync(store)) throw new Error('Incomplete signing setup. Restore the matching keystore and signing.properties before building.');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const password = crypto.randomBytes(32).toString('hex');
const result = spawnSync('keytool', ['-genkeypair', '-keystore', store, '-storetype', 'JKS', '-alias', 'lg-remote', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=LG Remote, OU=Family Remote', '-storepass:env', 'LG_APK_SIGN_PASS', '-keypass:env', 'LG_APK_SIGN_PASS'], {
  env: { ...process.env, LG_APK_SIGN_PASS: password }, encoding: 'utf8'
});
if (result.status !== 0) throw new Error(result.stderr || 'Could not create the APK signing key.');
fs.chmodSync(store, 0o600);
fs.writeFileSync(props, `storeFile=keystore/lg-remote-release.jks\nstorePassword=${password}\nkeyAlias=lg-remote\nkeyPassword=${password}\n`, { mode: 0o600 });
console.log('Created a private, reusable release signing key.');
