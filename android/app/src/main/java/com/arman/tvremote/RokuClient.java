package com.arman.tvremote;

import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.*;
import org.json.*;

final class RokuClient implements TvClient {
    private final String base;
    private final OkHttpClient http;
    private final JSONObject common, television;
    private JSONObject keys;
    private volatile boolean connected;
    String name = "Roku";
    RokuClient(String base, JSONObject common, JSONObject television, OkHttpClient client) {
        this.base = base; this.common = common; this.television = television; keys = common;
        http = client.newBuilder().callTimeout(2500, TimeUnit.MILLISECONDS).followRedirects(false).build();
    }
    private String exchange(String path, boolean post) throws Exception {
        Request.Builder request = new Request.Builder().url(base + path);
        if (post) request.post(RequestBody.create("", MediaType.get("text/plain")));
        try (Response response = http.newCall(request.build()).execute()) {
            if (!response.isSuccessful()) throw new IOException(response.code() == 403
                ? "Enable Control by mobile apps → Network access in the TV's advanced system settings."
                : "Roku refused the request (" + response.code() + "). Check network control settings.");
            return response.peekBody(1048576).string();
        }
    }
    boolean detect() { try { return exchange("/query/device-info", false).contains("<device-info"); } catch (Exception ignored) { return false; } }
    void connect() throws Exception {
        String xml = exchange("/query/device-info", false);
        if (!xml.contains("<device-info")) throw new IOException("This address did not report a Roku device.");
        keys = new JSONObject(common.toString());
        if (NetcastClient.tag(xml, "is-tv").equals("true")) for (java.util.Iterator<String> it = television.keys(); it.hasNext();) { String key = it.next(); keys.put(key, television.get(key)); }
        String label = NetcastClient.tag(xml, "friendly-device-name");
        if (!label.isEmpty()) name = label;
        connected = true;
    }
    JSONArray capabilities() { return keys.names() == null ? new JSONArray() : keys.names(); }
    @Override public boolean connected() { return connected; }
    @Override public JSONObject command(String name, JSONObject payload) throws Exception {
        if (!connected) throw new IOException("Connect to your TV first.");
        if (!keys.has(name)) throw new IOException("This control is not available on this Roku device.");
        exchange("/keypress/" + keys.getString(name), true);
        if (name.equals("powerOff")) close();
        return TvController.json("ok", true);
    }
    @Override public void checkStatus() { if (connected) try { exchange("/query/device-info", false); } catch (Exception error) { close(); } }
    @Override public void close() { connected = false; }
}
