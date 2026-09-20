# Universal TV Remote for Android

An Android 8.0+ app that talks directly to supported TVs over Wi-Fi or a phone
hotspot. No laptop, account or internet service is needed for local control.

## Download and connect

1. [Download Universal TV Remote 2.0.0](https://github.com/arman0824/Universal-TV-Remote/releases/latest/download/Universal-TV-Remote-2.0.0.apk) on your phone.
2. Open the APK and tap **Install**. If Android asks, allow your browser or file manager to install this app.
3. Connect the TV and phone to the same Wi-Fi, or connect the TV to your phone's hotspot.
4. Open **Universal TV Remote → Connect TV → Scan network**. Select your TV.
5. If scanning does not find it, enter the TV's IP from its network settings and choose its **TV system**.
6. Follow the TV's pairing prompt or enter its displayed code.

You can also get the APK under **Assets** on the
[Releases page](https://github.com/arman0824/Universal-TV-Remote/releases).

| TV system | Pairing |
|---|---|
| Android TV / Google TV | Tap Connect first, then enter the six-character code, including any letters A–F. Android TV Remote Service v2 must be available. |
| Samsung | Choose Allow on the TV. The TV must support WebSocket remote control. |
| Roku | Enable Control by mobile apps → Network access in the TV's advanced system settings. No code. |
| webOS | Approve the TV prompt. |
| NetCast | Enter the six-digit code. |

The app disables buttons that its handler cannot send. Remaining buttons can
still vary by TV model or active input. A streaming player does not necessarily
control the display's volume or power. Fire TV, VIDAA, Apple TV and unsupported
proprietary systems are not included.

## Upgrading to version 2

Version 2 uses the new Android application ID `com.arman.tvremote`. It installs
as a separate app from the previous version. Pair your TVs once in the new app;
Android does not let it read the old app's private pairing store. You can remove
the old app yourself after checking that the new one works.

Pairing stays encrypted on this phone and is excluded from Android backup.
Future updates with this application ID and signing key keep that pairing.
webOS and Samsung reconnect by tapping Connect; the other handlers can restore
saved connections when the app opens. A changed TV IP or reset may require pairing again.

## Hotspot tips

Enable Mobile hotspot on the phone and connect the TV to it. The app can run on
that same phone or another phone connected to the hotspot. Use Manual IP if the
hotspot blocks discovery. If it isolates clients, use the hotspot phone or disable
isolation where available. It cannot reach an unrelated TV over mobile data alone.

## Build the APK

Requirements: Node.js, JDK 17, Android SDK platform 36 and build-tools 35.0.0.
Set `JAVA_HOME` and `ANDROID_HOME` for your installation, then run from the project
folder:

```sh
npm run android:build
```

Output: `android/app/build/outputs/apk/release/app-release.apk`.

The alternative SDK-only build also supports JDK 25:

```sh
npm run android:apk
```

Output: `outputs/Universal-TV-Remote-2.0.0.apk` and its SHA-256 checksum.
Both builds use the same source, bundled interface and local release signing key.
The APK contains no laptop pairing keys or ngrok credentials.

Keep `android/keystore/` and `android/signing.properties` backed up together.
They are private, ignored by Git, and needed to sign future app updates. The
builder reuses an existing valid signing setup, including one from an older version.

Builds recreate `work/`, `outputs/`, `android/app/src/main/assets/` and Android
build folders as needed. You can delete these generated files and `android/.gradle/`
when no build is running. Published APKs remain available on GitHub Releases.
Keep `android/keystore/` and `android/signing.properties`; they are needed to sign updates.

## Tests

```sh
cd android
./gradlew testDebugUnitTest lintRelease
./gradlew connectedDebugAndroidTest
```

The SDK-only path can test the actual release APK on a deliberately selected
emulator or device:

```sh
node scripts/android-smoke.js emulator-5554
```

For Android/Google TV pairing, Samsung and Roku checks against local simulators,
start this in one terminal on the computer running your Android emulator:

```sh
node scripts/tv-mock-server.js
```

Then run in another terminal:

```sh
node scripts/android-smoke.js emulator-5554 --protocol-mocks
```

The simulator listens only on the computer's loopback interface. The Android
emulator reaches it through `10.0.2.2`; this option is not for a physical phone.
Stop the simulator with Ctrl+C. Physical TV and hotspot compatibility still
needs testing on real devices.

## Architecture

The bundled WebView calls a native Java bridge. Network work runs off the UI
thread. SSDP and mDNS scan local interfaces; each TV uses a socket route matching
its subnet, including the phone's hotspot. Protocol handlers keep pairing and
commands separate for each TV system. The UI receives a supported-controls list.

Android TV uses an Android Keystore client certificate and verifies the displayed
code against both certificates before saving the TV certificate fingerprint.
Samsung and webOS save a TV certificate fingerprint after successful pairing.
A changed certificate requires forgetting the old pairing. Tokens and saved
pairing records are encrypted through Android Keystore.

See [protocol notes](../docs/PROTOCOLS.md) for ports and reference sources.
The app targets API 36. A future API 37+ target needs the applicable local-network
permission flow before it is released.
