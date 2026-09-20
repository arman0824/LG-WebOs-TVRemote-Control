# LG Remote for Android

An Android 8.0+ app that bundles the existing remote interface and communicates
directly with LG TVs through native Android networking. No desktop server,
ngrok account, internet hosting, or login is needed for local TV control.

## Install and connect

1. On your phone, [download LG Remote 1.0.2](https://github.com/arman0824/LG-WebOs-TVRemote-Control/releases/latest/download/LG-Remote-1.0.2.apk).
   You can also open [Releases](https://github.com/arman0824/LG-WebOs-TVRemote-Control/releases),
   expand **Assets**, and choose the `.apk` file. If you built the app yourself,
   copy `outputs/LG-Remote-1.0.2.apk` to your phone instead.
2. Open it and allow that browser or file manager to install this APK when Android asks.
3. Open **LG Remote**. Connect the TV to this phone’s hotspot, or connect both
   devices to the same Wi-Fi or another phone’s hotspot.
4. Select **Connect TV → Scan network**, then select your TV. If discovery is
   blocked by the router or hotspot, enter the TV's IPv4 address from its network settings.
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

## Using a phone hotspot

1. Enable **Mobile hotspot** in the Android phone's settings.
2. On the TV, open its Wi-Fi settings and connect to that hotspot.
3. On the hotspot phone, open **LG Remote → Connect TV → Scan network**.
4. If the TV does not appear, find its **IP address** in the TV's network settings
   (or the hotspot's connected-device list), enter it in **Manual IP**, and connect.
5. Approve the TV prompt or enter its six-digit pairing code as usual.

You can also use the app on a second phone connected to the same hotspot.
Hotspots that isolate clients may block that second phone; use the hotspot phone
or disable client isolation if the phone offers that setting. Local connectivity
must be allowed by the phone: the APK cannot control a TV on an unrelated network
through mobile data alone. Desktop browser users must connect the server computer
to the TV's hotspot too, or use the existing family sharing link.

The app scans local interfaces, including hotspot interfaces, without requiring
an active Wi-Fi client connection. TV connections use the matching local subnet,
so a simultaneous upstream Wi-Fi connection is not preferred over the hotspot.
Manual IP works even when the hotspot does not pass discovery multicast. No fixed
hotspot IP range is assumed; check the TV's current IP after changing networks.

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
thread. Discovery uses SSDP on local Wi-Fi, Ethernet and hotspot interfaces; NetCast uses HTTP on port 8080 and webOS
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

Version 1.0.1 (version code 2) centers the remote and connection card at every screen
size and removes the promotional page copy. It uses the same release signing key
as 1.0.0, so install it as an update to keep saved pairing.

Version 1.0.2 (version code 3) adds hotspot interface discovery and routes NetCast,
webOS and input sockets through the selected TV's local network. It uses the same
release signing key and can update 1.0.0 or 1.0.1 while keeping saved pairing.
Validation: the signed 1.0.2 APK built and passed signature verification. All 12
JVM tests (including hotspot route selection and source-bound HTTP) and 12 desktop
tests passed. The release APK passed the Android 11 emulator smoke checks for the
bundled UI, native bridge, local interface discovery, hotspot instructions and
encrypted pairing storage. Physical phone/hotspot/TV operation still needs to be
verified on real hardware.
