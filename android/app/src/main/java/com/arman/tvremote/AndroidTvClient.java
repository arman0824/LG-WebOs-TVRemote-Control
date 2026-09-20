package com.arman.tvremote;

import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import javax.net.SocketFactory;
import javax.net.ssl.*;
import org.json.*;

final class AndroidTvClient implements TvClient {
    final String host;
    private final JSONObject keys;
    private final SocketFactory sockets;
    private final TvIdentity identity;
    private String pin;
    private volatile boolean connected;
    private SSLSocket pairing, control;
    private TvTls pairingTrust;
    private Timer expiry;
    AndroidTvClient(String host, String pin, JSONObject keys, SocketFactory sockets) throws Exception {
        this.host = host; this.pin = pin; this.keys = keys; this.sockets = sockets; identity = new TvIdentity();
    }
    private SSLSocket open(int port, TvTls trust) throws Exception {
        Socket plain = sockets.createSocket();
        try {
            plain.connect(new InetSocketAddress(host, port), 4000);
            SSLSocket ssl = (SSLSocket) trust.context(new KeyManager[] { identity }).getSocketFactory().createSocket(plain, host, port, true);
            ssl.setEnabledProtocols(new String[] { "TLSv1.2" });
            ssl.setSoTimeout(10000); ssl.startHandshake(); return ssl;
        } catch (Exception error) { plain.close(); if (trust.changed) throw new IOException("The TV certificate changed. Forget its saved pairing and pair again."); throw error; }
    }
    private static void send(SSLSocket socket, byte[] message) throws IOException {
        synchronized (socket) { socket.getOutputStream().write(Proto.join(Proto.varint(message.length), message)); socket.getOutputStream().flush(); }
    }
    private static Map<Integer, Object> read(SSLSocket socket) throws IOException {
        InputStream in = socket.getInputStream(); return Proto.decode(Proto.readBytes(in, Proto.readVarint(in)));
    }
    private void exchange(int field, byte[] message) throws Exception {
        send(pairing, message);
        // Limit unexpected messages as well as the per-read timeout.
        for (int count = 0; count < 8; count++) {
            Map<Integer, Object> reply = read(pairing);
            if (Proto.value(reply, 2) != 200) throw new IOException("TV rejected pairing. Start pairing again.");
            if (reply.containsKey(field)) return;
        }
        throw new IOException("The TV did not finish pairing. Try again.");
    }
    void startPairing() throws Exception {
        pairingTrust = new TvTls(""); pairing = open(6467, pairingTrust);
        byte[] encoding = Proto.join(Proto.number(1, 3), Proto.number(2, 6));
        exchange(11, Proto.outer(10, Proto.join(Proto.text(1, "atvremote"), Proto.text(2, "Universal TV Remote"))));
        exchange(20, Proto.outer(20, Proto.join(Proto.bytes(1, encoding), Proto.number(3, 1))));
        exchange(31, Proto.outer(30, Proto.join(Proto.bytes(1, encoding), Proto.number(2, 1))));
        expiry = new Timer(true);
        final SSLSocket waiting = pairing;
        expiry.schedule(new TimerTask() { @Override public void run() { try { waiting.close(); } catch (Exception ignored) { } } }, 120000);
    }
    void finishPairing(String code) throws Exception {
        if (pairing == null || pairing.isClosed()) throw new IOException("Pairing expired. Tap Connect to request a new code.");
        byte[] secret = TvIdentity.secret(identity.certificate, pairingTrust.peer, code);
        if ((secret[0] & 255) != Integer.parseInt(code.substring(0, 2), 16)) throw new IOException("That code does not match the TV. Check all six characters and tap Connect for a new code.");
        exchange(41, Proto.outer(40, Proto.bytes(1, secret)));
        pin = pairingTrust.pin; expiry.cancel(); pairing.close(); pairing = null; connect();
    }
    void connect() throws Exception {
        control = open(6466, new TvTls(pin));
        CompletableFuture<Void> ready = new CompletableFuture<>();
        final SSLSocket socket = control;
        Thread reader = new Thread(() -> {
            int features = 1 | 2 | 32 | 64;
            try {
                while (!socket.isClosed()) {
                    Map<Integer, Object> message = read(socket);
                    if (message.containsKey(1)) {
                        features &= Proto.value(Proto.nested(message, 1), 1);
                        if ((features & 2) == 0) throw new IOException("This TV does not expose remote key control.");
                        byte[] device = Proto.join(Proto.number(3, 1), Proto.text(4, "1"), Proto.text(5, "tvremote"), Proto.text(6, "2.0.0"));
                        send(socket, Proto.bytes(1, Proto.join(Proto.number(1, features), Proto.bytes(2, device))));
                    } else if (message.containsKey(2)) send(socket, Proto.bytes(2, Proto.number(1, features)));
                    else if (message.containsKey(8)) send(socket, Proto.bytes(9, Proto.number(1, Proto.value(Proto.nested(message, 8), 1))));
                    else if (message.containsKey(40)) { connected = true; socket.setSoTimeout(20000); ready.complete(null); }
                    else if (message.containsKey(3)) throw new IOException("TV refused the remote request. Try reconnecting.");
                }
            } catch (Exception error) { ready.completeExceptionally(error); }
            finally { connected = false; try { socket.close(); } catch (Exception ignored) { } }
        }, "tv-remote-reader");
        reader.setDaemon(true); reader.start();
        try { ready.get(12, TimeUnit.SECONDS); }
        catch (Exception error) { close(); throw new IOException("Android TV did not finish connecting. Check Android TV Remote Service, or forget its key and pair again.", error); }
    }
    String pin() { return pin; }
    @Override public boolean connected() { return connected; }
    @Override public JSONObject command(String name, JSONObject payload) throws Exception {
        if (!connected) throw new IOException("Connect to your TV first.");
        int code;
        if (name.equals("digit")) {
            String digit = payload.optString("digit");
            if (!digit.matches("[0-9]")) throw new IOException("Enter a single digit from 0 to 9.");
            code = Integer.parseInt(digit) + 7;
        } else {
            if (!keys.has(name)) throw new IOException("This control is not available on Android / Google TV.");
            code = keys.getInt(name);
        }
        send(control, Proto.bytes(10, Proto.join(Proto.number(1, code), Proto.number(2, 3))));
        if (name.equals("powerOff")) close();
        return TvController.json("ok", true);
    }
    @Override public void checkStatus() { }
    @Override public void close() {
        connected = false; if (expiry != null) expiry.cancel();
        try { if (pairing != null) pairing.close(); } catch (Exception ignored) { }
        try { if (control != null) control.close(); } catch (Exception ignored) { }
    }
}
