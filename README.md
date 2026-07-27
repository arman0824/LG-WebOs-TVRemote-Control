# Local LG TV Remote

A beautifully designed, local-only web remote for LG webOS TVs. Scan your network, pair once, and control your TV from any browser — on your Mac or your phone. No cloud. No accounts. No npm dependencies.

The UI looks and feels like a real remote, with a neumorphic light/dark theme, an elongated device shape, a large central D-pad flanked by volume and channel rockers, a full number pad, and an electric-blue hero button that opens your installed apps.

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick Start (3 minutes)](#quick-start-3-minutes)
- [Run in the Background](#run-in-the-background)
- [Use From Your Phone](#use-from-your-phone)
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

### Remote
- **Power, Home, Menu** — top icon row
- **Circular D-pad** — large, neumorphic, with recessed OK button and four directional indicators
- **Volume rocker** — plus / minus / VOL label, soft raised pill
- **Channel rocker** — up / down / CH label, soft raised pill
- **Color keys** — red, green, yellow, blue
- **Number pad** — full 3×4 layout with letter sub-labels (1 ABC, 2 DEF …) and a backspace key
- **Media controls** — rewind, play, pause, fast-forward
- **Apps launcher** — the blue hero button opens a grid of every app installed on the TV, tap to launch

### Design
- **Neumorphic UI** — soft surfaces, gentle shadows, premium feel
- **Light & Dark themes** — toggle in the drawer, persists across sessions
- **Remote-shaped frame** — rounded device body with glossy top reflection, IR LED, and brand label
- **Fully responsive** — comfortable on a phone screen or a desktop browser
- **Keyboard shortcuts** — arrow keys move the D-pad, Enter is OK, Space is Play/Pause, Esc is Back

---

## Requirements

| What you need | Notes |
|---|---|
| A computer running **macOS, Linux, or Windows** | The server runs here |
| **Node.js 18 or newer** | [nodejs.org](https://nodejs.org) |
| An **LG Smart TV running webOS** | Most LG TVs from 2014 onward |
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
4. A "Pairing with your LG TV" dialog appears — **accept the prompt on your TV screen**.

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

Here's what every part of the remote does.

### Top icon row

| Button | Action |
|---|---|
| 🔴 **Power** (red) | Turn the TV off |
| 🏠 **Home** | Open the webOS launcher (home screen) |
| ☰ **Menu** | Open the drawer — Connect, Settings |

### D-pad (center)

A large circular control. Tap any quadrant to navigate, tap the center **OK** to confirm. Four small dots mark the cardinal directions.

### Rockers (flanking the D-pad)

| Rocker | Buttons |
|---|---|
| **VOL** (left) | `+` volume up, `−` volume down |
| **CH** (right) | `^` channel up, `v` channel down |

### Color keys

Red · Green · Yellow · Blue — used by apps for shortcuts (e.g., teletext, recordings, special menus).

### Number pad

Type a channel number digit by digit. The TV meta line shows what you've typed. Press **OK** (or **Enter** on a keyboard) to tune to that channel.

The **backspace** key (right of `0`) deletes one digit. If the buffer is empty, it acts as **Back**.

### Bottom row

| Button | Action |
|---|---|
| **Back** | Go back one step |
| **Input** | Switch input source (HDMI 1, HDMI 2, TV, etc.) |
| 🔵 **Hero (blue)** | Open the **Apps** launcher — every app installed on the TV, tap to launch |
| **Exit** | Close the current menu or app |
| **Menu** | Open the drawer |

### Apps launcher

Tap the blue hero button. A grid of every app installed on your TV appears. Tap any tile to launch it on the TV.

### Status pill

At the top of the remote:
- **Offline** (grey dot) — not connected
- **Connected** (blue dot) — paired and ready

### Keyboard shortcuts

| Key | Action |
|---|---|
| `↑` `↓` `←` `→` | D-pad |
| `Enter` | OK |
| `Esc` | Back |
| `Space` | Play / Pause |

---

## How It Works

A browser alone cannot scan your LAN or talk to an LG TV. This project runs a small **Node.js server** on your computer that bridges the two.

```text
Browser or phone  →  local Node server  →  LG webOS TV
```

The server:
- Serves the website from `public/`
- Scans your network with **SSDP**
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

### Pairing prompt never appears

- Look at the TV screen — most LG models show an on-screen approval
- If you have an older model, the TV may show a numeric code (this app uses the newer prompt-based flow)
- Try **Settings → General → Devices → TV Manager** on the TV and remove old paired devices
- Delete `.tv-keys.json` in this project folder and pair again

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
| `.server.pid` | Background server process id |
| `.server.log` | Background server logs |

They are local-only and listed in `.gitignore` — do not commit them.

---

## Security

This app is designed for **trusted local networks only**.

`npm run start:phone` binds the server to `0.0.0.0`, which means **any device on the same Wi-Fi** can open the remote page while the server is running.

When you're done, stop the server:

```sh
npm run stop
```

**Do not** expose this app directly to the public internet — it has no authentication.

---

## License

MIT