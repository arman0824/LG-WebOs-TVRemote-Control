package com.arman.lgremote;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.concurrent.*;
import org.json.JSONObject;

public class WebOsSocketTest {
    @Test public void promptAcknowledgementDoesNotCountAsPairing() throws Exception {
        WebOsClient.Socket socket = new WebOsClient.Socket();
        WebOsClient.Pending pending = new WebOsClient.Pending(true);
        socket.pending.put("register", pending);
        socket.onMessage(null, "{\"id\":\"register\",\"type\":\"response\",\"payload\":{\"pairingType\":\"PROMPT\"}}");
        assertFalse(pending.future.isDone());
        socket.onMessage(null, "{\"id\":\"register\",\"type\":\"registered\",\"payload\":{\"client-key\":\"saved-key\"}}");
        assertEquals("saved-key", pending.future.get().getJSONObject("payload").getString("client-key"));
    }
    @Test public void refusalAndCloseRejectPendingRequests() throws Exception {
        WebOsClient.Socket socket = new WebOsClient.Socket();
        WebOsClient.Pending pending = new WebOsClient.Pending(true);
        socket.pending.put("register", pending);
        socket.onMessage(null, "{\"id\":\"register\",\"type\":\"error\",\"error\":\"403 rejected\"}");
        assertTrue(pending.future.isCompletedExceptionally());
        WebOsClient.Pending command = new WebOsClient.Pending(false);
        socket.pending.put("command", command);
        socket.fail(new java.io.IOException("Closed"));
        assertTrue(command.future.isCompletedExceptionally()); assertTrue(socket.closed);
    }
}
