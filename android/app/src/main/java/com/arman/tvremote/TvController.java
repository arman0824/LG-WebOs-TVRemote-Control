package com.arman.tvremote;

import android.content.Context;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.*;

final class TvController {
    private final Context context;
    private final PairingStore store;
    private JSONObject maps;
    private volatile TvClient active;
    private JSONObject device;
    private AndroidTvClient pendingPairing;

    TvController(Context context) {
        this.context = context;
        store = new PairingStore(context);
        try (InputStream input = context.getAssets().open("commands.json")) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            maps = new JSONObject(bytes.toString("UTF-8"));
        } catch (Exception error) { maps = new JSONObject(); }
    }
    static JSONObject json(Object... entries) {
        JSONObject object = new JSONObject();
        try { for (int i = 0; i < entries.length; i += 2) object.put(String.valueOf(entries[i]), entries[i + 1] == null ? JSONObject.NULL : entries[i + 1]); }
        catch (JSONException error) { throw new IllegalArgumentException(error); }
        return object;
    }
    static String message(Throwable error) {
        String message = error.getMessage();
        if (message == null || message.isEmpty()) return "Could not reach the TV. Check its power and Wi-Fi or hotspot connection.";
        if (error instanceof java.net.SocketTimeoutException || error instanceof java.net.ConnectException) return "Cannot reach the TV. Check the TV IP. Connect the TV to your phone's hotspot, or connect both devices to the same Wi-Fi or hotspot.";
        return message;
    }
    static boolean isLocalHost(String host) {
        if (host == null || !host.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) return false;
        String[] parts = host.split("\\.");
        int[] ip = new int[4];
        for (int i = 0; i < 4; i++) { ip[i] = Integer.parseInt(parts[i]); if (ip[i] > 255) return false; }
        return ip[0] == 10 || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31) || (ip[0] == 192 && ip[1] == 168) || (ip[0] == 169 && ip[1] == 254);
    }
    static String host(JSONObject body) throws Exception {
        String value = body.optString("host").trim();
        if (!isLocalHost(value)) throw new Exception("Enter the TV's local IPv4 address, such as 192.168.1.42. Find it in the TV's network settings.");
        return value;
    }
    JSONObject handle(String route, JSONObject body) throws Exception {
        switch (route) {
            case "/api/mode": return json("shared", false, "android", true);
            case "/api/status":
                if (active != null) active.checkStatus();
                return json("connected", active != null && active.connected(), "device", device, "shared", false);
            case "/api/scan": return json("devices", Discovery.scan(context));
            case "/api/connect": return connect(body, false);
            case "/api/restore": {
                if (active != null && active.connected()) return json("ok", true);
                String last = store.lastHost();
                if (last.isEmpty()) return json("ok", true);
                JSONObject saved = store.get(last);
                JSONObject lastDevice = saved.optJSONObject("device");
                if (lastDevice != null) device = lastDevice;
                try { return connect(lastDevice == null ? json("host", last) : lastDevice, true); }
                catch (Exception ignored) { return json("ok", true, "connected", false); }
            }
            case "/api/forget": {
                String host = host(body);
                store.forget(host);
                if (pendingPairing != null && pendingPairing.host.equals(host)) { pendingPairing.close(); pendingPairing = null; }
                if (device != null && host.equals(device.optString("host"))) { close(); device = null; }
                return json("ok", true);
            }
            case "/api/disconnect": close(); if (pendingPairing != null) { pendingPairing.close(); pendingPairing = null; } device = null; return json("ok", true);
            case "/api/command":
                if (active == null || !active.connected()) throw new Exception("Connect to your TV first.");
                JSONObject payload = body.optJSONObject("payload");
                return active.command(body.optString("command"), payload == null ? new JSONObject() : payload);
            default: throw new Exception("This feature is available in the desktop remote only.");
        }
    }
    private static boolean portOpen(okhttp3.OkHttpClient client, String host, int port) {
        try (java.net.Socket socket = client.socketFactory().createSocket()) {
            socket.connect(new java.net.InetSocketAddress(host, port), 1200); return true;
        } catch (Exception ignored) { return false; }
    }
    private String system(JSONObject requested, JSONObject saved, okhttp3.OkHttpClient client) throws Exception {
        String value = requested.optString("protocol", "auto");
        if (!java.util.Arrays.asList("auto", "webos", "netcast", "roku", "samsung", "androidtv").contains(value)) throw new Exception("Choose a supported TV system.");
        if (!value.equals("auto")) return value;
        String last = saved.optString("protocol");
        if (java.util.Arrays.asList("webos", "netcast", "roku", "samsung", "androidtv").contains(last)) return last;
        String host = host(requested);
        java.util.concurrent.ExecutorService probes = java.util.concurrent.Executors.newFixedThreadPool(5);
        try {
            java.util.List<java.util.concurrent.Callable<String>> jobs = java.util.Arrays.asList(
                () -> new RokuClient("http://" + host + ":8060", maps.getJSONObject("roku"), maps.getJSONObject("rokuTv"), client).detect() ? "roku" : "",
                () -> new SamsungClient(host, "", "", maps.getJSONObject("samsung"), client).detect() ? "samsung" : "",
                () -> new NetcastClient("http://" + host + ":8080/roap/api/", maps.getJSONObject("netcast"), client).detect() ? "netcast" : "",
                () -> portOpen(client, host, 6466) ? "androidtv" : "",
                () -> portOpen(client, host, 3001) || portOpen(client, host, 3000) ? "webos" : ""
            );
            for (java.util.concurrent.Future<String> probe : probes.invokeAll(jobs, 4, java.util.concurrent.TimeUnit.SECONDS)) {
                try { String result = probe.get(); if (!result.isEmpty()) return result; }
                catch (java.util.concurrent.ExecutionException | java.util.concurrent.CancellationException ignored) { }
            }
        } finally { probes.shutdownNow(); }
        throw new Exception("No supported remote service found. Check the TV IP and network settings, or choose its TV system. Wi-Fi alone does not make every TV compatible.");
    }
    private JSONObject connect(JSONObject requested, boolean restoring) throws Exception {
        String host = host(requested);
        okhttp3.OkHttpClient networkClient = LocalNetwork.client(context, host);
        JSONObject saved = store.get(host);
        String code = requested.optString("pairingCode").trim();
        String protocol = system(requested, saved, networkClient), key = "", pin = "";
        TvClient next = null;
        JSONObject selected = json("host", host, "name", requested.optString("name", "Smart TV"), "model", requested.optString("model"), "manufacturer", requested.optString("manufacturer"), "protocol", protocol);
        if (pendingPairing != null && (code.isEmpty() || !pendingPairing.host.equals(host) || !protocol.equals("androidtv"))) { pendingPairing.close(); pendingPairing = null; }
        JSONArray capabilities = new JSONArray();
        try {
            if (protocol.equals("androidtv")) {
                AndroidTvClient android = pendingPairing != null ? pendingPairing : new AndroidTvClient(host,
                    saved.optString("protocol").equals(protocol) ? saved.optString("pin") : "", maps.getJSONObject(protocol), networkClient.socketFactory());
                next = android;
                if (!code.isEmpty()) {
                    if (android != pendingPairing) throw new Exception("Tap Connect first to request a new TV pairing code.");
                    android.finishPairing(code); pendingPairing = null;
                } else if (saved.optString("protocol").equals(protocol) && !saved.optString("pin").isEmpty()) android.connect();
                else {
                    if (restoring) return json("ok", true, "connected", false);
                    pendingPairing = android; android.startPairing();
                    return json("ok", true, "pairingRequired", true, "codeFormat", "hex", "device", selected);
                }
                pin = android.pin(); capabilities = maps.getJSONObject(protocol).names(); capabilities.put("digit");
            } else if (protocol.equals("netcast")) {
                NetcastClient legacy = new NetcastClient("http://" + host + ":8080/roap/api/", maps.getJSONObject("netcast"), networkClient);
                next = legacy;
                key = code.isEmpty() && saved.optString("protocol").equals("netcast") ? saved.optString("key") : code;
                if (!key.isEmpty()) {
                    try { legacy.pair(key); }
                    catch (NetcastClient.TvError e) { if (e.code != 401 || !code.isEmpty()) throw e; }
                }
                if (!legacy.connected()) {
                    if (restoring) throw new Exception("Saved pairing expired.");
                    legacy.showCode();
                    return json("ok", true, "pairingRequired", true, "codeFormat", "numeric", "device", selected);
                }
                key = legacy.key(); capabilities = maps.getJSONObject(protocol).names(); capabilities.put("digit");
            } else {
                if (!code.isEmpty()) throw new Exception("This TV system does not use a typed pairing code. Tap Connect and follow the TV prompt.");
                if (protocol.equals("roku")) {
                    RokuClient roku = new RokuClient("http://" + host + ":8060", maps.getJSONObject("roku"), maps.getJSONObject("rokuTv"), networkClient);
                    next = roku; roku.connect(); selected.put("name", roku.name); capabilities = roku.capabilities();
                } else if (protocol.equals("samsung")) {
                    if (restoring) return json("ok", true, "connected", false);
                    SamsungClient samsung = new SamsungClient(host, saved.optString("protocol").equals(protocol) ? saved.optString("key") : "",
                        saved.optString("protocol").equals(protocol) ? saved.optString("pin") : "", maps.getJSONObject(protocol), networkClient);
                    next = samsung; samsung.connect(); key = samsung.key(); pin = samsung.pin(); capabilities = maps.getJSONObject(protocol).names(); capabilities.put("digit");
                } else {
                    if (restoring) return json("ok", true, "connected", false);
                    WebOsClient webos = new WebOsClient(host, saved.optString("protocol").equals(protocol) ? saved.optString("key") : "",
                        saved.optString("protocol").equals(protocol) ? saved.optString("pin") : "", maps.getJSONObject("webos"), networkClient);
                    next = webos; webos.connect(); webos.pair(); key = webos.key(); pin = webos.pin(); capabilities = maps.getJSONObject(protocol).names(); capabilities.put("digit");
                }
            }
            selected.put("capabilities", capabilities);
            store.save(host, json("protocol", protocol, "key", key, "pin", pin, "device", selected));
            if (active != null) active.close();
            active = next; device = selected;
            return json("ok", true, "device", device, "paired", true);
        } catch (Exception error) {
            if (next != null) next.close();
            if (next == pendingPairing) pendingPairing = null;
            throw error;
        }
    }
    void close() { if (active != null) active.close(); active = null; if (pendingPairing != null) { pendingPairing.close(); pendingPairing = null; } }
}
