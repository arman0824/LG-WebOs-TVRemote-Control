// Run the SDK-only smoke test on a deliberately selected Android emulator/device.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sdk = process.env.ANDROID_HOME || '/opt/homebrew/share/android-commandlinetools';
const bt = path.join(sdk, 'build-tools/35.0.0');
const androidJar = path.join(sdk, 'platforms/android-36/android.jar');
const serial = process.argv[2];
if (!serial) throw new Error('Pass the adb serial of the emulator or test phone.');
const build = path.join(root, 'work/android-tools/sdk-build');
const test = path.join(build, 'smoke');
fs.mkdirSync(path.join(test, 'classes'), { recursive: true });
fs.mkdirSync(path.join(test, 'dex'), { recursive: true });
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed.`);
  return result;
}
fs.writeFileSync(path.join(test, 'AndroidManifest.xml'), `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.arman.lgremote.smoketest"><uses-sdk android:minSdkVersion="26" android:targetSdkVersion="36"/><application android:label="LG Remote Tests"/><instrumentation android:name="com.arman.lgremote.SmokeInstrumentation" android:targetPackage="com.arman.lgremote"/></manifest>`);
const unsigned = path.join(test, 'unsigned.apk');
run(path.join(bt, 'aapt2'), ['link', '-o', unsigned, '-I', androidJar, '--manifest', path.join(test, 'AndroidManifest.xml')]);
run('javac', ['--release', '17', '-classpath', [androidJar, path.join(build, 'classes')].join(path.delimiter), '-d', path.join(test, 'classes'), 'android/app/src/sdkTest/java/com/arman/lgremote/SmokeInstrumentation.java']);
run('jar', ['cf', path.join(test, 'test.jar'), '-C', path.join(test, 'classes'), '.']);
run(path.join(bt, 'd8'), ['--min-api', '26', '--lib', androidJar, '--classpath', path.join(build, 'classes.jar'), '--output', path.join(test, 'dex'), path.join(test, 'test.jar')]);
run('zip', ['-q', '-j', unsigned, path.join(test, 'dex/classes.dex')]);
const aligned = path.join(test, 'aligned.apk');
run(path.join(bt, 'zipalign'), ['-f', '4', unsigned, aligned]);
const props = Object.fromEntries(fs.readFileSync(path.join(root, 'android/signing.properties'), 'utf8').trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
const apk = path.join(test, 'smoke.apk');
run(path.join(bt, 'apksigner'), ['sign', '--ks', path.join(root, 'android', props.storeFile), '--ks-key-alias', props.keyAlias, '--ks-pass', 'env:LG_APK_STORE_PASS', '--key-pass', 'env:LG_APK_KEY_PASS', '--out', apk, aligned], { env: { ...process.env, LG_APK_STORE_PASS: props.storePassword, LG_APK_KEY_PASS: props.keyPassword } });
const adb = path.join(sdk, 'platform-tools/adb');
run(adb, ['-s', serial, 'install', '-r', 'outputs/LG-Remote-1.0.0.apk']);
run(adb, ['-s', serial, 'install', '-r', apk]);
const result = run(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', 'com.arman.lgremote.smoketest/com.arman.lgremote.SmokeInstrumentation'], { encoding: 'utf8', stdio: 'pipe' });
console.log(result.stdout);
if (!result.stdout.includes('PASS:')) throw new Error('Android smoke tests failed.');
