package com.arman.tvremote;

import android.webkit.WebView;
import android.view.ViewGroup;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.rule.ActivityTestRule;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.*;
import org.junit.*;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class AppSmokeTest {
    @Rule public ActivityTestRule<MainActivity> activity = new ActivityTestRule<>(MainActivity.class);
    private WebView web() { return (WebView) ((ViewGroup) activity.getActivity().findViewById(android.R.id.content)).getChildAt(0); }
    private String js(String script) throws Exception {
        CompletableFuture<String> result = new CompletableFuture<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> web().evaluateJavascript(script, result::complete));
        return result.get(5, TimeUnit.SECONDS);
    }
    private void ready() throws Exception {
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        while (System.nanoTime() < end) {
            if ("true".equals(js("!!document.querySelector('#manualConnect') && !document.body.classList.contains('mode-pending')"))) return;
            Thread.sleep(150);
        }
        fail("Android UI did not finish loading.");
    }
    @Test public void bundledRemoteAndNativeBridgeWorkWithoutDesktopServer() throws Exception {
        ready();
        assertEquals("true", js("typeof TVAndroid.request === 'function'"));
        assertEquals("true", js("document.querySelectorAll('[data-digit]').length === 10"));
        assertEquals("\"none\"", js("getComputedStyle(document.querySelector('#shareRemoteButton')).display"));
        assertEquals("true", js("document.documentElement.scrollWidth <= window.innerWidth"));
        js("document.querySelector('#menuButton').click()");
        assertEquals("true", js("state.drawerOpen && !document.querySelector('#drawer').inert"));
        js("document.querySelector('#manualHost').value = 'not-an-ip'; document.querySelector('#manualConnect').click()");
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
        while (System.nanoTime() < end && !"true".equals(js("!document.querySelector('#connectionError').hidden"))) Thread.sleep(100);
        assertEquals("true", js("document.querySelector('#connectionError').textContent.includes('IPv4')"));
    }
    @Test public void pairingStorePersistsAndCanForgetAnEncryptedKey() throws Exception {
        android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        PairingStore first = new PairingStore(context);
        first.save("192.168.254.254", TvController.json("key", "123456", "protocol", "netcast"));
        PairingStore second = new PairingStore(context);
        assertEquals("123456", second.get("192.168.254.254").getString("key"));
        assertFalse(context.getSharedPreferences("tv_pairing", 0).getString("tv.192.168.254.254", "").contains("123456"));
        second.forget("192.168.254.254");
        assertFalse(second.get("192.168.254.254").has("key"));
    }
}
