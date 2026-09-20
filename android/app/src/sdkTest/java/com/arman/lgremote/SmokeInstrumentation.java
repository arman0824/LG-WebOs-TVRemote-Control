package com.arman.lgremote;

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
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
    private String js(String script) throws Exception {
        CompletableFuture<String> value = new CompletableFuture<>();
        runOnMainSync(() -> web.evaluateJavascript(script, value::complete));
        return value.get(5, TimeUnit.SECONDS);
    }
    private void require(boolean value, String message) { if (!value) throw new AssertionError(message); }
    @Override public void onStart() {
        Bundle results = new Bundle();
        try {
            activity = startActivitySync(new Intent().setClassName("com.arman.lgremote", "com.arman.lgremote.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            runOnMainSync(() -> web = (WebView) ((ViewGroup) activity.findViewById(android.R.id.content)).getChildAt(0));
            long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(25);
            while (System.nanoTime() < end && !"true".equals(js("!!document.querySelector('#manualConnect') && !document.body.classList.contains('mode-pending')"))) Thread.sleep(150);
            require("true".equals(js("!document.body.classList.contains('mode-pending')")), "UI failed to load");
            require("true".equals(js("typeof LGAndroid.request === 'function'")), "Native bridge missing");
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
            PairingStore saved = new PairingStore(getTargetContext());
            saved.save("192.168.254.254", TvController.json("key", "123456", "protocol", "netcast"));
            require(new PairingStore(getTargetContext()).get("192.168.254.254").getString("key").equals("123456"), "Pairing did not persist");
            String encrypted = getTargetContext().getSharedPreferences("tv_pairing", 0).getString("tv.192.168.254.254", "");
            require(!encrypted.contains("123456"), "Pairing key was stored unencrypted");
            saved.forget("192.168.254.254");
            require(!saved.get("192.168.254.254").has("key"), "Forget pairing failed");
            js("document.querySelector('#manualHost').value=''; localStorage.removeItem(KEYS.manualHost); closeDrawer()");
            results.putString("result", "PASS: bundled UI, native bridge, input validation, responsive layout, local interface discovery, hotspot instructions, encrypted pairing persistence and forget");
            finish(Activity.RESULT_OK, results);
        } catch (Throwable error) {
            results.putString("result", "FAIL: " + error);
            finish(Activity.RESULT_CANCELED, results);
        }
    }
}
