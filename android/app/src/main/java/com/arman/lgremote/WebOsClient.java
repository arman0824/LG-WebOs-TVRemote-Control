package com.arman.lgremote;

import java.io.IOException;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.*;
import okhttp3.*;
import org.json.*;

final class WebOsClient implements TvClient {
    private final String host;
    private String key;
    private final JSONObject commands;
    private final OkHttpClient http;
    private volatile String certificatePin = "";
    private volatile boolean certificateChanged;
    private Socket main;
    private Socket input;

    WebOsClient(String host, String key, String savedPin, JSONObject commands) throws Exception {
        this.host = host;
        this.key = key;
        this.commands = commands;
        // LG TVs use local self-signed certificates. Trust only this selected LAN host,
        // and retain its fingerprint after successful TV-side pairing (TOFU).
        X509TrustManager trust = new X509TrustManager() {
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            public void checkClientTrusted(X509Certificate[] chain, String auth) throws CertificateException { throw new CertificateException("Client certificates are not supported."); }
            public void checkServerTrusted(X509Certificate[] chain, String auth) throws CertificateException {
                try {
                    if (chain.length == 0) throw new CertificateException("Missing TV certificate.");
                    byte[] digest = MessageDigest.getInstance("SHA-256").digest(chain[0].getEncoded());
                    StringBuilder fingerprint = new StringBuilder();
                    for (byte b : digest) fingerprint.append(String.format("%02x", b & 255));
                    String next = fingerprint.toString();
                    if (!savedPin.isEmpty() && !savedPin.equals(next)) {
                        certificateChanged = true;
                        throw new CertificateException("The TV certificate changed. Forget its saved pairing and pair again.");
                    }
                    certificatePin = next;
                } catch (CertificateException e) { throw e; }
                catch (Exception e) { throw new CertificateException(e); }
            }
        };
        SSLContext ssl = SSLContext.getInstance("TLS");
        ssl.init(null, new TrustManager[] { trust }, null);
        http = new OkHttpClient.Builder().connectTimeout(4, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(15, TimeUnit.SECONDS).followRedirects(false)
            .sslSocketFactory(ssl.getSocketFactory(), trust).hostnameVerifier((hostname, session) -> hostname.equals(host)).build();
    }
    void connect() throws Exception {
        try { main = open("wss://" + host + ":3001/"); }
        catch (Exception e) {
            if (certificateChanged) throw new IOException("The TV certificate changed. Use Forget saved TV key, then pair again.");
            main = open("ws://" + host + ":3000/");
        }
    }
    private Socket open(String url) throws Exception {
        HttpUrl parsed = HttpUrl.get(url.replaceFirst("^ws", "http"));
        if (!host.equals(parsed.host())) throw new IOException("The TV returned an input socket on a different device.");
        if (!(url.startsWith("ws://") || url.startsWith("wss://"))) throw new IOException("Invalid TV socket address.");
        Socket connection = new Socket();
        connection.socket = http.newWebSocket(new Request.Builder().url(url).build(), connection);
        try { connection.opened.get(6, TimeUnit.SECONDS); return connection; }
        catch (Exception error) { connection.close(); throw new IOException("Cannot reach the TV. Check its IP, power and Wi-Fi.", error); }
    }
    void pair() throws Exception {
        JSONArray permissions = new JSONArray(new String[] {
            "LAUNCH", "LAUNCH_WEBAPP", "APP_TO_APP", "CLOSE", "TEST_OPEN", "TEST_PROTECTED", "CONTROL_AUDIO",
            "CONTROL_DISPLAY", "CONTROL_INPUT_JOYSTICK", "CONTROL_INPUT_MEDIA_PLAYBACK", "CONTROL_INPUT_MEDIA_RECORDING",
            "CONTROL_INPUT_TEXT", "CONTROL_MOUSE_AND_KEYBOARD", "CONTROL_POWER", "READ_APP_STATUS", "READ_CURRENT_CHANNEL",
            "READ_INPUT_DEVICE_LIST", "READ_INSTALLED_APPS", "READ_LGE_SDX", "READ_NETWORK_STATE", "READ_RUNNING_APPS",
            "READ_TV_CHANNEL_LIST", "WRITE_NOTIFICATION_TOAST"
        });
        JSONObject payload = TvController.json("forcePairing", false, "pairingType", "PROMPT",
            "manifest", TvController.json("manifestVersion", 1, "appVersion", "1.0", "permissions", permissions));
        if (!key.isEmpty()) payload.put("client-key", key);
        JSONObject response = main.request(TvController.json("type", "register", "payload", payload), true, 90);
        key = response.getJSONObject("payload").optString("client-key");
        if (key.isEmpty()) throw new IOException("The TV did not return a pairing key. Approve the request on your TV.");
    }
    String key() { return key; }
    String pin() { return certificatePin; }
    @Override public boolean connected() { return main != null && !main.closed && !key.isEmpty(); }
    private JSONObject request(String uri, JSONObject payload) throws Exception {
        return main.request(TvController.json("type", "request", "uri", uri, "payload", payload), false, 12);
    }
    @Override public JSONObject command(String name, JSONObject payload) throws Exception {
        if (!connected()) throw new IOException("Connect to your TV first.");
        String button = "";
        if (name.equals("digit")) {
            button = payload.optString("digit");
            if (!button.matches("[0-9]")) throw new IOException("Enter a single digit from 0 to 9.");
        } else {
            JSONObject command = commands.optJSONObject(name);
            if (command == null) throw new IOException("Unknown TV control.");
            button = command.optString("button");
            if (button.isEmpty()) {
                JSONObject merged = new JSONObject(command.optJSONObject("payload") == null ? "{}" : command.getJSONObject("payload").toString());
                for (java.util.Iterator<String> it = payload.keys(); it.hasNext();) { String k = it.next(); merged.put(k, payload.get(k)); }
                JSONObject response = request(command.getString("uri"), merged);
                if (name.equals("powerOff")) close();
                return TvController.json("ok", true, "response", response);
            }
        }
        if (input == null || input.closed) {
            JSONObject response = request("ssap://com.webos.service.networkinput/getPointerInputSocket", new JSONObject());
            input = open(response.getJSONObject("payload").getString("socketPath"));
        }
        if (!input.socket.send("type:button\nname:" + button + "\n\n")) throw new IOException("TV input connection closed. Try again.");
        return TvController.json("ok", true);
    }
    @Override public void checkStatus() { /* WebSocket close/error and ping detect lost connections. */ }
    @Override public void close() { if (input != null) input.close(); if (main != null) main.close(); }

    static final class Pending {
        final boolean registration;
        final CompletableFuture<JSONObject> future = new CompletableFuture<>();
        Pending(boolean registration) { this.registration = registration; }
    }
    static final class Socket extends WebSocketListener {
        WebSocket socket;
        volatile boolean closed;
        final CompletableFuture<Void> opened = new CompletableFuture<>();
        final ConcurrentHashMap<String, Pending> pending = new ConcurrentHashMap<>();
        final AtomicInteger sequence = new AtomicInteger();
        @Override public void onOpen(WebSocket ws, Response response) { opened.complete(null); }
        @Override public void onMessage(WebSocket ws, String text) {
            try {
                JSONObject message = new JSONObject(text);
                String id = message.optString("id");
                Pending p = pending.get(id);
                // Some firmware omits the registration id.
                if (p == null && id.isEmpty() && (message.optString("type").equals("registered") || message.optString("type").equals("error"))) {
                    for (Pending candidate : pending.values()) if (candidate.registration) { p = candidate; break; }
                }
                if (p == null) return;
                if (message.optString("type").equals("error")) p.future.completeExceptionally(new IOException(message.optString("error", "The TV refused the request.")));
                else if (!p.registration || message.optString("type").equals("registered")) p.future.complete(message);
            } catch (JSONException ignored) { }
        }
        @Override public void onFailure(WebSocket ws, Throwable error, Response response) { fail(error); }
        @Override public void onClosing(WebSocket ws, int code, String reason) { ws.close(code, reason); fail(new IOException("TV connection closed. Reconnect from Connect TV.")); }
        @Override public void onClosed(WebSocket ws, int code, String reason) { fail(new IOException("TV connection closed.")); }
        void fail(Throwable error) {
            closed = true;
            opened.completeExceptionally(error);
            for (Pending p : pending.values()) p.future.completeExceptionally(error);
        }
        JSONObject request(JSONObject message, boolean registration, int timeoutSeconds) throws Exception {
            if (closed) throw new IOException("TV connection is closed.");
            String id = "android_" + sequence.incrementAndGet();
            message.put("id", id);
            Pending p = new Pending(registration);
            pending.put(id, p);
            try {
                if (!socket.send(message.toString())) throw new IOException("TV connection is closed.");
                return p.future.get(timeoutSeconds, TimeUnit.SECONDS);
            } catch (TimeoutException e) {
                throw new IOException(registration ? "Pairing timed out. Accept the connection on the TV screen, then try again." : "The TV did not respond. Try reconnecting.");
            } catch (ExecutionException e) { throw new IOException(TvController.message(e.getCause())); }
            finally { pending.remove(id); }
        }
        void close() { fail(new IOException("Connection closed.")); if (socket != null) socket.cancel(); }
    }
}
