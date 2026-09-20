package com.arman.tvremote;

import java.security.MessageDigest;
import java.security.cert.*;
import javax.net.ssl.*;

/** Local self-signed TV certificates are pinned after TV-side approval. */
final class TvTls implements X509TrustManager {
    private final String savedPin;
    volatile String pin = "";
    volatile boolean changed;
    volatile X509Certificate peer;
    TvTls(String savedPin) { this.savedPin = savedPin; }
    @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
    @Override public void checkClientTrusted(X509Certificate[] chain, String auth) throws CertificateException { throw new CertificateException("Client certificate not expected."); }
    @Override public void checkServerTrusted(X509Certificate[] chain, String auth) throws CertificateException {
        try {
            if (chain.length == 0) throw new CertificateException("Missing TV certificate.");
            StringBuilder value = new StringBuilder();
            for (byte b : MessageDigest.getInstance("SHA-256").digest(chain[0].getEncoded())) value.append(String.format("%02x", b & 255));
            pin = value.toString(); peer = chain[0];
            if (!savedPin.isEmpty() && !savedPin.equals(pin)) { changed = true; throw new CertificateException("The TV certificate changed. Forget its saved pairing and pair again."); }
        } catch (CertificateException error) { throw error; }
        catch (Exception error) { throw new CertificateException(error); }
    }
    SSLContext context(KeyManager[] managers) throws Exception {
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(managers, new TrustManager[] { this }, null);
        return context;
    }
}
