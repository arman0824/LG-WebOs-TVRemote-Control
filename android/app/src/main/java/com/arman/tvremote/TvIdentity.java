package com.arman.tvremote;

import android.security.keystore.*;
import java.math.BigInteger;
import java.net.Socket;
import java.security.*;
import java.security.cert.X509Certificate;
import java.security.interfaces.RSAPublicKey;
import java.util.*;
import javax.net.ssl.*;
import javax.security.auth.x500.X500Principal;

final class TvIdentity extends X509ExtendedKeyManager {
    private static final String ALIAS = "tv.remote.identity.v2.tls-client";
    private final PrivateKey key;
    final X509Certificate certificate;
    TvIdentity() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA", "AndroidKeyStore");
            generator.initialize(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                .setKeySize(2048).setDigests(KeyProperties.DIGEST_NONE, KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA384, KeyProperties.DIGEST_SHA512)
                // Conscrypt may pass a pre-padded TLS signature through raw RSA.
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1, KeyProperties.SIGNATURE_PADDING_RSA_PSS)
                .setCertificateSubject(new X500Principal("CN=Universal TV Remote"))
                .setCertificateSerialNumber(BigInteger.ONE).setCertificateNotBefore(new Date(System.currentTimeMillis() - 86400000L))
                .setCertificateNotAfter(new Date(System.currentTimeMillis() + 315360000000L)).build());
            generator.generateKeyPair();
        }
        key = (PrivateKey) store.getKey(ALIAS, null); certificate = (X509Certificate) store.getCertificate(ALIAS);
    }
    private static byte[] unsigned(BigInteger number) {
        byte[] value = number.toByteArray();
        return value.length > 1 && value[0] == 0 ? Arrays.copyOfRange(value, 1, value.length) : value;
    }
    static byte[] secret(X509Certificate client, X509Certificate server, String code) throws Exception {
        if (!code.matches("(?i)[0-9a-f]{6}")) throw new Exception("Enter all six letters/numbers shown on the TV.");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        for (X509Certificate cert : new X509Certificate[] { client, server }) {
            if (!(cert.getPublicKey() instanceof RSAPublicKey)) throw new Exception("Unsupported TV pairing certificate.");
            RSAPublicKey publicKey = (RSAPublicKey) cert.getPublicKey();
            digest.update(unsigned(publicKey.getModulus())); digest.update(unsigned(publicKey.getPublicExponent()));
        }
        digest.update((byte) Integer.parseInt(code.substring(2, 4), 16));
        digest.update((byte) Integer.parseInt(code.substring(4, 6), 16));
        return digest.digest();
    }
    @Override public String[] getClientAliases(String type, Principal[] issuers) { return "RSA".equals(type) ? new String[] { ALIAS } : null; }
    @Override public String chooseClientAlias(String[] types, Principal[] issuers, Socket socket) { for (String type : types) if (type.equals("RSA")) return ALIAS; return null; }
    @Override public String chooseEngineClientAlias(String[] types, Principal[] issuers, SSLEngine engine) { return chooseClientAlias(types, issuers, null); }
    @Override public X509Certificate[] getCertificateChain(String alias) { return new X509Certificate[] { certificate }; }
    @Override public PrivateKey getPrivateKey(String alias) { return key; }
    @Override public String[] getServerAliases(String type, Principal[] issuers) { return null; }
    @Override public String chooseServerAlias(String type, Principal[] issuers, Socket socket) { return null; }
}
