package com.arman.tvremote;

import java.io.*;
import java.util.*;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.*;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class MultiSystemTest {
    @Test public void rokuPlayerDoesNotAdvertiseTelevisionOnlyKeys() throws Exception {
        try (MockWebServer tv = new MockWebServer()) {
            tv.start();
            RokuClient client = new RokuClient(tv.url("/").toString().replaceAll("/$", ""), new JSONObject("{\"buttonHome\":\"Home\"}"), new JSONObject("{\"volumeUp\":\"VolumeUp\"}"), new OkHttpClient());
            tv.enqueue(new MockResponse().setBody("<device-info><is-tv>false</is-tv></device-info>"));
            client.connect(); assertTrue(client.connected()); assertFalse(client.capabilities().toString().contains("volumeUp")); tv.takeRequest();
            tv.enqueue(new MockResponse()); client.command("buttonHome", new JSONObject());
            assertEquals("/keypress/Home", tv.takeRequest().getPath());
            try { client.command("volumeUp", new JSONObject()); fail(); } catch (IOException expected) { }
            tv.enqueue(new MockResponse().setBody("<device-info><is-tv>true</is-tv></device-info>"));
            client.connect(); assertTrue(client.capabilities().toString().contains("volumeUp")); tv.takeRequest();
            tv.enqueue(new MockResponse().setResponseCode(403));
            try { client.command("volumeUp", new JSONObject()); fail(); } catch (IOException expected) { assertTrue(expected.getMessage().contains("Network access")); }
            client.close();
        }
    }
    @Test public void samsungSocketOpenIsNotApprovalAndDenialClearsState() {
        SamsungClient.Session session = new SamsungClient.Session("");
        session.onOpen(null, null); assertTrue(session.opened.isDone()); assertFalse(session.authorized);
        session.onMessage(null, "{\"event\":\"ms.channel.connect\",\"data\":{\"token\":\"saved-token\"}}");
        assertTrue(session.authorized); assertEquals("saved-token", session.token); assertTrue(session.approved.isDone());
        session.onMessage(null, "{\"event\":\"ms.channel.unauthorized\"}"); assertFalse(session.authorized); assertTrue(session.closed);
        SamsungClient.Session denied = new SamsungClient.Session(""); denied.onMessage(null, "{\"event\":\"ms.channel.unauthorized\"}"); assertTrue(denied.approved.isCompletedExceptionally());
    }
    @Test public void androidTvWireEncodingMatchesProtocolAndReadsFragmentedInput() throws Exception {
        assertArrayEquals(new byte[] { 0x52, 4, 8, 3, 16, 3 }, Proto.bytes(10, Proto.join(Proto.number(1, 3), Proto.number(2, 3))));
        byte[] message = Proto.join(Proto.number(1, 2), Proto.number(2, 200));
        assertEquals(200, Proto.value(Proto.decode(message), 2));
        byte[] frame = Proto.join(Proto.varint(160), new byte[160]);
        InputStream slow = new ByteArrayInputStream(frame) { @Override public int read(byte[] b, int off, int len) { return super.read(b, off, Math.min(1, len)); } };
        assertEquals(160, Proto.readBytes(slow, Proto.readVarint(slow)).length);
        try { Proto.decode(new byte[] { 10, 20, 1 }); fail(); } catch (IOException expected) { }
        try { Proto.readVarint(new ByteArrayInputStream(new byte[] { -1, -1, -1, -1, -1 })); fail(); } catch (IOException expected) { }
    }
    @Test public void mdnsUnderstandsCompressedAndroidTvNamesAndRejectsTruncation() throws Exception {
        byte[] query = Mdns.query(); query[2] = (byte) 128; query[7] = 1;
        byte[] record = { (byte) 192, 12, 0, 12, 0, 1, 0, 0, 0, 60, 0, 10, 7 };
        byte[] data = Proto.join(query, record, "Bedroom".getBytes("UTF-8"), new byte[] { (byte) 192, 12 });
        assertEquals("Bedroom", Mdns.response(data)); assertEquals("", Mdns.response(Arrays.copyOf(data, data.length - 1)));
        assertEquals("", Mdns.response(new byte[] { 1, 2 }));
    }
    @Test public void unfamiliarBrandsAreNotAutomaticallyTreatedAsWebos() {
        assertEquals("auto", Discovery.system("Sony MediaRenderer"));
        assertEquals("androidtv", Discovery.system("_androidtvremote2._tcp.local"));
        assertEquals("samsung", Discovery.system("Samsung SmartTV"));
        assertEquals("roku", Discovery.system("Roku ECP"));
    }
}
