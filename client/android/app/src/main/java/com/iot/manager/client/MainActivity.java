package com.iot.manager.client;

import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private StartupCoordinator startupCoordinator;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        startupCoordinator = new StartupCoordinator(this);
        splashScreen.setOnExitAnimationListener(startupCoordinator::onSplashReady);
        registerPlugin(SecureSessionPlugin.class);
        registerPlugin(StartupVisualPlugin.class);
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(getColor(R.color.startup_background));
            startupCoordinator.onWebViewAvailable(getBridge().getWebView());
        }
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (debuggable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getBridge().getWebView().getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
    }

    StartupCoordinator getStartupCoordinator() {
        return startupCoordinator;
    }

    @Override
    public void onDestroy() {
        if (startupCoordinator != null) startupCoordinator.destroy();
        super.onDestroy();
    }
}
