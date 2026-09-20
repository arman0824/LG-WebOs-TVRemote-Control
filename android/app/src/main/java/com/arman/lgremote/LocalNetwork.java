package com.arman.lgremote;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import java.io.IOException;
import java.net.*;
import java.util.*;
import javax.net.SocketFactory;
import okhttp3.OkHttpClient;

/** Routes each TV socket independently, including a phone's downstream hotspot. */
final class LocalNetwork {
    static final class Route {
        final InetAddress address;
        final int prefix;
        final Network network;
        final NetworkInterface adapter;

        Route(InetAddress address, int prefix, Network network, NetworkInterface adapter) {
            this.address = address;
            this.prefix = prefix;
            this.network = network;
            this.adapter = adapter;
        }

        SocketFactory sockets() {
            return network == null ? new SourceSockets(address) : network.getSocketFactory();
        }
    }

    static List<Route> routes(Context context) throws SocketException {
        ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        Map<String, Network> local = new HashMap<>();
        Set<String> excluded = new HashSet<>();
        if (manager != null) for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities caps = manager.getNetworkCapabilities(network);
            LinkProperties links = manager.getLinkProperties(network);
            if (caps == null || links == null || links.getInterfaceName() == null) continue;
            String name = links.getInterfaceName();
            if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
                    && (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                    || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))) local.put(name, network);
            else excluded.add(name);
        }
        List<Route> routes = new ArrayList<>();
        Enumeration<NetworkInterface> adapters = NetworkInterface.getNetworkInterfaces();
        if (adapters == null) return routes;
        for (NetworkInterface adapter : Collections.list(adapters)) {
            if (!adapter.isUp() || adapter.isLoopback() || adapter.isPointToPoint()
                    || excluded.contains(adapter.getName())) continue;
            // Hotspot interfaces do not normally appear in ConnectivityManager's
            // upstream networks. Discover their actual address; never assume a subnet.
            for (InterfaceAddress link : adapter.getInterfaceAddresses()) {
                InetAddress address = link.getAddress();
                if (address instanceof Inet4Address && TvController.isLocalHost(address.getHostAddress())) {
                    routes.add(new Route(address, link.getNetworkPrefixLength(), local.get(adapter.getName()), adapter));
                }
            }
        }
        return routes;
    }

    static boolean contains(InetAddress address, int prefix, InetAddress target) {
        byte[] a = address.getAddress(), b = target.getAddress();
        if (a.length != 4 || b.length != 4 || prefix < 1 || prefix > 32) return false;
        for (int i = 0; i < 4; i++) {
            int bits = Math.min(8, Math.max(0, prefix - i * 8));
            int mask = (0xff << (8 - bits)) & 0xff;
            if ((a[i] & mask) != (b[i] & mask)) return false;
        }
        return true;
    }

    static Route select(List<Route> routes, InetAddress target) {
        Route best = null;
        for (Route route : routes) {
            if (contains(route.address, route.prefix, target) && (best == null || route.prefix > best.prefix)) best = route;
        }
        if (best != null) return best;
        // Retain support for routed LANs when the TV is outside the phone's subnet.
        for (Route route : routes) if (route.network != null) return route;
        return null;
    }

    static OkHttpClient client(Context context, String host) throws IOException {
        Route route = select(routes(context), InetAddress.getByName(host));
        OkHttpClient.Builder client = new OkHttpClient.Builder().proxy(Proxy.NO_PROXY);
        if (route != null) client.socketFactory(route.sockets());
        return client.build();
    }

    /** Bind hotspot sockets to the downstream address, leaving mobile data alone. */
    static final class SourceSockets extends SocketFactory {
        private final InetAddress source;
        SourceSockets(InetAddress source) { this.source = source; }
        @Override public Socket createSocket() throws IOException {
            Socket socket = new Socket();
            try { socket.bind(new InetSocketAddress(source, 0)); return socket; }
            catch (IOException error) { socket.close(); throw error; }
        }
        private Socket connect(InetAddress host, int port, InetAddress local, int localPort) throws IOException {
            Socket socket = new Socket();
            try {
                socket.bind(new InetSocketAddress(local == null ? source : local, localPort));
                socket.connect(new InetSocketAddress(host, port));
                return socket;
            } catch (IOException error) { socket.close(); throw error; }
        }
        @Override public Socket createSocket(String host, int port) throws IOException { return connect(InetAddress.getByName(host), port, source, 0); }
        @Override public Socket createSocket(InetAddress host, int port) throws IOException { return connect(host, port, source, 0); }
        @Override public Socket createSocket(String host, int port, InetAddress local, int localPort) throws IOException { return connect(InetAddress.getByName(host), port, local, localPort); }
        @Override public Socket createSocket(InetAddress host, int port, InetAddress local, int localPort) throws IOException { return connect(host, port, local, localPort); }
    }
}
