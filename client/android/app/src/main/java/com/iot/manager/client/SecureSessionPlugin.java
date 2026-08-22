package com.iot.manager.client;

import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Small local Capacitor bridge for OAuth material. EncryptedSharedPreferences
 * encrypts values with a key held by Android Keystore, so refresh tokens never
 * pass through the regular Capacitor Preferences database.
 */
@CapacitorPlugin(name = "SecureSession")
public class SecureSessionPlugin extends Plugin {
    private static final String PREFERENCES_NAME = "iot_manager_secure_session";
    private SharedPreferences preferences;

    @PluginMethod
    public void get(PluginCall call) {
        String key = key(call);
        if (key == null) return;
        try {
            JSObject result = new JSObject();
            result.put("value", preferences().getString(key, null));
            call.resolve(result);
        } catch (Exception exception) {
            call.reject("Unable to read secure session storage", exception);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = key(call);
        String value = call.getString("value");
        if (key == null) return;
        if (value == null) {
            call.reject("Secure session value is required");
            return;
        }
        try {
            preferences().edit().putString(key, value).apply();
            call.resolve();
        } catch (Exception exception) {
            call.reject("Unable to write secure session storage", exception);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = key(call);
        if (key == null) return;
        try {
            preferences().edit().remove(key).apply();
            call.resolve();
        } catch (Exception exception) {
            call.reject("Unable to clear secure session storage", exception);
        }
    }

    private String key(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.trim().isEmpty()) {
            call.reject("Secure session key is required");
            return null;
        }
        return key.trim();
    }

    private synchronized SharedPreferences preferences() throws Exception {
        if (preferences == null) {
            MasterKey masterKey = new MasterKey.Builder(getContext())
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build();
            preferences = EncryptedSharedPreferences.create(
                    getContext(),
                    PREFERENCES_NAME,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        }
        return preferences;
    }
}
