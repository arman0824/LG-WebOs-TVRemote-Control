# LG Remote for Android

An Android 8.0+ app that bundles the existing remote interface and communicates
directly with LG TVs through native Android networking. No desktop server,
ngrok account, internet hosting, or login is needed for local TV control.

## Install and connect

1. Copy `outputs/LG-Remote-1.0.0.apk` from the project folder to your Android phone.
2. Open it and allow that browser or file manager to install this APK when Android asks.
3. Open **LG Remote**. Connect the phone and powered-on TV to the same Wi-Fi.
4. Select **Connect TV → Scan network**, then select your TV. If discovery is
   blocked by the router, enter the TV's IPv4 address from its network settings.
5. On NetCast TVs such as the LG 32LB582B, enter the six-digit code displayed on
   the TV and tap **Pair TV**. On webOS, approve the TV's connection prompt.

Pairing is stored on this phone, encrypted with an Android Keystore key, and
excluded from Android backup. Each installed phone pairs with its TV once.
NetCast reconnects to its saved TV when the app opens. For webOS, tap Connect
again to reconnect using its saved key. If the TV's IP changes, scan and select
its new address. A TV reset, revoked key, or app uninstall can require pairing again.

The app supports the existing number pad, navigation, volume/channel controls,
media controls and extended buttons. TV-specific functions depend on the model
and active input. Power turns the TV off; network wake is not implemented.
This APK is a local remote; internet family sharing remains in the desktop app.

## Build

Requirements: Node.js, JDK 17, Android SDK platform 36 and build-tools 35.0.0.
Set `JAVA_HOME` to JDK 17 and `ANDROID_HOME` to the SDK directory, or use Android
Studio with those versions. Then, from the project root:

```sh
npm run android:build
```

For a build using the Android SDK tools directly, without downloading Gradle:

```sh
npm run android:apk
```

This SDK-only path also supports JDK 25, compiles with `--release 17`, and puts the
signed APK plus a SHA-256 checksum in `outputs/`. Both build paths use the same
application source, UI assets and release signing key.

After an SDK-only build, run `node scripts/android-smoke.js emulator-5554` to
install the actual release APK on that emulator and check its bundled UI, native
bridge, validation and encrypted pairing storage. Replace the serial with the
intended device from `adb devices` when testing on a phone.

The build copies only the three public UI files, Android-specific UI adapters,
and command maps into the APK. It never packages desktop pairing keys, ngrok
credentials, or server configuration. Output:
`android/app/build/outputs/apk/release/app-release.apk`.

The first build creates a private release signing key in `android/keystore/`
and its credentials in `android/signing.properties`. **Back up both together**
to retain the ability to install future versions over this APK. These are ignored
by Git and must never be included in the APK or shared with family members.

```sh
cd android
./gradlew testDebugUnitTest lintRelease
# With an emulator or USB-debugging phone connected:
./gradlew connectedDebugAndroidTest
```

The WebView loads only bundled assets from a fixed local origin; external page
loads are blocked. An asynchronous native bridge runs network work off the UI
thread. Discovery uses SSDP on Wi-Fi; NetCast uses HTTP on port 8080 and webOS
uses WebSockets on 3001/3000. The selected IP must be a private/local IPv4 address.
For webOS self-signed TLS, the first successfully paired TV certificate is pinned;
a certificate change requires forgetting and pairing the TV again.

This app targets Android API 36. Before upgrading the target to API 37+, implement
the new `ACCESS_LOCAL_NETWORK` runtime permission flow and test it on that version.

LG Remote is an independent project and is not affiliated with LG Electronics.

## Validation for version 1.0.0

The release APK was built with the SDK-only build, signature-verified, installed
and tested in an Android 11 ARM64 emulator. On-device checks passed for initial
rendering, responsive width, native bridge errors, Wi-Fi discovery execution,
encrypted pairing persistence and forgetting a key. Seven JVM protocol tests
passed for NetCast pairing/session commands and webOS registration handling.
The desktop project's twelve tests also passed. Physical-TV control from an
Android phone has not yet been verified; test that after installing on your phone.
