package com.arman.tvremote;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.*;
import okhttp3.*;
import org.json.*;

final class SamsungClient implements TvClient {
    private final String host;
    private final JSONObject keys;
    private final OkHttpClient base;
    private final TvTls trust;
    private String token;
    private Session session;
    SamsungClient(String host, String token, String pin, JSONObject keys, OkHttpClient client) {
        this.host = host; this.token = token; this.keys = keys; base = client; trust = new TvTls(pin);
    }
    boolean detect() {
        try (Response response = base.newBuilder().callTimeout(1800, TimeUnit.MILLISECONDS).followRedirects(false).build()
                .newCall(new Request.Builder().url("http://" + host + ":8001/api/v2/").build()).execute()) {
            JSONObject data = new JSONObject(response.peekBody(65536).string());
            return (data.optString("type") + data.optJSONObject("device")).toLowerCase(java.util.Locale.ROOT).contains("samsung");
        } catch (Exception ignored) { return false; }
    }
    void connect() throws Exception {
        OkHttpClient client = base.newBuilder().connectTimeout(4, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS)
            .pingInterval(15, TimeUnit.SECONDS).sslSocketFactory(trust.context(null).getSocketFactory(), trust)
            .hostnameVerifier((name, ssl) -> name.equals(host)).followRedirects(false).build();
        Exception last = null;
        for (boolean secure : new boolean[] { true, false }) {
            HttpUrl.Builder url = new HttpUrl.Builder().scheme(secure ? "https" : "http").host(host).port(secure ? 8002 : 8001)
                .addPathSegments("api/v2/channels/samsung.remote.control")
                .addQueryParameter("name", Base64.getEncoder().encodeToString("Universal TV Remote".getBytes(StandardCharsets.UTF_8)));
            if (secure && !token.isEmpty()) url.addQueryParameter("token", token);
            Session attempt = new Session(token);
            attempt.socket = client.newWebSocket(new Request.Builder().url(url.build()).build(), attempt);
            try { attempt.opened.get(6, TimeUnit.SECONDS); session = attempt; break; }
            catch (Exception error) {
                attempt.close(); last = error;
                if (trust.changed) throw new IOException("The TV certificate changed. Forget its saved pairing and pair again.");
            }
        }
        if (session == null) throw new IOException("Cannot reach the Samsung remote service. Check its IP, power and network access.", last);
        try { session.approved.get(90, TimeUnit.SECONDS); token = session.token; }
        catch (Exception error) { close(); throw new IOException(error.getCause() == null ? "Choose Allow on the TV, then try connecting again." : TvController.message(error.getCause()), error); }
    }
    String key() { return token; }
    String pin() { return trust.pin; }
    @Override public boolean connected() { return session != null && session.authorized && !session.closed; }
    @Override public JSONObject command(String name, JSONObject payload) throws Exception {
        if (!connected()) throw new IOException("Connect to your TV first.");
        String key;
        if (name.equals("digit")) {
            String digit = payload.optString("digit");
            if (!digit.matches("[0-9]")) throw new IOException("Enter a single digit from 0 to 9.");
            key = "KEY_" + digit;
        } else {
            if (!keys.has(name)) throw new IOException("This control is not available on this Samsung TV.");
            key = keys.getString(name);
        }
        boolean sent = session.socket.send(TvController.json("method", "ms.remote.control", "params", TvController.json(
            "Cmd", "Click", "DataOfCmd", key, "Option", "false", "TypeOfRemote", "SendRemoteKey")).toString());
        if (!sent) throw new IOException("TV connection closed. Reconnect to try again.");
        if (name.equals("powerOff")) close();
        return TvController.json("ok", true);
    }
    @Override public void checkStatus() { }
    @Override public void close() { if (session != null) session.close(); }
    static final class Session extends WebSocketListener {
        WebSocket socket;
        String token;
        volatile boolean closed, authorized;
        final CompletableFuture<Void> opened = new CompletableFuture<>(), approved = new CompletableFuture<>();
        Session(String token) { this.token = token; }
        @Override public void onOpen(WebSocket socket, Response response) { opened.complete(null); }
        @Override public void onMessage(WebSocket socket, String text) {
            try {
                JSONObject message = new JSONObject(text);
                String event = message.optString("event");
                if (event.equals("ms.channel.connect")) {
                    JSONObject data = message.optJSONObject("data");
                    if (data != null) token = data.optString("token", token);
                    authorized = true; approved.complete(null);
                } else if (event.equals("ms.channel.unauthorized") || event.equals("ms.channel.timeOut") || event.equals("ms.error")) fail(new IOException("The TV refused pairing. Allow Universal TV Remote on the TV, or forget its saved key and try again."));
            } catch (JSONException ignored) { }
        }
        void fail(Throwable error) { closed = true; authorized = false; opened.completeExceptionally(error); approved.completeExceptionally(error); }
        @Override public void onFailure(WebSocket socket, Throwable error, Response response) { fail(error); }
        @Override public void onClosing(WebSocket socket, int code, String reason) { socket.close(code, reason); fail(new IOException("TV connection closed.")); }
        @Override public void onClosed(WebSocket socket, int code, String reason) { fail(new IOException("TV connection closed.")); }
        void close() {
            boolean flush = authorized && !closed;
            fail(new IOException("TV connection closed."));
            // Graceful close sends queued key presses before the close frame.
            if (socket != null) { if (flush) socket.close(1000, "Remote disconnected"); else socket.cancel(); }
        }
    }
}
