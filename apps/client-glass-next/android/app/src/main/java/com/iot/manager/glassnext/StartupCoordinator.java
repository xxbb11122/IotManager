package com.iot.manager.glassnext;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.PathInterpolator;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.core.splashscreen.SplashScreenViewProvider;

import com.getcapacitor.JSObject;

/** Owns the one visible Android startup cover and its bounded failure paths. */
final class StartupCoordinator {
    private static final String TAG = "StartupVisual";
    private static final long MIN_HOLD_MS = 800;
    private static final long EXIT_MS = 360;
    // The WebView can need several seconds to load its first module on a cold
    // renderer. Keep a single native cover through that normal startup work.
    private static final long STARTUP_TIMEOUT_MS = 8000;
    private static final long WEB_RESCUE_MS = 9500;
    private static final long PROBE_INTERVAL_MS = 120;

    private final MainActivity activity;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = this::onTimeout;
    private final Runnable tryExit = this::maybeStartExit;
    private final Runnable animationDeadline = this::finishExit;

    private long startedAt = SystemClock.elapsedRealtime();
    private int launchId = 1;
    private WebView webView;
    private SplashScreenViewProvider splashView;
    private View recoveryView;
    private StartupVisualPlugin plugin;
    private ObjectAnimator animator;
    private boolean webFallbackReady;
    private boolean handoffRequested;
    private boolean prepared;
    private boolean frameReady;
    private boolean reducedMotion;
    private boolean timedOut;
    private boolean exiting;
    private boolean completed;
    private boolean webFallback;
    private boolean nativeFallback;
    private boolean destroyed;

    StartupCoordinator(MainActivity activity) {
        this.activity = activity;
        handler.postDelayed(timeout, STARTUP_TIMEOUT_MS);
    }

    void bindPlugin(StartupVisualPlugin plugin) {
        this.plugin = plugin;
    }

    void onWebViewAvailable(WebView webView) {
        this.webView = webView;
        trace("webview_available");
        probeWebFallback();
    }

    void onSplashReady(SplashScreenViewProvider splashView) {
        if (destroyed) {
            splashView.remove();
            return;
        }
        if (this.splashView != null) {
            splashView.remove();
            return;
        }
        this.splashView = splashView;
        splashView.getView().setAlpha(1f);
        trace("splash_ready");
        if (timedOut) onTimeout();
        else maybeStartExit();
    }

    JSObject launchState() {
        if (!timedOut && !completed) handoffRequested = true;
        JSObject state = new JSObject();
        state.put("launchId", launchId);
        state.put("remainingWebRescueMs", Math.max(0, WEB_RESCUE_MS - elapsed()));
        String phase = completed ? "COMPLETE" : exiting ? "EXITING" : nativeFallback ? "NATIVE_FALLBACK"
                : webFallback ? "WEB_FALLBACK" : "COVERING";
        state.put("phase", phase);
        trace("launch_state=" + phase);
        return state;
    }

    boolean prepareReveal(int requestedLaunchId, boolean reducedMotion) {
        if (destroyed || requestedLaunchId != launchId || prepared || timedOut || exiting || completed
                || nativeFallback || webFallback || elapsed() >= STARTUP_TIMEOUT_MS || !webViewReady()) return false;
        prepared = true;
        this.reducedMotion = reducedMotion;
        trace("prepare_reveal");
        final int requestLaunchId = launchId;
        webView.postVisualStateCallback(requestLaunchId, new WebView.VisualStateCallback() {
            @Override
            public void onComplete(long requestId) {
                if (destroyed || requestLaunchId != launchId || timedOut || completed || !prepared) return;
                frameReady = true;
                trace("frame_ready");
                maybeStartExit();
            }
        });
        return true;
    }

    private long elapsed() {
        return SystemClock.elapsedRealtime() - startedAt;
    }

    private boolean webViewReady() {
        return webView != null && webView.isAttachedToWindow() && webView.getVisibility() == View.VISIBLE;
    }

    private void probeWebFallback() {
        if (destroyed || webFallbackReady || prepared || timedOut || completed || elapsed() >= STARTUP_TIMEOUT_MS) return;
        if (!webViewReady()) {
            handler.postDelayed(this::probeWebFallback, PROBE_INTERVAL_MS);
            return;
        }
        final int requestLaunchId = launchId;
        webView.evaluateJavascript("(function(){var e=document.getElementById('startup-overlay');var i=e&&e.querySelector('img');return !!(e&&!e.hidden&&i&&i.complete&&i.naturalWidth>0);})()", result -> {
            if (destroyed || requestLaunchId != launchId || prepared || timedOut) return;
            if (!"true".equals(result)) {
                handler.postDelayed(this::probeWebFallback, PROBE_INTERVAL_MS);
                return;
            }
            webView.postVisualStateCallback(requestLaunchId, new WebView.VisualStateCallback() {
                @Override
                public void onComplete(long requestId) {
                    if (!destroyed && requestLaunchId == launchId && !prepared && !timedOut) {
                        webFallbackReady = true;
                        trace("web_fallback_ready");
                    }
                }
            });
        });
    }

    private void maybeStartExit() {
        if (destroyed || timedOut || exiting || completed || !frameReady) return;
        View cover = currentCover();
        if (cover == null) return;
        long remaining = MIN_HOLD_MS - elapsed();
        if (!reducedMotion && remaining > 0) {
            handler.removeCallbacks(tryExit);
            handler.postDelayed(tryExit, remaining);
            return;
        }
        exiting = true;
        trace("exit_started");
        handler.removeCallbacks(timeout);
        if (reducedMotion || nativeAnimationsDisabled()) {
            finishExit();
            return;
        }
        animator = ObjectAnimator.ofFloat(cover, View.ALPHA, 1f, 0f);
        animator.setDuration(EXIT_MS);
        animator.setInterpolator(new PathInterpolator(.22f, 1f, .36f, 1f));
        animator.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                finishExit();
            }

            @Override
            public void onAnimationCancel(Animator animation) {
                finishExit();
            }
        });
        animator.start();
        handler.postDelayed(animationDeadline, EXIT_MS + 180);
    }

    private boolean nativeAnimationsDisabled() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) return !ValueAnimator.areAnimatorsEnabled();
        return Settings.Global.getFloat(activity.getContentResolver(), "animator_duration_scale", 1f) == 0f;
    }

    private View currentCover() {
        if (splashView != null) return splashView.getView();
        return recoveryView;
    }

    private void finishExit() {
        if (destroyed || completed || !exiting) return;
        completed = true;
        trace("exit_completed");
        handler.removeCallbacks(animationDeadline);
        if (animator != null) {
            ObjectAnimator finishedAnimator = animator;
            animator = null;
            finishedAnimator.removeAllListeners();
            finishedAnimator.cancel();
        }
        removeSplash();
        removeRecovery();
        if (plugin != null) plugin.emitExitComplete(launchId);
    }

    private void onTimeout() {
        if (destroyed || exiting || completed || webFallback || nativeFallback) return;
        timedOut = true;
        handler.removeCallbacks(tryExit);
        if (currentCover() == null) return;
        if (!handoffRequested && !prepared && webFallbackReady) {
            webFallback = true;
            trace("timeout_web_fallback");
            removeSplash();
            removeRecovery();
            return;
        }
        nativeFallback = true;
        trace("timeout_native_fallback");
        showRecovery();
        removeSplash();
    }

    private void showRecovery() {
        if (recoveryView != null) return;
        recoveryView = activity.getLayoutInflater().inflate(R.layout.startup_recovery, null);
        recoveryView.findViewById(R.id.startup_retry).setOnClickListener(view -> retry());
        activity.addContentView(recoveryView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void retry() {
        if (destroyed || !nativeFallback) return;
        launchId += 1;
        startedAt = SystemClock.elapsedRealtime();
        trace("retry");
        webFallbackReady = handoffRequested = prepared = frameReady = reducedMotion = timedOut = exiting = completed = webFallback = nativeFallback = false;
        handler.removeCallbacks(timeout);
        handler.removeCallbacks(tryExit);
        handler.removeCallbacks(animationDeadline);
        if (recoveryView != null) recoveryView.setAlpha(1f);
        handler.postDelayed(timeout, STARTUP_TIMEOUT_MS);
        if (webView == null) {
            activity.recreate();
            return;
        }
        try {
            webView.reload();
            handler.postDelayed(this::probeWebFallback, PROBE_INTERVAL_MS);
        } catch (Exception exception) {
            activity.recreate();
        }
    }

    private void removeSplash() {
        if (splashView == null) return;
        SplashScreenViewProvider view = splashView;
        splashView = null;
        view.remove();
    }

    private void removeRecovery() {
        if (recoveryView == null) return;
        View view = recoveryView;
        recoveryView = null;
        if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
    }

    void destroy() {
        destroyed = true;
        handler.removeCallbacksAndMessages(null);
        if (animator != null) {
            animator.removeAllListeners();
            animator.cancel();
            animator = null;
        }
        removeSplash();
        removeRecovery();
        plugin = null;
    }

    private void trace(String event) {
        Log.i(TAG, "launchId=" + launchId + " elapsedMs=" + elapsed() + " " + event);
    }
}
