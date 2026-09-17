# Local LG TV Remote

A web remote for LG webOS and NetCast TVs. Scan your network, pair once, and control your TV from a browser. Local control needs no accounts or npm dependencies. Optional family sharing uses a fixed ngrok address so phones on other networks can use the same paired TV.

The remote has a charcoal body, raised keys, a circular navigation pad, separate
volume and channel rockers, a full number pad, playback controls, and a Home key.
The layout adapts to phones and desktops. Connection and pairing are available
from **Connect TV**, including a permanently visible NetCast code field.

An Android APK is also available in `outputs/LG-Remote-1.0.0.apk` after building.
It talks directly to the TV over Wi-Fi and does not require the desktop server.
See [Android installation and build instructions](android/README.md).

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick Start (3 minutes)](#quick-start-3-minutes)
- [Run in the Background](#run-in-the-background)
- [Use From Your Phone](#use-from-your-phone)
- [Share With Family Anywhere](#share-with-family-anywhere)
- [Connect to Your TV](#connect-to-your-tv)
- [Using the Remote](#using-the-remote)
- [Light & Dark Theme](#light--dark-theme)
- [How It Works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Local Files](#local-files)
- [Security](#security)
- [License](#license)

---

## Features

### Connectivity
- **Automatic scan** — discovers LG webOS TVs on your local network via SSDP
- **Manual IP** — connect by entering your TV's IP address if scanning fails
- **One-tap pairing** — accepts the on-screen approval prompt from your TV
- **Saved pairing key** — reconnects instantly on subsequent launches
- **Phone mode** — control the TV from any device on the same Wi-Fi
- **Family link** — share the already-connected TV with phones on other Wi-Fi networks or mobile data, without visitor logins or pairing

### Remote
- Power off, input selection, Live TV, captions, and TV settings
- Number keys (0–9), channel list, and previous channel
- Volume and channel rockers, mute toggle, Guide, and Info
- Circular D-pad, OK, Home, Apps, Back, and Exit
- Play, pause, stop, rewind, and fast-forward
- Four color function keys
- **More controls**: teletext, text options, audio description, aspect ratio, record, and recordings
- Keyboard: arrows, Enter, Escape, digits, `M` for mute, `+` / `-` for volume

### Design
- Charcoal physical-style remote with raised keys and button feedback
- Responsive desktop layout and a focused mobile view
- Light and dark page themes under **Appearance**
- Connection drawer with manual IP, network scan, and six-digit pairing

Buttons are mapped for webOS and NetCast. Availability of features such as
recording, teletext, captions, and programme information depends on the TV and
current input. The power button turns the TV off; network wake is not implemented.

---

## Requirements

| What you need | Notes |
|---|---|
| A computer running **macOS, Linux, or Windows** | The server runs here |
| **Node.js 18 or newer** | [nodejs.org](https://nodejs.org) |
| An **LG Smart TV running webOS or NetCast with ROAP** | webOS uses an approval prompt; NetCast uses a six-digit code |
| **Same local network** | Your computer and TV must be on the same Wi-Fi or LAN |
| For phone control | Your phone must also be on the same Wi-Fi |

No `npm install` step — the project is dependency-free. Works on macOS, Linux, and Windows out of the box.

---

## Quick Start (3 minutes)

The server runs on your computer and broadcasts the remote over your local Wi-Fi so any phone on the same network can open it.

### 1. Start the phone server

**macOS / Linux:**

```sh
npm run start:phone
```

**Windows (Command Prompt or PowerShell):**

```sh
npm run start:phone
```

You'll see output like:

```text
Phone mode enabled. Open http://192.168.1.25:4173 on your phone.
```

> On macOS you can also **double-click** `phone.command` in Finder. On Windows, **double-click** `phone.bat` in Explorer.

### 2. Open the remote on your phone

Type the printed URL (something like `http://192.168.1.25:4173`) into your phone's browser.

Your phone, your computer, and your TV must all be on the **same Wi-Fi** network.

### 3. Connect to your TV

1. Tap the **menu icon** (top-right of the remote, three lines).
2. Tap **Scan network** — your LG TV should appear in a few seconds.
3. Tap your TV in the list.
4. **Accept the prompt on your TV screen**, or for NetCast TVs **enter the displayed six-digit code** in the app and press **Pair TV**.

You're connected. The status pill at the top of the remote turns blue and reads **Connected**.

### 4. Stop the server

In the terminal, press **Control + C**. Or run:

```sh
npm run stop
```

On macOS double-click `stop.command`. On Windows double-click `stop.bat`.

---

## Phone Mode Details

`npm run start:phone` runs the server on port `4173` and binds it to your local network (`0.0.0.0`). Anything on the same Wi-Fi can open it.

**Checklist:**
- ✅ Phone, computer, and TV on the **same** Wi-Fi
- ✅ On **Windows**: allow the Node.js process through **Windows Defender Firewall** when prompted (private networks)
- ✅ On **macOS**: allow **Local Network** access when prompted
- ✅ This does **not** put the app on the internet — only your local network can reach it

**Quick-launch files:**

| File | Platform | Action |
|---|---|---|
| `phone.command` | macOS | Double-click to start phone mode |
| `phone.bat` | Windows | Double-click to start phone mode |
| `stop.command` | macOS | Double-click to stop the server |
| `stop.bat` | Windows | Double-click to stop the server |

> If macOS blocks a `.command` file the first time, right-click it → **Open** → approve.

To change the port:

**macOS / Linux:**
```sh
PORT=5000 npm run start:phone
```

**Windows (PowerShell):**
```powershell
$env:PORT=5000; npm run start:phone
```

**Windows (Command Prompt):**
```cmd
set PORT=5000 && npm run start:phone
```

To find the printed URL later:

```sh
npm run status
```

---

## Share With Family Anywhere

1. Install ngrok on the host computer. On macOS:
   ```sh
   brew install --cask ngrok
   ```
2. Start the remote with `npm run start:phone` and connect your TV as usual.
3. The owner signs in to a free [ngrok account](https://dashboard.ngrok.com/) once.
   In **Share remote → Permanent link setup**, paste the HTTPS address from
   [Domains](https://dashboard.ngrok.com/domains) and your
   [authtoken](https://dashboard.ngrok.com/get-started/your-authtoken).
   Click **Save & start fixed link**.
4. Click **Copy link** and send it to your family. It opens the remote with no login,
   app installation, or additional TV pairing.

The host computer must stay on the TV's local network and have internet access.
Keep the MacBook lid open. While sharing, the app prevents idle sleep; stopping
sharing releases that sleep prevention. Closing the lid or shutting down can
still interrupt sharing. The family phones only need internet access.

**Stop sharing** closes the link without disconnecting the TV. Stopping the
server also stops sharing. Click **Start sharing** to make the same saved address
available again, including after restarting the server. The assigned address
and authtoken stay in the local, ignored `.sharing-config.json` file; the authtoken
is never sent to family browsers. A failed ngrok connection reports an error
instead of replacing your saved address with a random URL.

Ngrok's free plan may show a **Visit Site** notice before the remote opens. It
also has monthly traffic limits (currently 20,000 HTTP requests and 1 GB of outgoing
data). The remote reduces status polling on family phones and pauses polling
in hidden tabs. See [ngrok's free-plan limits](https://ngrok.com/docs/pricing-limits/free-plan-limits).

Anyone with the link can use the remote. Visitors use the host's existing TV
session; setup, pairing, network scanning, and sharing management remain on the
local page. Pairing keys stay on the host computer. If the TV is offline, the
visitor sees a message to ask the person at the host computer to reconnect it.

---

## Connect to Your TV

You can connect in two ways.

### Option A — Auto Scan (recommended)

1. Turn on your LG TV.
2. Open the remote page.
3. Tap **menu** (top-right) → **Scan network**.
4. Tap your TV when it appears.
5. Accept the pairing prompt on the TV screen.

### Option B — Manual IP

1. Find your TV's IP address:
   - On the TV: **Settings → Network → Wi-Fi Connection → Advanced Wi-Fi Settings** — the IP is listed there.
   - Or in your **router's device list**.
2. Open the remote page.
3. Tap **menu** → type the IP into the **Manual IP** field → **Connect**.
4. Accept the pairing prompt on the TV screen.

### After pairing

The pairing key is stored locally in `.tv-keys.json`. Next time you tap your TV, it connects immediately — no re-prompt.

To forget a saved TV, tap **menu → Settings → Forget saved TV key**.

---

## Using the Remote

1. Click **Connect TV**, scan or enter the TV IP, and pair.
2. Use number keys directly, as on the physical remote. Press **OK** to confirm
   entries on the TV when needed.
3. Use **Home** for the TV launcher and **Apps** for installed apps. On NetCast,
   Apps opens the TV's own app screen.
4. Open **More controls** for teletext, accessibility, aspect ratio, and recording.
5. Use **Appearance** in the page footer to switch the light/dark page theme.

The small LED on the remote flashes when a command succeeds. Connection errors
appear on the page. Keyboard controls are suspended while editing the IP or
pairing code, and Escape closes open panels.

---

## How It Works

A browser alone cannot scan your LAN or talk to an LG TV. This project runs a small **Node.js server** on your computer that bridges the two.

```text
Browser or phone  →  local Node server  →  LG webOS TV
```

The server:
- Serves the website from `public/`
- Scans your network with **SSDP**
- Detects NetCast through **ROAP HTTP** (port `8080`) and pairs using the TV's numeric code
- Connects to LG webOS over **WebSocket** (ports `3001` / `3000`)
- Sends LG **`ssap://`** remote-control commands

The browser sends button presses as JSON to the server (`POST /api/command`), and the server forwards them to the TV.

---

## Troubleshooting

### Phone can't open the URL

- Use `npm run start:phone`, not `npm start`
- Phone and computer on the **same** Wi-Fi
- Disable **VPN**, **iCloud Private Relay**, or guest Wi-Fi isolation
- Allow macOS **Local Network** and firewall prompts
- Test the printed URL on the computer first

### Scan doesn't find the TV

- Make sure the TV is **on**
- Make sure the TV and computer are on the **same network**
- Try the **Manual IP** option instead
- Some routers block multicast/SSDP — check router settings or use Manual IP

### Older LG TVs (NetCast, including 32LB582B)

These TVs use a numeric code instead of a webOS approval popup. The app detects
their ROAP service on port 8080 automatically. Select the TV, enter the six-digit
code displayed on its screen, and press **Pair TV**. The code is saved locally for
reconnection. The Apps button opens the TV's own Apps screen on these models;
listing webOS apps in the browser is not supported.

Protocol reference: [pylgnetcast](https://github.com/wokar/pylgnetcast).

### Pairing prompt never appears

- Look at the TV screen — most LG models show an on-screen approval
- If you have an older NetCast model, enter its numeric code in the app
- Try **Settings → General → Devices → TV Manager** on the TV and remove old paired devices
- Use **Settings → Forget saved TV key** for the selected or manually entered TV IP, then connect again

The webOS registration uses a generic permissions manifest and waits for the TV's
final `registered` response before reporting success. See the
[LGTV Companion compatibility notes](https://github.com/JPersson77/LGTVCompanion/issues/351).

### Buttons don't respond

- Check the **status pill** — it must say **Connected**
- Re-pair if the TV was restarted or changed networks
- Some LG apps block certain remote commands while in use

### Server won't start

- Make sure **port 4173** is free, or set a different one:
  ```sh
  PORT=5000 npm start
  ```

---

## Local Files

These files are created in the project folder when you run the app:

| File | Purpose |
|---|---|
| `.tv-keys.json` | Saved LG pairing keys per TV IP |
| `.sharing-config.json` | Fixed ngrok domain and private owner authtoken (owner-only file permissions) |
| `.server.pid` | Background server process id |
| `.server.log` | Background server logs |

They are local-only and listed in `.gitignore` — do not commit them.

---

## Security

The local setup page is designed for **trusted local networks**.

`npm run start:phone` binds the server to `0.0.0.0`, which means **any device on the same Wi-Fi** can open the remote page while the server is running.

When you're done, stop the server:

```sh
npm run stop
```

The optional **Share remote** link intentionally has no login. Anyone who has
the link can control the connected TV until you stop sharing. It exposes the
remote page, connection status, and TV commands, while the local setup endpoints
and pairing-key file are not available through the link. Do not forward the
local server's port directly through your router; use the family sharing feature.

---

## License

MIT
