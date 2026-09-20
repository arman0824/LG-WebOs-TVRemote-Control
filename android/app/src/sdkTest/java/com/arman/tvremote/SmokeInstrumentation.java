package com.arman.tvremote;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.util.concurrent.*;

/** SDK-only on-device checks; never packaged in the family APK. */
public final class SmokeInstrumentation extends Instrumentation {
    private Activity activity;
    private WebView web;
    private boolean protocolMocks;
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); protocolMocks = arguments != null && "true".equals(arguments.getString("protocolMocks")); start(); }
    private String js(String script) throws Exception {
        CompletableFuture<String> value = new CompletableFuture<>();
        runOnMainSync(() -> web.evaluateJavascript(script, value::complete));
        return value.get(5, TimeUnit.SECONDS);
    }
    private void require(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private org.json.JSONObject mockState() throws Exception {
        java.net.HttpURLConnection request = (java.net.HttpURLConnection) new java.net.URL("http://10.0.2.2:16480/").openConnection();
        request.setConnectTimeout(3000); request.setReadTimeout(3000);
        try (java.io.InputStream input = request.getInputStream()) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            return new org.json.JSONObject(bytes.toString("UTF-8"));
        } finally { request.disconnect(); }
    }
    private void checkProtocols() throws Exception {
        TvController tv = new TvController(getTargetContext());
        org.json.JSONObject host = TvController.json("host", "10.0.2.2");
        try {
            tv.handle("/api/forget", host);
            org.json.JSONObject android = TvController.json("host", "10.0.2.2", "protocol", "androidtv");
            require(tv.handle("/api/connect", android).optBoolean("pairingRequired"), "Android TV did not request a code");
            android.put("pairingCode", mockState().getString("code"));
            require(tv.handle("/api/connect", android).optBoolean("paired"), "Android TV pairing failed");
            tv.handle("/api/command", TvController.json("command", "buttonHome"));
            tv.handle("/api/disconnect", new org.json.JSONObject()); android.remove("pairingCode");
            require(tv.handle("/api/connect", android).optBoolean("paired"), "Saved Android TV reconnect failed");
            tv.handle("/api/command", TvController.json("command", "digit", "payload", TvController.json("digit", "9")));
            tv.handle("/api/forget", host);
            require(tv.handle("/api/connect", TvController.json("host", "10.0.2.2", "protocol", "samsung")).optBoolean("paired"), "Samsung approval failed");
            tv.handle("/api/command", TvController.json("command", "volumeUp")); tv.handle("/api/forget", host);
            require(tv.handle("/api/connect", TvController.json("host", "10.0.2.2", "protocol", "roku")).optBoolean("paired"), "Roku connection failed");
            tv.handle("/api/command", TvController.json("command", "buttonHome"));
            org.json.JSONObject commands = mockState().getJSONObject("commands");
            require(commands.getJSONArray("androidtv").toString().equals("[3,16]"), "Android TV wire commands incorrect");
            require(commands.getJSONArray("samsung").toString().contains("KEY_VOLUP"), "Samsung wire command missing");
            require(commands.getJSONArray("roku").getString(0).equals("/keypress/Home"), "Roku wire command missing");
        } finally { tv.handle("/api/forget", host); tv.close(); }
    }
    @Override public void onStart() {
        Bundle results = new Bundle();
        try {
            activity = startActivitySync(new Intent().setClassName("com.arman.tvremote", "com.arman.tvremote.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            runOnMainSync(() -> web = (WebView) ((ViewGroup) activity.findViewById(android.R.id.content)).getChildAt(0));
            long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(25);
            while (System.nanoTime() < end && !"true".equals(js("!!document.querySelector('#manualConnect') && !document.body.classList.contains('mode-pending')"))) Thread.sleep(150);
            require("true".equals(js("!document.body.classList.contains('mode-pending')")), "UI failed to load");
            require("true".equals(js("typeof TVAndroid.request === 'function'")), "Native bridge missing");
            require("true".equals(js("document.querySelectorAll('[data-digit]').length === 10")), "Number pad missing");
            require("\"none\"".equals(js("getComputedStyle(document.querySelector('#shareRemoteButton')).display")), "Desktop sharing must be hidden");
            require("true".equals(js("document.documentElement.scrollWidth <= innerWidth")), "Remote overflows screen");
            js("document.querySelector('#menuButton').click()");
            require("true".equals(js("state.drawerOpen")), "Connect drawer did not open");
            js("document.querySelector('#manualHost').value='not-an-ip'; document.querySelector('#manualConnect').click()");
            end = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
            while (System.nanoTime() < end && !"true".equals(js("!document.querySelector('#connectionError').hidden"))) Thread.sleep(100);
            require("true".equals(js("document.querySelector('#connectionError').textContent.includes('IPv4')")), "Native validation response did not reach the UI");
            require(!LocalNetwork.routes(getTargetContext()).isEmpty(), "Test device must have a local network interface");
            require("true".equals(js("document.querySelector('#networkHelp').textContent.includes('hotspot')")), "Hotspot instructions missing");
            Discovery.scan(getTargetContext());
            require("true".equals(js("document.querySelector('#tvSystem option[value=androidtv]') !== null")), "TV system selector missing");
            if (protocolMocks) checkProtocols();
            PairingStore saved = new PairingStore(getTargetContext());
            saved.save("192.168.254.254", TvController.json("key", "123456", "protocol", "netcast"));
            require(new PairingStore(getTargetContext()).get("192.168.254.254").getString("key").equals("123456"), "Pairing did not persist");
            String encrypted = getTargetContext().getSharedPreferences("tv_pairing", 0).getString("tv.192.168.254.254", "");
            require(!encrypted.contains("123456"), "Pairing key was stored unencrypted");
            saved.forget("192.168.254.254");
            require(!saved.get("192.168.254.254").has("key"), "Forget pairing failed");
            js("document.querySelector('#manualHost').value=''; localStorage.removeItem(KEYS.manualHost); closeDrawer()");
            results.putString("result", "PASS: bundled UI, native bridge, input validation, responsive layout, local interface discovery, hotspot instructions, TV system selector, encrypted pairing persistence and forget");
            if (protocolMocks) results.putString("protocols", "PASS: Android TV mutual TLS and code pairing, Samsung approval, Roku ECP, commands and saved Android TV reconnection");
            finish(Activity.RESULT_OK, results);
        } catch (Throwable error) {
            results.putString("result", "FAIL: " + error);
            finish(Activity.RESULT_CANCELED, results);
        }
    }
}
