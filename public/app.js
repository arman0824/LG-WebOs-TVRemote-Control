const state = {
  connected: false,
  device: null,
  busy: false,
  theme: "light",
  volume: null,
  muted: false,
  apps: [],
  drawerOpen: false,
  drawerTab: "connect"
};

const el = {};
const KEYS = { theme: "lg.theme", manualHost: "lg.manualHost" };

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

function bindRefs() {
  el.app = $("#app");
  el.menuButton = $("#menuButton");
  el.statusPill = $("#statusPill");
  el.statusText = $("#statusText");
  el.tvName = $("#tvName");
  el.tvMeta = $("#tvMeta");

  el.scanButton = $("#scanButton");
  el.manualHost = $("#manualHost");
  el.manualConnect = $("#manualConnect");
  el.deviceList = $("#deviceList");
  el.scanHint = $("#scanHint");

  el.drawer = $("#drawer");
  el.drawerBackdrop = $("#drawerBackdrop");
  el.drawerTabs = $$(".drawer-tab");
  el.drawerPanels = $$(".drawer-panel");

  el.themeSeg = $("#themeSeg");
  el.clearKeyButton = $("#clearKeyButton");
  el.serverInfo = $("#serverInfo");

  el.appsView = $("#appsView");
  el.openAppsButton = $("#openAppsButton");
  el.heroButton = $("#heroButton");
  el.closeAppsButton = $("#closeAppsButton");
  el.refreshAppsButton = $("#refreshAppsButton");
  el.appsGrid = $("#appsGrid");
  el.appsEmpty = $("#appsEmpty");

  el.pairingOverlay = $("#pairingOverlay");
  el.toast = $("#toast");
}

function setBusy(value) {
  state.busy = value;
  $$("button").forEach((button) => {
    if (button === el.scanButton) return;
    if (button.classList.contains("drawer-tab")) return;
    button.disabled = value;
  });
}

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.toast.classList.remove("show"), 2400);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[char]);
}

function renderStatus() {
  el.statusPill.classList.toggle("connected", state.connected);
  el.statusText.textContent = state.connected ? "Connected" : "Offline";
  if (state.connected && state.device) {
    el.tvName.textContent = state.device.name || "LG webOS TV";
    const meta = [state.device.host];
    if (state.device.model) meta.push(state.device.model);
    el.tvMeta.textContent = meta.join(" • ");
    el.openAppsButton.hidden = false;
  } else {
    el.tvName.textContent = "No TV connected";
    el.tvMeta.textContent = "Tap menu to scan or connect";
    el.openAppsButton.hidden = true;
  }
}

function renderDevices(devices) {
  el.deviceList.innerHTML = "";
  if (!devices.length) {
    el.scanHint.textContent = "No TVs found yet. You can still connect with an IP address.";
    return;
  }
  el.scanHint.textContent = `${devices.length} device${devices.length === 1 ? "" : "s"} found.`;
  for (const device of devices) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "device-card";
    card.innerHTML = `
      <strong>${escapeHtml(device.name || "LG webOS TV")}</strong>
      <span>${escapeHtml(device.host)}${device.model ? ` • ${escapeHtml(device.model)}` : ""}</span>
      <span>${device.likelyLg ? "LG/webOS signal detected" : "Network TV candidate"}</span>
    `;
    card.addEventListener("click", () => connect(device));
    el.deviceList.appendChild(card);
  }
}

function renderApps() {
  el.appsGrid.innerHTML = "";
  if (!state.apps.length) {
    el.appsEmpty.hidden = false;
    el.appsEmpty.textContent = state.connected ? "No apps reported by the TV." : "Connect to a TV first.";
    return;
  }
  el.appsEmpty.hidden = true;
  for (const app of state.apps) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "app-tile";
    const initial = (app.title || app.id || "?").trim().charAt(0).toUpperCase();
    tile.innerHTML = `
      <span class="app-tile-icon">${escapeHtml(initial)}</span>
      <span class="app-tile-name">${escapeHtml(app.title || app.id)}</span>
    `;
    tile.addEventListener("click", () => launchApp(app));
    el.appsGrid.appendChild(tile);
  }
}

/* DRAWER */
function openDrawer() {
  state.drawerOpen = true;
  el.drawer.classList.add("is-open");
  el.drawer.setAttribute("aria-hidden", "false");
  el.drawerBackdrop.hidden = false;
  requestAnimationFrame(() => el.drawerBackdrop.classList.add("is-visible"));
}
function closeDrawer() {
  state.drawerOpen = false;
  el.drawer.classList.remove("is-open");
  el.drawer.setAttribute("aria-hidden", "true");
  el.drawerBackdrop.classList.remove("is-visible");
  setTimeout(() => { if (!state.drawerOpen) el.drawerBackdrop.hidden = true; }, 260);
}
function setDrawerTab(name) {
  state.drawerTab = name;
  el.drawerTabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.drawerTab === name);
  });
  el.drawerPanels.forEach((panel) => {
    panel.hidden = panel.dataset.drawerPanel !== name;
  });
}

/* APPS VIEW */
function openAppsView() {
  if (!state.connected) { toast("Connect to a TV first."); return; }
  el.appsView.classList.add("is-open");
  el.appsView.setAttribute("aria-hidden", "false");
  if (!state.apps.length) loadApps();
}
function closeAppsView() {
  el.appsView.classList.remove("is-open");
  el.appsView.setAttribute("aria-hidden", "true");
}

/* THEME */
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  $$("#themeSeg .seg-btn").forEach((btn) => {
    const active = btn.dataset.themeOpt === state.theme;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-checked", active ? "true" : "false");
  });
  try { localStorage.setItem(KEYS.theme, state.theme); } catch {}
}

function loadPreferences() {
  try {
    const t = localStorage.getItem(KEYS.theme);
    if (t === "dark" || t === "light") state.theme = t;
    const host = localStorage.getItem(KEYS.manualHost);
    if (host) el.manualHost.value = host;
  } catch {}
}

/* API */
async function refreshStatus() {
  try {
    const status = await api("/api/status");
    state.connected = !!status.connected;
    state.device = status.device || null;
    if (status.volume != null) state.volume = status.volume;
    if (typeof status.muted === "boolean") state.muted = status.muted;
    renderStatus();
  } catch {
    state.connected = false;
    state.device = null;
    renderStatus();
  }
}

async function scan() {
  el.scanButton.disabled = true;
  el.scanHint.textContent = "Scanning the local network…";
  try {
    const result = await api("/api/scan");
    renderDevices(result.devices || []);
  } catch (error) {
    toast(error.message);
    el.scanHint.textContent = "Scan failed. Try entering the TV IP directly.";
  } finally {
    el.scanButton.disabled = false;
  }
}

async function connect(device) {
  if (!device.host) {
    toast("Enter a TV IP address first.");
    return;
  }
  setBusy(true);
  el.pairingOverlay.classList.remove("hidden");
  try {
    const result = await api("/api/connect", {
      method: "POST",
      body: JSON.stringify(device)
    });
    state.connected = true;
    state.device = result.device;
    state.apps = [];
    renderStatus();
    toast("TV connected.");
    closeDrawer();
  } catch (error) {
    toast(error.message);
  } finally {
    el.pairingOverlay.classList.add("hidden");
    setBusy(false);
    refreshStatus();
  }
}

async function command(name, payload) {
  if (!state.connected) {
    toast("Connect to your TV first.");
    return;
  }
  try {
    const result = await api("/api/command", {
      method: "POST",
      body: JSON.stringify({ command: name, payload })
    });
    if (name === "getApps") {
      state.apps = (result.response && result.response.payload && result.response.payload.apps) || [];
      renderApps();
      toast(`${state.apps.length} apps loaded.`);
    }
    return result;
  } catch (error) {
    toast(error.message);
    refreshStatus();
  }
}

async function loadApps() { await command("getApps"); }
async function launchApp(app) {
  if (!app || !app.id) return;
  await command("launch", { id: app.id, contentId: app.id });
}

/* EVENT WIRING */
function wireEvents() {
  el.menuButton.addEventListener("click", () => { setDrawerTab("connect"); openDrawer(); });
  el.drawerBackdrop.addEventListener("click", closeDrawer);
  el.drawerTabs.forEach((tab) => {
    tab.addEventListener("click", () => setDrawerTab(tab.dataset.drawerTab));
  });
  el.scanButton.addEventListener("click", scan);

  el.manualConnect.addEventListener("click", () => {
    const host = el.manualHost.value.trim();
    if (!host) { toast("Enter a TV IP address first."); return; }
    try { localStorage.setItem(KEYS.manualHost, host); } catch {}
    connect({ host, name: "Manual LG TV", manufacturer: "LG" });
  });
  el.manualHost.addEventListener("keydown", (e) => { if (e.key === "Enter") el.manualConnect.click(); });

  $$("#themeSeg .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => { state.theme = btn.dataset.themeOpt; applyTheme(); });
  });

  el.clearKeyButton.addEventListener("click", () => {
    try { localStorage.removeItem(KEYS.manualHost); } catch {}
    el.manualHost.value = "";
    toast("Saved host cleared. (Disk-stored keys are managed via the server.)");
  });

  el.openAppsButton.addEventListener("click", openAppsView);
  el.heroButton.addEventListener("click", openAppsView);
  el.closeAppsButton.addEventListener("click", closeAppsView);
  el.refreshAppsButton.addEventListener("click", loadApps);

  // Number pad: build a channel buffer; OK/Enter tunes it
  let channelBuffer = "";
  function updateChannelBuffer() {
    el.tvMeta.textContent = channelBuffer ? `Channel: ${channelBuffer}` : (state.connected && state.device ? `${state.device.host}` : "Tap menu to scan");
  }
  $$(".numpad-btn[data-digit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (channelBuffer.length >= 5) return;
      channelBuffer += btn.dataset.digit;
      updateChannelBuffer();
      clearTimeout(updateChannelBuffer.timer);
      updateChannelBuffer.timer = setTimeout(() => { channelBuffer = ""; updateChannelBuffer(); }, 3500);
    });
  });
  $("#numpadBack").addEventListener("click", () => {
    if (channelBuffer.length > 0) {
      channelBuffer = channelBuffer.slice(0, -1);
      updateChannelBuffer();
    } else {
      command("buttonBack");
    }
  });
  // While channel buffer has digits, Enter tunes the channel
  document.addEventListener("keydown", (event) => {
    if (channelBuffer && (event.key === "Enter" || event.key === "buttonEnter")) {
      event.preventDefault();
      const ch = channelBuffer; channelBuffer = ""; updateChannelBuffer();
      command("channel", { channelId: ch, major: ch });
    }
  });

  $$("[data-command]").forEach((button) => {
    button.addEventListener("click", () => command(button.dataset.command));
  });

  document.addEventListener("keydown", (event) => {
    if (event.target && (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA")) return;
    const map = {
      ArrowUp: "buttonUp", ArrowDown: "buttonDown",
      ArrowLeft: "buttonLeft", ArrowRight: "buttonRight",
      Enter: "buttonEnter", Escape: "buttonBack", " ": "play"
    };
    if (map[event.key]) { event.preventDefault(); command(map[event.key]); }
  });
}

function init() {
  bindRefs();
  loadPreferences();
  applyTheme();
  wireEvents();
  refreshStatus();
  setInterval(refreshStatus, 5000);
}

document.addEventListener("DOMContentLoaded", init);