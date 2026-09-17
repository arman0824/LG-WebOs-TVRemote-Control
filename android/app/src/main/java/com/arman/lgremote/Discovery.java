package com.arman.lgremote;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiManager;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;
import okhttp3.*;
import org.json.*;

final class Discovery {
    static Network wifiNetwork(Context context) {
        ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities caps = manager.getNetworkCapabilities(network);
            if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return network;
        }
        return null;
    }
    static void bindWifi(Context context) {
        // Prefer Wi-Fi even when Android routes internet traffic over cellular.
        Network wifi = wifiNetwork(context);
        ((ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE)).bindProcessToNetwork(wifi);
    }
    static JSONArray scan(Context context) throws Exception {
        Network network = wifiNetwork(context);
        if (network == null) throw new Exception("Connect your phone to the same Wi-Fi as your TV, then scan again.");
        bindWifi(context);
        WifiManager manager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        WifiManager.MulticastLock lock = manager.createMulticastLock("lg-remote-discovery");
        lock.setReferenceCounted(false);
        lock.acquire();
        Map<String, Map<String, String>> found = new LinkedHashMap<>();
        try (DatagramSocket socket = new DatagramSocket()) {
            network.bindSocket(socket);
            socket.setSoTimeout(400);
            InetAddress multicast = InetAddress.getByName("239.255.255.250");
            for (String target : new String[] { "urn:schemas-upnp-org:device:MediaRenderer:1", "ssdp:all" }) {
                byte[] query = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + target + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
                socket.send(new DatagramPacket(query, query.length, multicast, 1900));
            }
            long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
            while (System.nanoTime() < end) {
                byte[] bytes = new byte[8192];
                DatagramPacket packet = new DatagramPacket(bytes, bytes.length);
                try { socket.receive(packet); } catch (SocketTimeoutException ignored) { continue; }
                String host = packet.getAddress().getHostAddress();
                if (!TvController.isLocalHost(host)) continue;
                Map<String, String> headers = new HashMap<>();
                for (String line : new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8).split("\r?\n")) {
                    int colon = line.indexOf(':');
                    if (colon > 0) headers.put(line.substring(0, colon).toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
                }
                String marker = headers.toString().toLowerCase(Locale.ROOT);
                if (marker.contains("lg") || marker.contains("webos") || marker.contains("web0s") || marker.contains("mediarenderer")) found.putIfAbsent(host, headers);
                if (found.size() >= 16) break;
            }
        } finally { lock.release(); }
        JSONArray devices = new JSONArray();
        OkHttpClient http = new OkHttpClient.Builder().callTimeout(1200, TimeUnit.MILLISECONDS).followRedirects(false).build();
        for (Map.Entry<String, Map<String, String>> item : found.entrySet()) {
            String host = item.getKey(), name = "LG / Network TV", model = "", manufacturer = "";
            try {
                HttpUrl location = HttpUrl.get(item.getValue().getOrDefault("location", ""));
                if (!location.host().equals(host) || !location.scheme().equals("http")) continue;
                try (Response response = http.newCall(new Request.Builder().url(location).build()).execute()) {
                    String xml = response.peekBody(65536).string();
                    name = NetcastClient.tag(xml, "friendlyName");
                    model = NetcastClient.tag(xml, "modelName");
                    manufacturer = NetcastClient.tag(xml, "manufacturer");
                }
            } catch (Exception ignored) { }
            boolean lg = (name + model + manufacturer + item.getValue()).toLowerCase(Locale.ROOT).matches("(?s).*(lg|webos|web0s|lge).*" );
            devices.put(TvController.json("host", host, "name", name.isEmpty() ? "Network TV" : name, "model", model, "manufacturer", manufacturer, "likelyLg", lg));
        }
        return devices;
    }
}
