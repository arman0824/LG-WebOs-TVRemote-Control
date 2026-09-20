// Creates a persistent local signing key. Keep the ignored keystore and properties
// together: Android requires this same key when installing future app updates.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../android');
const props = path.join(root, 'signing.properties');
const directory = path.join(root, 'keystore');
const store = path.join(directory, 'tv-remote-release.jks');
if (fs.existsSync(props)) {
  const stored = fs.readFileSync(props, 'utf8').match(/^storeFile=(.+)$/m);
  if (!stored || !fs.existsSync(path.join(root, stored[1].trim()))) throw new Error('Restore the keystore named in signing.properties before building.');
  console.log('Using the existing local APK signing key.');
  process.exit(0);
}
if (fs.existsSync(props) || fs.existsSync(store)) throw new Error('Incomplete signing setup. Restore the matching keystore and signing.properties before building.');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const password = crypto.randomBytes(32).toString('hex');
const result = spawnSync('keytool', ['-genkeypair', '-keystore', store, '-storetype', 'JKS', '-alias', 'tv-remote', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Universal TV Remote, OU=Family Remote', '-storepass:env', 'TV_APK_SIGN_PASS', '-keypass:env', 'TV_APK_SIGN_PASS'], {
  env: { ...process.env, TV_APK_SIGN_PASS: password }, encoding: 'utf8'
});
if (result.status !== 0) throw new Error(result.stderr || 'Could not create the APK signing key.');
fs.chmodSync(store, 0o600);
fs.writeFileSync(props, `storeFile=keystore/tv-remote-release.jks\nstorePassword=${password}\nkeyAlias=tv-remote\nkeyPassword=${password}\n`, { mode: 0o600 });
console.log('Created a private, reusable release signing key.');
