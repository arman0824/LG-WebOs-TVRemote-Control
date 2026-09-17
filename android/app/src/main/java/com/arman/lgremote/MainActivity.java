package com.arman.lgremote;

import android.app.Activity;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private WebView web;
    private TvController controller;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean destroyed;
    private static final String ORIGIN = "https://appassets.androidplatform.net";

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        controller = new TvController(getApplicationContext());
        web = new WebView(this);
        web.setBackgroundColor(0xfff3f2ed);
        setContentView(web);
        // Keep the remote and drawers clear of gesture bars, cutouts and the keyboard.
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return android.os.Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.addJavascriptInterface(new Bridge(), "LGAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // The native bridge is only ever available to the bundled UI.
                return !request.getUrl().toString().equals(ORIGIN + "/");
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String p = request.getUrl().getPath();
                if ("https".equals(request.getUrl().getScheme()) && "appassets.androidplatform.net".equals(request.getUrl().getHost()) && "GET".equals(request.getMethod())) {
                    String file = "/".equals(p) ? "index.html" : p.substring(1);
                    if (java.util.Arrays.asList("index.html", "app.js", "styles.css", "android.js", "android.css").contains(file)) {
                        try {
                            String mime = file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
                            return new WebResourceResponse(mime, "UTF-8", 200, "OK", java.util.Collections.singletonMap(
                                "Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
                            ), getAssets().open(file));
                        } catch (Exception ignored) { }
                    }
                }
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
        web.loadUrl(ORIGIN + "/");
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
    }

    private final class Bridge {
        @JavascriptInterface public void request(String id, String route, String body) {
            if (destroyed || id == null || !id.matches("[0-9]{1,12}")) return;
            worker.execute(() -> {
                JSONObject response;
                try {
                    if (body.length() > 65536) throw new Exception("Request is too large.");
                    response = controller.handle(route, new JSONObject(body));
                } catch (Exception error) {
                    response = TvController.json("error", TvController.message(error));
                }
                final String script = "window.androidComplete(" + JSONObject.quote(id) + "," + response + ");";
                runOnUiThread(() -> { if (!destroyed) web.evaluateJavascript(script, null); });
            });
        }
    }

    @Override public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        web.evaluateJavascript("(() => { if (state.drawerOpen) { closeDrawer(); return true; } if (el.appsView.classList.contains('is-open')) { closeAppsView(); return true; } return false; })()", result -> {
            if (!"true".equals(result)) moveTaskToBack(true);
        });
    }

    @Override protected void onDestroy() {
        destroyed = true;
        worker.shutdownNow();
        controller.close();
        web.removeJavascriptInterface("LGAndroid");
        web.destroy();
        super.onDestroy();
    }
}
