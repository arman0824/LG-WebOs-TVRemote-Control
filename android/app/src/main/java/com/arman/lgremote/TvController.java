package com.arman.lgremote;

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
        if (message == null || message.isEmpty()) return "Could not reach the TV. Check its power and Wi-Fi connection.";
        if (error instanceof java.net.SocketTimeoutException || error instanceof java.net.ConnectException) return "Cannot reach the TV. Check the TV IP and connect your phone to the same Wi-Fi.";
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
                if (device != null && host.equals(device.optString("host"))) { close(); device = null; }
                return json("ok", true);
            }
            case "/api/disconnect": close(); device = null; return json("ok", true);
            case "/api/command":
                if (active == null || !active.connected()) throw new Exception("Connect to your TV first.");
                JSONObject payload = body.optJSONObject("payload");
                return active.command(body.optString("command"), payload == null ? new JSONObject() : payload);
            default: throw new Exception("This feature is available in the desktop remote only.");
        }
    }
    private JSONObject connect(JSONObject requested, boolean restoring) throws Exception {
        String host = host(requested);
        Discovery.bindWifi(context);
        JSONObject saved = store.get(host);
        String code = requested.optString("pairingCode").trim();
        String protocol = "", key = "", pin = "";
        TvClient next = null;
        JSONObject selected = json("host", host, "name", requested.optString("name", "LG TV"), "model", requested.optString("model"), "manufacturer", "LG");
        try {
            NetcastClient legacy = new NetcastClient(host, maps.getJSONObject("netcast"));
            boolean netcast = !code.isEmpty() || saved.optString("protocol").equals("netcast") || legacy.detect();
            if (netcast) {
                next = legacy;
                protocol = "netcast";
                selected.put("protocol", protocol);
                key = code.isEmpty() && saved.optString("protocol").equals("netcast") ? saved.optString("key") : code;
                if (!key.isEmpty()) {
                    try { legacy.pair(key); }
                    catch (NetcastClient.TvError e) { if (e.code != 401 || !code.isEmpty()) throw e; }
                }
                if (!legacy.connected()) {
                    if (restoring) throw new Exception("Saved pairing expired.");
                    legacy.showCode();
                    return json("ok", true, "pairingRequired", true, "device", selected);
                }
                key = legacy.key();
            } else {
                protocol = "webos";
                key = saved.optString("protocol").equals("webos") ? saved.optString("key") : "";
                // Avoid unexpected approval popups on launch; webOS reconnect is one tap.
                if (restoring) return json("ok", true, "connected", false);
                WebOsClient webos = new WebOsClient(host, key, saved.optString("pin"), maps.getJSONObject("webos"));
                next = webos;
                webos.connect();
                webos.pair();
                key = webos.key();
                pin = webos.pin();
            }
            selected.put("protocol", protocol);
            store.save(host, json("protocol", protocol, "key", key, "pin", pin, "device", selected));
            close();
            active = next;
            device = selected;
            return json("ok", true, "device", device, "paired", true);
        } catch (Exception error) { if (next != null) next.close(); throw error; }
    }
    void close() { if (active != null) active.close(); active = null; }
}
