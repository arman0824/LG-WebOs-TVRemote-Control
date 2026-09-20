package com.arman.lgremote;

import java.net.*;
import java.util.*;
import okhttp3.*;
import okhttp3.mockwebserver.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class LocalNetworkTest {
    private LocalNetwork.Route route(String address, int prefix) throws Exception {
        return new LocalNetwork.Route(InetAddress.getByName(address), prefix, null, null);
    }

    @Test public void hotspotIsSelectedEvenWithAnotherWifiInterface() throws Exception {
        LocalNetwork.Route wifi = route("192.168.1.20", 24);
        LocalNetwork.Route hotspot = route("192.168.173.1", 24);
        List<LocalNetwork.Route> routes = Arrays.asList(wifi, hotspot);
        assertSame(hotspot, LocalNetwork.select(routes, InetAddress.getByName("192.168.173.42")));
        assertSame(wifi, LocalNetwork.select(routes, InetAddress.getByName("192.168.1.42")));
    }

    @Test public void hotspotAddressesAndPrefixesAreNotHardcoded() throws Exception {
        for (String[] pair : new String[][] {
                { "172.20.10.1", "172.20.10.3", "28" },
                { "10.42.16.1", "10.42.17.9", "23" },
                { "192.168.43.1", "192.168.43.120", "24" } }) {
            LocalNetwork.Route hotspot = route(pair[0], Integer.parseInt(pair[2]));
            assertSame(hotspot, LocalNetwork.select(Collections.singletonList(hotspot), InetAddress.getByName(pair[1])));
        }
    }

    @Test public void mostSpecificSubnetWinsAndUnrelatedHotspotIsNotForced() throws Exception {
        LocalNetwork.Route broad = route("10.0.0.1", 8), narrow = route("10.42.0.1", 24);
        assertSame(narrow, LocalNetwork.select(Arrays.asList(broad, narrow), InetAddress.getByName("10.42.0.2")));
        assertNull(LocalNetwork.select(Collections.singletonList(narrow), InetAddress.getByName("192.168.1.42")));
        assertNull(LocalNetwork.select(Collections.emptyList(), InetAddress.getByName("192.168.1.42")));
    }

    @Test public void subnetBoundariesAndInvalidPrefixesDoNotMatch() throws Exception {
        InetAddress address = InetAddress.getByName("172.20.10.1");
        assertFalse(LocalNetwork.contains(address, 28, InetAddress.getByName("172.20.10.16")));
        assertFalse(LocalNetwork.contains(address, 0, address));
        assertFalse(LocalNetwork.contains(address, 33, address));
        assertFalse(LocalNetwork.contains(address, 24, InetAddress.getByName("::1")));
        assertTrue(LocalNetwork.contains(address, 32, address));
        assertFalse(LocalNetwork.contains(address, 32, InetAddress.getByName("172.20.10.2")));
    }

    @Test public void sourceBoundSocketsCarryHttpRequests() throws Exception {
        InetAddress source = InetAddress.getByName("127.0.0.1");
        LocalNetwork.SourceSockets sockets = new LocalNetwork.SourceSockets(source);
        try (java.net.Socket socket = sockets.createSocket()) {
            assertTrue(socket.isBound());
            assertEquals(source, socket.getLocalAddress());
            assertFalse(socket.isConnected());
        }
        try (MockWebServer tv = new MockWebServer()) {
            tv.start(source, 0);
            tv.enqueue(new MockResponse().setBody("TV response"));
            OkHttpClient client = new OkHttpClient.Builder().socketFactory(sockets).proxy(Proxy.NO_PROXY).build();
            try (Response response = client.newCall(new Request.Builder().url(tv.url("/roap/api/data")).build()).execute()) {
                assertEquals("TV response", response.body().string());
            }
            assertEquals("/roap/api/data", tv.takeRequest().getPath());
            client.connectionPool().evictAll();
        }
    }
}
