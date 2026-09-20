package com.arman.tvremote;

import android.content.Context;
import android.net.wifi.WifiManager;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;
import okhttp3.*;
import org.json.*;

final class Discovery {
    private static final class Candidate {
        final Map<String, String> headers;
        final LocalNetwork.Route route;
        Candidate(Map<String, String> headers, LocalNetwork.Route route) { this.headers = headers; this.route = route; }
    }

    private static Map<String, Candidate> scanRoute(LocalNetwork.Route route) throws Exception {
        Map<String, Candidate> found = new LinkedHashMap<>();
        try (MulticastSocket socket = new MulticastSocket(null)) {
            if (route.network != null) route.network.bindSocket(socket);
            socket.bind(new InetSocketAddress(route.address, 0));
            socket.setNetworkInterface(route.adapter);
            socket.setTimeToLive(2);
            socket.setSoTimeout(400);
            InetAddress multicast = InetAddress.getByName("239.255.255.250");
            for (String target : new String[] { "urn:schemas-upnp-org:device:MediaRenderer:1", "roku:ecp", "ssdp:all" }) {
                byte[] query = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + target + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
                socket.send(new DatagramPacket(query, query.length, multicast, 1900));
            }
            byte[] dns = Mdns.query();
            socket.send(new DatagramPacket(dns, dns.length, InetAddress.getByName("224.0.0.251"), 5353));
            long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
            while (System.nanoTime() < end && !Thread.currentThread().isInterrupted()) {
                byte[] bytes = new byte[8192];
                DatagramPacket packet = new DatagramPacket(bytes, bytes.length);
                try { socket.receive(packet); } catch (SocketTimeoutException ignored) { continue; }
                String host = packet.getAddress().getHostAddress();
                if (!TvController.isLocalHost(host) || host.equals(route.address.getHostAddress())) continue;
                String androidName = Mdns.response(Arrays.copyOf(packet.getData(), packet.getLength()));
                if (!androidName.isEmpty()) {
                    Map<String, String> headers = new HashMap<>(); headers.put("name", androidName); headers.put("server", "androidtvremote2");
                    found.put(host, new Candidate(headers, route)); continue;
                }
                Map<String, String> headers = new HashMap<>();
                for (String line : new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8).split("\\r?\\n")) {
                    int colon = line.indexOf(':');
                    if (colon > 0) headers.put(line.substring(0, colon).toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
                }
                String marker = headers.toString().toLowerCase(Locale.ROOT);
                if (marker.contains("roku") || marker.contains("samsung") || marker.contains("android") || marker.contains("netcast") || marker.contains("lg") || marker.contains("webos") || marker.contains("web0s") || marker.contains("mediarenderer")) found.putIfAbsent(host, new Candidate(headers, route));
                if (found.size() >= 16) break;
            }
        }
        return found;
    }

    static String system(String marker) {
        String value = marker.toLowerCase(Locale.ROOT);
        if (value.contains("roku")) return "roku";
        if (value.contains("samsung")) return "samsung";
        if (value.contains("androidtvremote") || value.contains("android tv") || value.contains("google tv")) return "androidtv";
        if (value.contains("netcast") || value.contains("roap")) return "netcast";
        if (value.contains("webos") || value.contains("web0s")) return "webos";
        return "auto";
    }

    static JSONArray scan(Context context) throws Exception {
        List<LocalNetwork.Route> routes = LocalNetwork.routes(context);
        if (routes.isEmpty()) throw new Exception("Connect the TV to your phone's hotspot, or connect both devices to the same Wi-Fi or hotspot. You can also enter the TV IP manually.");
        WifiManager manager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        WifiManager.MulticastLock lock = manager == null ? null : manager.createMulticastLock("tv-remote-discovery");
        // A hotspot can work even when the Wi-Fi client service cannot take a lock.
        if (lock != null) try { lock.setReferenceCounted(false); lock.acquire(); } catch (RuntimeException ignored) { }
        Map<String, Candidate> found = new LinkedHashMap<>();
        java.util.concurrent.ExecutorService workers = java.util.concurrent.Executors.newFixedThreadPool(Math.min(8, routes.size()));
        boolean scanned = false;
        try {
            List<java.util.concurrent.Callable<Map<String, Candidate>>> scans = new ArrayList<>();
            for (LocalNetwork.Route route : routes) scans.add(() -> scanRoute(route));
            for (java.util.concurrent.Future<Map<String, Candidate>> result : workers.invokeAll(scans, 5, TimeUnit.SECONDS)) {
                try {
                    Map<String, Candidate> devices = result.get();
                    scanned = true;
                    for (Map.Entry<String, Candidate> item : devices.entrySet()) {
                        if (found.size() < 16) found.putIfAbsent(item.getKey(), item.getValue());
                    }
                } catch (java.util.concurrent.ExecutionException | java.util.concurrent.CancellationException ignored) { }
            }
        } finally {
            workers.shutdownNow();
            if (lock != null && lock.isHeld()) lock.release();
        }
        if (!scanned) throw new Exception("Scanning is unavailable on this Wi-Fi or hotspot. Enter the TV's IP from its network settings to connect.");
        JSONArray devices = new JSONArray();
        long detailsEnd = System.nanoTime() + TimeUnit.SECONDS.toNanos(6);
        for (Map.Entry<String, Candidate> item : found.entrySet()) {
            String host = item.getKey(), name = item.getValue().headers.getOrDefault("name", "Network TV"), model = "", manufacturer = "";
            try {
                if (System.nanoTime() >= detailsEnd) throw new SocketTimeoutException();
                OkHttpClient http = new OkHttpClient.Builder().socketFactory(item.getValue().route.sockets())
                    .proxy(Proxy.NO_PROXY).callTimeout(1200, TimeUnit.MILLISECONDS).followRedirects(false).build();
                HttpUrl location = HttpUrl.get(item.getValue().headers.getOrDefault("location", ""));
                if (!location.host().equals(host) || !location.scheme().equals("http")) continue;
                try (Response response = http.newCall(new Request.Builder().url(location).build()).execute()) {
                    String xml = response.peekBody(65536).string();
                    name = NetcastClient.tag(xml, "friendlyName");
                    model = NetcastClient.tag(xml, "modelName");
                    manufacturer = NetcastClient.tag(xml, "manufacturer");
                }
            } catch (Exception ignored) { }
            String protocol = system(name + model + manufacturer + item.getValue().headers);
            devices.put(TvController.json("host", host, "name", name.isEmpty() ? "Network TV" : name, "model", model, "manufacturer", manufacturer, "supported", !protocol.equals("auto"), "protocol", protocol));
        }
        return devices;
    }
}
