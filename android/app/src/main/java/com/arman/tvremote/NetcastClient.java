package com.arman.tvremote;

import java.io.IOException;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import okhttp3.*;
import org.json.JSONObject;

final class NetcastClient implements TvClient {
    private final String base;
    private final JSONObject keys;
    private final OkHttpClient http;
    private volatile String session = "";
    private String key = "";
    static final MediaType XML = MediaType.get("application/atom+xml; charset=utf-8");
    static class TvError extends IOException {
        final int code;
        TvError(int code, String detail) { super("TV: " + detail + " (" + code + ")."); this.code = code; }
    }
    NetcastClient(String host, JSONObject keys) { this("http://" + host + ":8080/roap/api/", keys, new OkHttpClient()); }
    NetcastClient(String base, JSONObject keys, OkHttpClient client) {
        this.base = base;
        this.keys = keys;
        http = client.newBuilder().connectTimeout(3, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS)
            .callTimeout(6, TimeUnit.SECONDS).followRedirects(false).build();
    }
    static String tag(String xml, String name) {
        Matcher m = Pattern.compile("<" + name + "(?:\\s[^>]*)?>([^<]*)</" + name + ">", Pattern.CASE_INSENSITIVE).matcher(xml);
        return m.find() ? m.group(1).trim() : "";
    }
    String exchange(String endpoint, String body, boolean probe) throws Exception {
        Request.Builder request = new Request.Builder().url(base + endpoint);
        if (body != null) request.post(RequestBody.create("<?xml version=\"1.0\" encoding=\"utf-8\"?>" + body, XML));
        OkHttpClient client = probe ? http.newBuilder().callTimeout(1800, TimeUnit.MILLISECONDS).build() : http;
        try (Response response = client.newCall(request.build()).execute()) {
            String xml = response.body() == null ? "" : response.body().string();
            if (xml.length() > 1024 * 1024) throw new IOException("TV response is too large.");
            String code = tag(xml, "ROAPError");
            if (!probe && (!response.isSuccessful() || (!code.isEmpty() && !code.equals("200")))) {
                int status;
                try { status = Integer.parseInt(code); } catch (Exception ignored) { status = response.code(); }
                if (status == 401) close();
                throw new TvError(status, tag(xml, "ROAPErrorDetail"));
            }
            return xml;
        }
    }
    boolean detect() { try { return !tag(exchange("data?target=volume_info", null, true), "ROAPError").isEmpty(); } catch (Exception ignored) { return false; } }
    void showCode() throws Exception { exchange("auth", "<auth><type>AuthKeyReq</type></auth>", false); }
    void pair(String code) throws Exception {
        if (!code.matches("[0-9]{6}")) throw new IOException("Enter the six-digit code shown on the TV.");
        String xml = exchange("auth", "<auth><type>AuthReq</type><value>" + code + "</value></auth>", false);
        String result = tag(xml, "session");
        if (!result.matches("[0-9]+")) throw new IOException("The TV did not accept pairing. Request a new code.");
        key = code;
        session = result;
    }
    String key() { return key; }
    @Override public boolean connected() { return !session.isEmpty(); }
    @Override public JSONObject command(String name, JSONObject payload) throws Exception {
        if (!connected()) throw new IOException("Connect to your TV first.");
        if (name.equals("digit")) {
            String digit = payload.optString("digit");
            if (!digit.matches("[0-9]")) throw new IOException("Enter a single digit from 0 to 9.");
            sendKey(Integer.parseInt(digit) + 2);
        } else if (name.equals("channel")) {
            String digits = payload.optString("major", payload.optString("channelId"));
            if (!digits.matches("[0-9]{1,5}")) throw new IOException("Enter a valid channel number.");
            for (char digit : digits.toCharArray()) sendKey(digit - '0' + 2);
            sendKey(20);
        } else {
            if (!keys.has(name)) throw new IOException("This control is not available on this NetCast TV.");
            sendKey(keys.getInt(name));
        }
        if (name.equals("powerOff")) close();
        return TvController.json("ok", true);
    }
    private void sendKey(int code) throws Exception {
        exchange("command", "<command><session>" + session + "</session><type>HandleKeyInput</type><value>" + code + "</value></command>", false);
    }
    @Override public void checkStatus() {
        if (connected()) try { exchange("data?target=volume_info", null, false); } catch (Exception error) { close(); }
    }
    @Override public void close() { session = ""; }
}
