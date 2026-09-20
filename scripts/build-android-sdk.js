// Reproducible SDK-only build for this Java app, useful without Gradle/Android Studio.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sdk = process.env.ANDROID_HOME || '/opt/homebrew/share/android-commandlinetools';
const bt = path.join(sdk, 'build-tools/35.0.0');
const androidJar = path.join(sdk, 'platforms/android-36/android.jar');
const work = path.join(root, 'work/android-tools');
const build = path.join(work, 'sdk-build');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status}).`);
}
for (const file of [androidJar, path.join(bt, 'aapt2'), path.join(bt, 'apksigner')]) {
  if (!fs.existsSync(file)) throw new Error(`Missing Android SDK component: ${file}`);
}
run(process.execPath, ['scripts/prepare-android.js']);
run(process.execPath, ['scripts/android-signing.js']);
fs.mkdirSync(build, { recursive: true });
fs.mkdirSync(path.join(work, 'deps'), { recursive: true });
const deps = [
  ['okhttp.jar', 'com/squareup/okhttp3/okhttp/4.12.0/okhttp-4.12.0.jar'],
  ['okio.jar', 'com/squareup/okio/okio-jvm/3.6.0/okio-jvm-3.6.0.jar'],
  ['kotlin-stdlib.jar', 'org/jetbrains/kotlin/kotlin-stdlib/1.9.10/kotlin-stdlib-1.9.10.jar'],
  ['annotations.jar', 'org/jetbrains/annotations/13.0/annotations-13.0.jar']
].map(([name, coordinate]) => {
  const file = path.join(work, 'deps', name);
  if (!fs.existsSync(file)) run('curl', ['-fLsS', '--retry', '3', '-o', file, `https://repo.maven.apache.org/maven2/${coordinate}`]);
  return file;
});
for (const dir of ['classes', 'dex', 'generated']) {
  fs.rmSync(path.join(build, dir), { recursive: true, force: true });
  fs.mkdirSync(path.join(build, dir));
}
run(path.join(bt, 'aapt2'), ['compile', '--dir', 'android/app/src/main/res', '-o', path.join(build, 'resources.zip')]);
const unsigned = path.join(build, 'unsigned.apk');
const manifest = path.join(build, 'AndroidManifest.xml');
fs.writeFileSync(manifest, fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8').replace('<manifest ', '<manifest package="com.arman.lgremote" '));
run(path.join(bt, 'aapt2'), ['link', '-o', unsigned, '-I', androidJar, '--manifest', manifest,
  '--min-sdk-version', '26', '--target-sdk-version', '36', '--version-code', '3', '--version-name', '1.0.2',
  '--java', path.join(build, 'generated'), '-A', 'android/app/src/main/assets', path.join(build, 'resources.zip')]);
const source = path.join(root, 'android/app/src/main/java/com/arman/lgremote');
const sources = fs.readdirSync(source).filter(name => name.endsWith('.java')).map(name => path.join(source, name));
run('javac', ['--release', '17', '-encoding', 'UTF-8', '-classpath', [androidJar, ...deps].join(path.delimiter), '-d', path.join(build, 'classes'), ...sources]);
const classesJar = path.join(build, 'classes.jar');
run('jar', ['cf', classesJar, '-C', path.join(build, 'classes'), '.']);
run(path.join(bt, 'd8'), ['--release', '--min-api', '26', '--lib', androidJar, '--output', path.join(build, 'dex'), classesJar, ...deps]);
const dexFiles = fs.readdirSync(path.join(build, 'dex')).filter(name => name.endsWith('.dex')).map(name => path.join(build, 'dex', name));
run('zip', ['-q', '-j', unsigned, ...dexFiles]);
const aligned = path.join(build, 'aligned.apk');
run(path.join(bt, 'zipalign'), ['-f', '-p', '4', unsigned, aligned]);
const props = Object.fromEntries(fs.readFileSync(path.join(root, 'android/signing.properties'), 'utf8').trim().split('\n').map(line => {
  const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
}));
const output = path.join(root, 'outputs/LG-Remote-1.0.2.apk');
fs.mkdirSync(path.dirname(output), { recursive: true });
run(path.join(bt, 'apksigner'), ['sign', '--ks', path.join(root, 'android', props.storeFile), '--ks-key-alias', props.keyAlias,
  '--ks-pass', 'env:LG_APK_STORE_PASS', '--key-pass', 'env:LG_APK_KEY_PASS', '--out', output, aligned], {
    env: { ...process.env, LG_APK_STORE_PASS: props.storePassword, LG_APK_KEY_PASS: props.keyPassword }
  });
run(path.join(bt, 'apksigner'), ['verify', '--verbose', output]);
const hash = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
fs.writeFileSync(output + '.sha256', `${hash}  ${path.basename(output)}\n`);
console.log(`Built ${output}`);
