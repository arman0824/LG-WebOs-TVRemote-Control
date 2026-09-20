package com.arman.tvremote;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

final class PairingStore {
    private final SharedPreferences prefs;
    private static final String ALIAS = "tv.remote.pairing.v1";
    PairingStore(Context context) { prefs = context.getSharedPreferences("tv_pairing", Context.MODE_PRIVATE); }
    private SecretKey secret() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    JSONObject get(String host) {
        try {
            String saved = prefs.getString("tv." + host, "");
            if (saved.isEmpty()) return new JSONObject();
            String[] parts = saved.split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, secret(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            cipher.updateAAD(host.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return new JSONObject(new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8));
        } catch (Exception e) { return new JSONObject(); }
    }
    void save(String host, JSONObject data) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, secret());
        cipher.updateAAD(host.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        String value = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(data.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!prefs.edit().putString("tv." + host, value).putString("lastHost", host).commit()) throw new Exception("Could not save the TV pairing on this phone.");
    }
    String lastHost() { return prefs.getString("lastHost", ""); }
    void forget(String host) {
        SharedPreferences.Editor edit = prefs.edit().remove("tv." + host);
        if (lastHost().equals(host)) edit.remove("lastHost");
        edit.apply();
    }
}
