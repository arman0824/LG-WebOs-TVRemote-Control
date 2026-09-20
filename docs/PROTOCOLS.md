# TV connection methods

Universal TV Remote supports five network remote systems. It does not translate
one generic command into something every television understands. Both the laptop
server and Android app select a handler for the TV's system.

| System | Discovery | Pairing and transport |
|---|---|---|
| Android / Google TV | mDNS `_androidtvremote2._tcp.local`; manual IP and service probing | Mutual TLS on 6467, six-character hexadecimal code, then Remote v2 protobuf messages on TLS port 6466. |
| Samsung | SSDP; `/api/v2/` device information | WebSocket on 8002 (TLS) or 8001; wait for `ms.channel.connect`, retain token, send remote key commands. |
| Roku | SSDP `roku:ecp`; device-info query | HTTP ECP on 8060. Network access must be enabled on the TV; no invented PIN exchange. |
| webOS | SSDP; manual IP and service probing | WebSocket on 3001 (TLS) or 3000; wait for the final registration approval, save the client key. |
| NetCast | SSDP; ROAP service probe | HTTP ROAP on 8080; request the numeric code and create a session after successful authentication. |

## Pairing and connections

- Selecting a system manually bypasses detection, not TV-side authorization.
- Android TV's client RSA certificate identifies the remote. Its displayed code is checked using the SHA-256 digest of the client/server RSA modulus and exponent plus the last two code bytes. The first code byte must match the digest. Pairing is saved only after acknowledgement; control waits for the TV's start message.
- Samsung pairing waits for approval; an open socket is not a successful pairing. Denial and timeout fail the operation.
- Roku TV-only controls are offered only when device information reports `is-tv=true`. Play is the protocol's play/pause toggle; a separate Pause key is not advertised.
- Saved credentials are local. Laptop records are in `.tv-keys.json` with owner-only permissions. Android uses encrypted preferences and Android Keystore.
- A pending Android TV pairing expires after two minutes. Request a new code with Connect if it expires or is entered incorrectly.
- A new connection replaces the active remote only after it succeeds.

Android connections choose the TV's local subnet; they do not bind the whole app
to the phone's upstream Wi-Fi. Discovery sends SSDP and mDNS on local interfaces.
The laptop scans its local interfaces too. A hotspot can still block multicast
or communication between clients. Manual IP avoids multicast, but cannot bypass
network isolation.

## Scope and limits

Android / Google TV requires Android TV Remote Service v2. A brand name alone
cannot distinguish Android TV from another operating system on that brand's TV.
Samsung support is for the WebSocket service, not every older Samsung protocol.
No ADB setup or manufacturer cloud account is used.

Fire TV, VIDAA, Apple TV, infrared-only televisions and other proprietary systems
need additional handlers or hardware and are not advertised as supported. Voice,
casting and network wake are not implemented. Streaming-device support does not
imply full control of the attached display. Unsupported buttons are disabled;
available commands can still depend on model, region, firmware and current app.

Protocol tests and emulator tests use simulated TVs. They validate message flow,
pairing, error handling, persistence and routing decisions, not compatibility
with every physical TV or hotspot. Test those combinations on real hardware.

## Implementation references

These are protocol references; their client libraries are not bundled in the app.

- [Android TV Remote v2 reference implementation](https://github.com/tronikos/androidtvremote2)
- [Google's pairing protocol](https://android.googlesource.com/platform/external/google-tv-pairing-protocol/)
- [Samsung WebSocket protocol reference](https://github.com/xchwarze/samsung-tv-ws-api)
- [Roku External Control Protocol](https://developer.roku.com/docs/developer-program/dev-tools/external-control-api.md)
- [NetCast ROAP reference](https://github.com/wokar/pylgnetcast)

Manufacturer strings and permission names needed by existing wire protocols are
kept intact. Removing them would break discovery or pairing; they are not product
branding.
