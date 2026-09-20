const state = {
  connected: false,
  shared: false,
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
const KEYS = { theme: "tv.theme", manualHost: "tv.manualHost" };

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
  el.tvSystem = $("#tvSystem");
  el.manualHost = $("#manualHost");
  el.manualConnect = $("#manualConnect");
  el.deviceList = $("#deviceList");
  el.scanHint = $("#scanHint");
  el.pairingForm = $("#pairingForm");
  el.pairingCode = $("#pairingCode");
  el.connectionError = $("#connectionError");

  el.drawer = $("#drawer");
  el.drawerBackdrop = $("#drawerBackdrop");
  el.drawerTabs = $$(".drawer-tab");
  el.drawerPanels = $$(".drawer-panel");

  el.themeSeg = $("#themeSeg");
  el.clearKeyButton = $("#clearKeyButton");
  el.serverInfo = $("#serverInfo");

  el.appsView = $("#appsView");
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
  el.tvSystem.disabled = value;
  if (!value) renderCapabilities();
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

function renderCapabilities() {
  const available = state.connected && Array.isArray(state.device?.capabilities) ? new Set(state.device.capabilities) : null;
  $$("[data-command], [data-digit], #heroButton").forEach(button => {
    const name = button === el.heroButton ? (available?.has("getApps") ? "getApps" : "openApps") : button.hasAttribute("data-digit") ? "digit" : button.dataset.command;
    const unsupported = !!available && !available.has(name);
    button.disabled = state.busy || unsupported;
    button.classList.toggle("unsupported", unsupported);
    if (unsupported) button.title = "Not available for this TV system";
    else button.title = button.getAttribute("aria-label") || "";
  });
  $("#controlsHint").textContent = available ? "Dimmed controls are not available for this TV system. Other buttons can vary by model." : "Connect a TV to see which controls it supports.";
}

function renderStatus() {
  renderCapabilities();
  el.statusPill.classList.toggle("connected", state.connected);
  el.statusText.textContent = state.connected ? "Connected" : "Offline";
  if (state.connected && state.device) {
    el.tvName.textContent = state.device.name || "webOS TV";
    const meta = [state.shared ? "Family remote · Ready to use" : state.device.host];
    if (state.device.model) meta.push(state.device.model);
    el.tvMeta.textContent = meta.join(" • ");
  } else {
    el.tvName.textContent = "No TV connected";
    el.tvMeta.textContent = state.shared ? "Ask the person using the laptop to reconnect the TV." : "Connect your TV to get started.";
  }
  $("#connectLabel").textContent = state.connected ? "Manage TV" : "Connect TV";
  el.serverInfo.textContent = state.device ? `Saved TV: ${state.device.name} (${state.device.host})` : "Select a TV or enter its IP in Connect to manage pairing.";
}

function renderMode() {
  document.body.classList.toggle("family-mode", state.shared);
  document.body.classList.remove("mode-pending");
  $$("[data-host-only]").forEach(node => {
    if (!node.matches(".drawer-panel")) node.hidden = state.shared;
  });
  if (state.shared) setDrawerTab("settings");
}

function renderSharing(sharing) {
  const active = sharing.active;
  $("#shareLinkBox").hidden = !sharing.url;
  $("#shareUrl").value = sharing.url || "";
  $("#startSharingButton").hidden = active || !sharing.permanent;
  $("#startSharingButton").disabled = sharing.starting;
  $("#stopSharingButton").hidden = !active;
  $("#shareLinkNote").textContent = sharing.permanent
    ? "This address is saved. Stopping and restarting sharing uses the same link."
    : sharing.url ? "This temporary link changes between sessions. Complete the setup below for a fixed family address." : "Your family will use the same address every time.";
  if (sharing.permanent && !state.fixedLinkLoaded) {
    state.fixedLinkLoaded = true;
    $("#fixedShareUrl").value = sharing.url;
    $("#ngrokToken").placeholder = "Saved — leave blank to keep it";
    $("#fixedLinkSetup").open = false;
  }
  $("#sharingStatus").textContent = sharing.error || (active
    ? "Sharing is on. Copy the link and send it to your family."
    : sharing.starting ? "Starting your family link…" : sharing.permanent ? "Sharing is off. Your saved link will work again when you start sharing." : "Finish the one-time setup below to enable a permanent link.");
}

async function refreshSharing() {
  if (state.shared) return;
  try { renderSharing(await api("/api/share")); }
  catch (error) { $("#sharingStatus").textContent = error.message; }
}

function renderDevices(devices) {
  el.deviceList.innerHTML = "";
  if (!devices.length) {
    el.scanHint.textContent = "No TVs found yet. Enter the TV IP from its network settings. On a hotspot, check that local device connections are allowed.";
    return;
  }
  el.scanHint.textContent = `${devices.length} device${devices.length === 1 ? "" : "s"} found.`;
  for (const device of devices) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "device-card";
    card.innerHTML = `
      <strong>${escapeHtml(device.name || "webOS TV")}</strong>
      <span>${escapeHtml(device.host)}${device.model ? ` • ${escapeHtml(device.model)}` : ""}</span>
      <span>${escapeHtml(device.protocol && device.protocol !== "auto" ? device.protocol === "androidtv" ? "Android / Google TV" : device.protocol : "TV system will be checked when connecting")}</span>
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
  el.drawer.inert = false;
  $("#closeDrawerButton").focus();
  el.drawerBackdrop.hidden = false;
  requestAnimationFrame(() => el.drawerBackdrop.classList.add("is-visible"));
}
function closeDrawer() {
  state.drawerOpen = false;
  el.drawer.classList.remove("is-open");
  el.drawer.inert = true;
  el.drawer.setAttribute("aria-hidden", "true");
  (state.shared ? $("#appearanceButton") : el.menuButton).focus();
  el.drawerBackdrop.classList.remove("is-visible");
  setTimeout(() => { if (!state.drawerOpen) el.drawerBackdrop.hidden = true; }, 260);
}
function setDrawerTab(name) {
  if (state.shared && name !== "settings") name = "settings";
  state.drawerTab = name;
  el.drawerTabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.drawerTab === name);
    tab.setAttribute("aria-selected", String(tab.dataset.drawerTab === name));
  });
  el.drawerPanels.forEach((panel) => {
    panel.hidden = panel.dataset.drawerPanel !== name;
  });
  if (name === "share") refreshSharing();
}

/* APPS VIEW */
function openAppsView() {
  if (!state.connected) { toast(state.shared ? "The TV is offline. Ask the person using the laptop to reconnect it." : "Connect to a TV first."); return; }
  if (state.device?.protocol !== "webos") { command("openApps"); return; }
  el.appsView.classList.add("is-open");
  el.appsView.setAttribute("aria-hidden", "false");
  el.appsView.inert = false;
  el.closeAppsButton.focus();
  if (!state.apps.length) loadApps();
}
function closeAppsView() {
  el.appsView.classList.remove("is-open");
  el.appsView.inert = true;
  el.appsView.setAttribute("aria-hidden", "true");
  el.heroButton.focus();
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
    if (typeof status.shared === "boolean" && status.shared !== state.shared) {
      state.shared = status.shared;
      renderMode();
    }
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
  if (state.busy) return;
  if (!device.host) {
    toast("Enter a TV IP address first.");
    return;
  }
  device = { ...device, protocol: device.protocol && device.protocol !== "auto" ? device.protocol : el.tvSystem.value };
  el.tvSystem.value = device.protocol;
  setBusy(true);
  el.connectionError.hidden = true;
  if (!device.pairingCode) {
    state.pairingDevice = null;
    el.pairingCode.value = "";
  }
  el.manualHost.value = device.host;
  try { localStorage.setItem(KEYS.manualHost, device.host); } catch {}
  el.pairingOverlay.classList.remove("hidden");
  try {
    const result = await api("/api/connect", {
      method: "POST",
      body: JSON.stringify(device)
    });
    if (result.pairingRequired) {
      state.pairingDevice = result.device;
      el.tvSystem.value = result.device.protocol;
      el.pairingCode.inputMode = result.codeFormat === "numeric" ? "numeric" : "text";
      el.pairingCode.pattern = result.codeFormat === "numeric" ? "[0-9]{6}" : "[0-9A-Fa-f]{6}";
      toast(result.codeFormat === "hex" ? "Enter the six letters/numbers shown on your TV." : "Enter the six-digit code shown on your TV.");
      setDrawerTab("connect");
      openDrawer();
      el.pairingCode.focus();
      return;
    }
    state.pairingDevice = null;
    el.pairingCode.value = "";
    state.connected = true;
    state.device = result.device;
    state.apps = [];
    renderStatus();
    toast("TV connected.");
    closeDrawer();
  } catch (error) {
    toast(error.message);
    el.connectionError.textContent = error.message;
    el.connectionError.hidden = false;
  } finally {
    el.pairingOverlay.classList.add("hidden");
    setBusy(false);
    refreshStatus();
  }
}

let commandQueue = Promise.resolve();
function command(name, payload) {
  const pending = commandQueue.then(() => performCommand(name, payload));
  commandQueue = pending.catch(() => {});
  return pending;
}

async function performCommand(name, payload) {
  if (!state.connected) {
    toast(state.shared ? "The TV is offline. Ask the person using the laptop to reconnect it." : "Connect to your TV first.");
    if (!state.shared) { setDrawerTab("connect"); openDrawer(); }
    return;
  }
  if (Array.isArray(state.device?.capabilities) && !state.device.capabilities.includes(name)) {
    toast("This control is not available for this TV system."); return;
  }
  try {
    const result = await api("/api/command", {
      method: "POST",
      body: JSON.stringify({ command: name, payload })
    });
    const led = $("#signalLed");
    led.classList.add("flash");
    clearTimeout(performCommand.ledTimer);
    performCommand.ledTimer = setTimeout(() => led.classList.remove("flash"), 180);
    if (name === "powerOff") refreshStatus();
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
  $("#fixedLinkForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("#saveFixedLinkButton");
    const errorText = $("#fixedLinkError");
    button.disabled = true;
    errorText.hidden = true;
    $("#sharingStatus").textContent = "Saving and starting your fixed family link…";
    try {
      const result = await api("/api/share/config", { method: "POST", body: JSON.stringify({
        url: $("#fixedShareUrl").value.trim(), authtoken: $("#ngrokToken").value.trim()
      }) });
      $("#ngrokToken").value = "";
      state.fixedLinkLoaded = false;
      renderSharing(result);
      toast("Permanent family link is ready.");
    } catch (error) {
      $("#ngrokToken").value = "";
      errorText.textContent = error.message;
      errorText.hidden = false;
      await refreshSharing();
      $("#fixedLinkSetup").open = true;
    } finally { button.disabled = false; }
  });
  $("#shareRemoteButton").addEventListener("click", () => { setDrawerTab("share"); openDrawer(); });
  $("#startSharingButton").addEventListener("click", async () => {
    renderSharing({ starting: true });
    try { renderSharing(await api("/api/share", { method: "POST" })); }
    catch (error) { renderSharing({ error: error.message }); }
  });
  $("#stopSharingButton").addEventListener("click", async () => {
    $("#stopSharingButton").disabled = true;
    try { renderSharing(await api("/api/share", { method: "DELETE" })); }
    catch (error) { toast(error.message); }
    finally { $("#stopSharingButton").disabled = false; }
  });
  $("#copyShareButton").addEventListener("click", async () => {
    const field = $("#shareUrl");
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(field.value);
      else {
        field.focus(); field.select();
        if (!document.execCommand("copy")) throw new Error("Copy unavailable");
      }
      toast("Link copied. Send it to your family.");
    } catch {
      field.focus(); field.select();
      toast("Select and copy the link above.");
    }
  });
  el.menuButton.addEventListener("click", () => { setDrawerTab("connect"); openDrawer(); });
  el.drawerBackdrop.addEventListener("click", closeDrawer);
  $("#closeDrawerButton").addEventListener("click", closeDrawer);
  $$("[data-open-connect]").forEach(button => button.addEventListener("click", () => { setDrawerTab("connect"); openDrawer(); }));
  $("#appearanceButton").addEventListener("click", () => { setDrawerTab("settings"); openDrawer(); });
  el.drawerTabs.forEach((tab) => {
    tab.addEventListener("click", () => setDrawerTab(tab.dataset.drawerTab));
  });
  el.scanButton.addEventListener("click", scan);

  el.manualConnect.addEventListener("click", () => {
    const host = el.manualHost.value.trim();
    if (!host) { toast("Enter a TV IP address first."); return; }
    try { localStorage.setItem(KEYS.manualHost, host); } catch {}
    connect({ host, name: "Smart TV", protocol: el.tvSystem.value });
  });
  el.tvSystem.addEventListener("change", () => {
    state.pairingDevice = null; el.pairingCode.value = "";
    el.pairingCode.inputMode = el.tvSystem.value === "netcast" ? "numeric" : "text";
    el.pairingCode.pattern = el.tvSystem.value === "netcast" ? "[0-9]{6}" : "[0-9A-Fa-f]{6}";
  });
  el.manualHost.addEventListener("keydown", (e) => { if (e.key === "Enter") el.manualConnect.click(); });
  el.pairingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const host = el.manualHost.value.trim();
    if (!host) {
      el.connectionError.textContent = "Enter your TV's IP address above before pairing.";
      el.connectionError.hidden = false;
      el.manualHost.focus();
      return;
    }
    const device = state.pairingDevice?.host === host ? state.pairingDevice : { host, name: "Smart TV", protocol: el.tvSystem.value };
    connect({ ...device, pairingCode: el.pairingCode.value.trim() });
  });

  $$("#themeSeg .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => { state.theme = btn.dataset.themeOpt; applyTheme(); });
  });

  el.clearKeyButton.addEventListener("click", async () => {
    const host = el.manualHost.value.trim() || state.device?.host;
    try {
      await api("/api/forget", { method: "POST", body: JSON.stringify({ host }) });
      state.pairingDevice = null;
      el.pairingCode.value = "";
      toast("Saved TV key removed. Connect again to pair.");
      refreshStatus();
    } catch (error) { toast(error.message); }
  });

  el.heroButton.addEventListener("click", openAppsView);
  el.closeAppsButton.addEventListener("click", closeAppsView);
  el.refreshAppsButton.addEventListener("click", loadApps);

  // Send each number immediately, just like the physical remote.
  $$("[data-digit]").forEach(button => {
    button.addEventListener("click", () => command("digit", { digit: button.dataset.digit }));
  });
  $$("[data-command]").forEach(button => {
    button.addEventListener("click", () => command(button.dataset.command));
  });

  document.addEventListener("keydown", event => {
    const openPanel = state.drawerOpen ? el.drawer : el.appsView.classList.contains("is-open") ? el.appsView : null;
    if (event.key === "Tab" && openPanel) {
      const focusable = [...openPanel.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary")]
        .filter(node => node.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (first && (!openPanel.contains(document.activeElement) || (event.shiftKey && document.activeElement === first))) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
    if (event.key === "Escape" && state.drawerOpen) {
      event.preventDefault(); closeDrawer(); return;
    }
    if (event.key === "Escape" && el.appsView.classList.contains("is-open")) {
      event.preventDefault(); closeAppsView(); return;
    }
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target?.matches("input, textarea, select, [contenteditable=true]")) return;
    if (state.drawerOpen || el.appsView.classList.contains("is-open")) return;
    // Keep native keyboard activation for focused buttons and disclosure controls.
    if (event.target?.closest("button, summary, a") && (event.key === "Enter" || event.key === " ")) return;
    if (/^\d$/.test(event.key)) {
      event.preventDefault(); command("digit", { digit: event.key }); return;
    }
    const map = {
      ArrowUp: "buttonUp", ArrowDown: "buttonDown", ArrowLeft: "buttonLeft", ArrowRight: "buttonRight",
      Enter: "buttonEnter", Escape: "buttonBack", " ": "play", m: "toggleMute", M: "toggleMute",
      "+": "volumeUp", "-": "volumeDown"
    };
    if (map[event.key]) {
      event.preventDefault();
      command(map[event.key]);
      const button = document.querySelector(`[data-command="${map[event.key]}"]`);
      button?.classList.add("is-pressed");
      setTimeout(() => button?.classList.remove("is-pressed"), 130);
    }
  });
}

async function init() {
  bindRefs();
  loadPreferences();
  applyTheme();
  wireEvents();
  try { state.shared = (await api("/api/mode")).shared; }
  catch { state.shared = /\.(?:trycloudflare\.com|ngrok-free\.app|ngrok-free\.dev|ngrok\.app|ngrok\.dev|ngrok\.io)$/.test(location.hostname); }
  renderMode();
  setDrawerTab("connect");
  refreshStatus();
  setInterval(() => {
    if (document.hidden) return;
    refreshStatus();
    if (state.drawerOpen && state.drawerTab === "share") refreshSharing();
  }, state.shared ? 30000 : 5000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshStatus(); });
}

document.addEventListener("DOMContentLoaded", init);
