package com.arman.tvremote;

import org.junit.*;
import static org.junit.Assert.*;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.*;
import org.json.JSONObject;

public class NetcastClientTest {
    private MockWebServer tv;
    private NetcastClient client;
    @Before public void setup() throws Exception {
        tv = new MockWebServer(); tv.start();
        client = new NetcastClient(tv.url("/roap/api/").toString(), new JSONObject("{\"volumeUp\":24,\"powerOff\":1}"), new OkHttpClient());
    }
    @After public void finish() throws Exception { client.close(); tv.shutdown(); }
    private void respond(String body) { tv.enqueue(new MockResponse().setBody(body)); }
    @Test public void pairingAndCommandsUseTheTvSession() throws Exception {
        respond("<envelope><ROAPError>401</ROAPError></envelope>");
        assertTrue(client.detect()); tv.takeRequest();
        respond("<envelope><ROAPError>200</ROAPError></envelope>");
        client.showCode(); assertTrue(tv.takeRequest().getBody().readUtf8().contains("AuthKeyReq"));
        respond("<envelope><ROAPError>200</ROAPError><session>12345</session></envelope>");
        client.pair("123456");
        assertTrue(client.connected()); assertEquals("123456", client.key());
        assertTrue(tv.takeRequest().getBody().readUtf8().contains("<value>123456</value>"));
        respond("<envelope><ROAPError>200</ROAPError></envelope>");
        client.command("volumeUp", new JSONObject());
        String command = tv.takeRequest().getBody().readUtf8();
        assertTrue(command.contains("<session>12345</session>")); assertTrue(command.contains("<value>24</value>"));
        respond("<envelope><ROAPError>200</ROAPError></envelope>");
        client.command("digit", new JSONObject("{\"digit\":\"9\"}"));
        assertTrue(tv.takeRequest().getBody().readUtf8().contains("<value>11</value>"));
    }
    @Test public void invalidPairingAndExpiredSessionsAreNotConnected() throws Exception {
        try { client.pair("123"); fail(); } catch (java.io.IOException expected) { }
        assertEquals(0, tv.getRequestCount());
        respond("<ROAPError>401</ROAPError><ROAPErrorDetail>Unauthorized</ROAPErrorDetail>");
        try { client.pair("123456"); fail(); } catch (NetcastClient.TvError expected) { assertEquals(401, expected.code); }
        assertFalse(client.connected());
    }
    @Test public void unrelatedHttpServerIsNotATv() {
        respond("<html>Not a TV</html>"); assertFalse(client.detect());
    }
    @Test public void powerOffClearsConnection() throws Exception {
        respond("<ROAPError>200</ROAPError><session>10</session>"); client.pair("123456");
        respond("<ROAPError>200</ROAPError>"); client.command("powerOff", new JSONObject());
        assertFalse(client.connected());
    }
    @Test public void onlyLocalIpv4AddressesCanBeSelected() {
        assertTrue(TvController.isLocalHost("10.154.197.178"));
        assertTrue(TvController.isLocalHost("192.168.1.42"));
        assertTrue(TvController.isLocalHost("172.18.1.2"));
        for (String bad : new String[] { "8.8.8.8", "127.0.0.1", "192.168.1.999", "evil.test", "10.1.1.2/path", "172.32.1.2", "<xml>" }) assertFalse(bad, TvController.isLocalHost(bad));
    }
}
