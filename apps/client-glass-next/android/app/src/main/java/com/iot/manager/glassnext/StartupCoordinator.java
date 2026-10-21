package com.iot.manager.glassnext;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ObjectAnimator;
import android.animation.PropertyValuesHolder;
import android.animation.ValueAnimator;
import android.content.pm.ApplicationInfo;
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
import java.util.UUID;

/** Exactly one visible cover; all delayed work belongs to one Activity/attempt. */
final class StartupCoordinator {
    private final MainActivity activity;
    private final String instanceId = UUID.randomUUID().toString();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = this::onTimeout, tryExit = this::maybeStartExit;
    private final Runnable animationDeadline = this::finishExit, probe = this::probeWebFallback;
    private long startedAt = SystemClock.elapsedRealtime();
    private int launchId = 1, probeAttempt = 0;
    private WebView webView;
    private SplashScreenViewProvider splashView;
    private View recoveryView, iconView;
    private StartupVisualPlugin plugin;
    private ObjectAnimator animator, pulse;
    private boolean webFallbackReady, prepared, frameReady, reducedMotion, timedOut;
    private boolean exiting, completed, webFallback, nativeFallback, destroyed, probeInFlight;
    private boolean foreground = true;

    StartupCoordinator(MainActivity activity) {
        this.activity = activity;
        handler.postDelayed(timeout, StartupPolicy.TIMEOUT_MS);
        trace("activity_create");
    }
    void bindPlugin(StartupVisualPlugin plugin) { this.plugin = plugin; }
    void onWebViewAvailable(WebView view) {
        webView = view;
        trace("webview_available");
        scheduleProbe();
    }
    void onSplashReady(SplashScreenViewProvider view) {
        if (destroyed || completed || splashView != null || nativeFallback || webFallback) { view.remove(); return; }
        splashView = view;
        view.getView().setAlpha(1f);
        iconView = view.getIconView();
        startPulse();
        trace("native_cover_ready");
        if (timedOut) onTimeout(); else maybeStartExit();
    }
    JSObject launchState() {
        JSObject state = new JSObject();
        state.put("protocolVersion", 2);
        state.put("activityInstanceId", instanceId);
        state.put("launchId", launchId);
        state.put("elapsedMs", elapsed());
        state.put("remainingWebRescueMs", Math.max(0, StartupPolicy.RESCUE_MS - elapsed()));
        state.put("phase", completed ? "COMPLETE" : exiting ? "EXITING" : nativeFallback ? "NATIVE_FALLBACK" : webFallback ? "WEB_FALLBACK" : "COVERING");
        state.put("coverOwner", completed ? "none" : webFallback ? "web" : "native");
        state.put("coverRemoved", currentCover() == null && (completed || webFallback));
        state.put("probeCount", probeAttempt);
        return state;
    }
    private boolean matches(int launch, String instance) {
        return !destroyed && StartupPolicy.matches(instance, launch, instanceId, launchId);
    }
    boolean prepareReveal(int launch, String instance, boolean reduced) {
        if (!matches(launch, instance) || prepared || timedOut || exiting || completed || nativeFallback || webFallback
            || elapsed() >= StartupPolicy.TIMEOUT_MS || !webViewReady()) return false;
        prepared = true;
        reducedMotion = reduced;
        stopPulse();
        handler.removeCallbacks(probe);
        trace("prepare_reveal");
        requestFrame();
        return true;
    }
    boolean reportWebCoverReady(int launch, String instance, boolean reduced) {
        if (!matches(launch, instance) || prepared || timedOut || completed || !webViewReady()) return false;
        reducedMotion = reduced;
        if (reduced) stopPulse();
        confirmWebCover(launchId);
        return true;
    }
    boolean setMotionPolicy(int launch, String instance, boolean reduced) {
        if (!matches(launch, instance) || completed || nativeFallback || webFallback) return false;
        reducedMotion = reduced;
        if (reduced) { stopPulse(); if (exiting && foreground) finishExit(); else maybeStartExit(); }
        else startPulse();
        return true;
    }
    boolean failStartup(int launch, String instance) {
        if (!matches(launch, instance) || completed || webFallback || nativeFallback) return false;
        stopExit();
        timedOut = nativeFallback = true;
        handler.removeCallbacks(timeout);
        handler.removeCallbacks(probe);
        stopPulse(); showRecovery(); removeSplash();
        trace("explicit_recovery");
        return true;
    }
    private void requestFrame() {
        if (!webViewReady() || !foreground || destroyed || timedOut || completed || !prepared) return;
        final int ticket = launchId;
        webView.postVisualStateCallback(ticket, new WebView.VisualStateCallback() {
            @Override public void onComplete(long id) {
                if (destroyed || ticket != launchId || timedOut || completed || !prepared || !foreground) return;
                frameReady = true; trace("frame_ready"); maybeStartExit();
            }
        });
    }
    private long elapsed() { return SystemClock.elapsedRealtime() - startedAt; }
    private boolean webViewReady() { return webView != null && webView.isAttachedToWindow() && webView.getVisibility() == View.VISIBLE; }
    private void scheduleProbe() {
        if (destroyed || prepared || timedOut || completed || webFallbackReady || probeInFlight) return;
        long delay = StartupPolicy.probeDelay(probeAttempt);
        if (delay < 0) return;
        handler.removeCallbacks(probe);
        handler.postDelayed(probe, delay);
    }
    private void probeWebFallback() {
        if (destroyed || webFallbackReady || prepared || timedOut || completed || probeInFlight) return;
        if (StartupPolicy.probeDelay(probeAttempt) < 0) return;
        probeAttempt++;
        if (!webViewReady()) { scheduleProbe(); return; }
        final int ticket = launchId;
        probeInFlight = true;
        webView.evaluateJavascript("(function(){var w=window.__iotStartupWatchdog;var e=document.getElementById('startup-overlay');var i=e&&e.querySelector('img');return !!(w&&w.setOwner&&e&&!e.hidden&&((i&&i.complete&&i.naturalWidth>0)||e.dataset.coverReady==='true'));})()", result -> {
            if (destroyed || ticket != launchId) return;
            probeInFlight = false;
            if (prepared || timedOut || completed) return;
            if ("true".equals(result)) confirmWebCover(ticket); else scheduleProbe();
        });
    }
    private void confirmWebCover(int ticket) {
        webView.postVisualStateCallback(ticket, new WebView.VisualStateCallback() {
            @Override public void onComplete(long id) {
                if (destroyed || ticket != launchId || prepared || timedOut || completed) return;
                webFallbackReady = true; handler.removeCallbacks(probe); trace("web_cover_ready");
            }
        });
    }
    private void maybeStartExit() {
        if (destroyed || timedOut || exiting || completed || !frameReady || !foreground || !webViewReady()) return;
        View cover = currentCover();
        if (cover == null) return;
        boolean reduced = reducedMotion || nativeAnimationsDisabled();
        long remaining = StartupPolicy.remainingHold(elapsed(), reduced);
        if (remaining > 0) { handler.removeCallbacks(tryExit); handler.postDelayed(tryExit, remaining); return; }
        exiting = true; stopPulse(); handler.removeCallbacks(timeout); trace("exit_started");
        if (reduced) { finishExit(); return; }
        final int ticket = launchId;
        animator = ObjectAnimator.ofFloat(cover, View.ALPHA, cover.getAlpha(), 0f);
        animator.setDuration(StartupPolicy.EXIT_MS);
        animator.setInterpolator(new PathInterpolator(.22f, 1f, .36f, 1f));
        animator.addListener(new AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(Animator animation) { if (ticket == launchId) finishExit(); }
        });
        animator.start();
        handler.postDelayed(animationDeadline, StartupPolicy.EXIT_DEADLINE_MS);
    }
    private boolean nativeAnimationsDisabled() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) return !ValueAnimator.areAnimatorsEnabled();
        return Settings.Global.getFloat(activity.getContentResolver(), "animator_duration_scale", 1f) == 0f;
    }
    private void startPulse() {
        if (iconView == null || pulse != null || destroyed || prepared || exiting || completed || timedOut
            || !foreground || reducedMotion || nativeAnimationsDisabled()) return;
        pulse = ObjectAnimator.ofPropertyValuesHolder(iconView,
            PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.015f), PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.015f));
        pulse.setDuration(1000); pulse.setRepeatCount(ValueAnimator.INFINITE); pulse.setRepeatMode(ValueAnimator.REVERSE); pulse.start();
    }
    private void stopPulse() {
        if (pulse != null) { pulse.cancel(); pulse = null; }
        if (iconView != null) { iconView.setScaleX(1f); iconView.setScaleY(1f); }
    }
    private View currentCover() { return splashView != null ? splashView.getView() : recoveryView; }
    private void stopExit() {
        handler.removeCallbacks(animationDeadline); handler.removeCallbacks(tryExit);
        if (animator != null) { animator.removeAllListeners(); animator.cancel(); animator = null; }
        exiting = false;
    }
    private void finishExit() {
        if (destroyed || completed || !exiting || !foreground) return;
        completed = true; stopExit(); stopPulse();
        handler.removeCallbacks(timeout); handler.removeCallbacks(probe);
        removeSplash(); removeRecovery(); trace("exit_completed");
        if (plugin != null) plugin.emitExitComplete(launchId, instanceId);
    }
    private void onTimeout() {
        if (destroyed || exiting || completed || webFallback || nativeFallback) return;
        timedOut = true; handler.removeCallbacks(tryExit); handler.removeCallbacks(probe); stopPulse();
        if (StartupPolicy.canReleaseToWeb(prepared, webFallbackReady)) {
            webFallback = true; removeSplash(); removeRecovery(); trace("timeout_web_fallback");
            // One ownership notification, including when the main module never loaded.
            if (webViewReady()) webView.evaluateJavascript("if(window.__iotStartupWatchdog){window.__iotStartupWatchdog.setOwner('web');}", null);
        } else { nativeFallback = true; showRecovery(); removeSplash(); trace("timeout_native_recovery"); }
    }
    private void showRecovery() {
        if (recoveryView == null) {
            recoveryView = activity.getLayoutInflater().inflate(R.layout.startup_recovery, null);
            activity.addContentView(recoveryView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        View retry = recoveryView.findViewById(R.id.startup_retry);
        retry.setVisibility(View.VISIBLE); retry.setEnabled(true); retry.setOnClickListener(view -> retry());
        recoveryView.setAlpha(1f);
        ((android.widget.TextView) recoveryView.findViewById(R.id.startup_message)).setText(R.string.startup_recovery_message);
    }
    private void retry() {
        if (destroyed || !nativeFallback) return;
        stopExit(); stopPulse(); handler.removeCallbacksAndMessages(null);
        launchId++; startedAt = SystemClock.elapsedRealtime(); probeAttempt = 0;
        webFallbackReady = prepared = frameReady = reducedMotion = timedOut = completed = webFallback = nativeFallback = probeInFlight = false;
        recoveryView.findViewById(R.id.startup_retry).setEnabled(false);
        recoveryView.findViewById(R.id.startup_retry).setVisibility(View.INVISIBLE);
        ((android.widget.TextView) recoveryView.findViewById(R.id.startup_message)).setText(R.string.startup_waiting_message);
        handler.postDelayed(timeout, StartupPolicy.TIMEOUT_MS); trace("retry");
        if (webView == null) { activity.recreate(); return; }
        try { webView.reload(); scheduleProbe(); } catch (Exception ignored) { activity.recreate(); }
    }
    void onVisibilityChanged(boolean visible) {
        foreground = visible;
        if (destroyed || completed) return;
        if (!visible) {
            stopPulse();
            if (prepared) frameReady = false;
            if (exiting) { stopExit(); frameReady = false; View cover = currentCover(); if (cover != null) cover.setAlpha(1f);
                handler.postDelayed(timeout, Math.max(0, StartupPolicy.TIMEOUT_MS - elapsed())); }
        } else if (prepared && !timedOut) requestFrame(); else startPulse();
    }
    private void removeSplash() {
        stopPulse(); iconView = null;
        if (splashView != null) { SplashScreenViewProvider old = splashView; splashView = null; old.remove(); }
    }
    private void removeRecovery() {
        if (recoveryView != null && recoveryView.getParent() instanceof ViewGroup) ((ViewGroup) recoveryView.getParent()).removeView(recoveryView);
        recoveryView = null;
    }
    void destroy() { destroyed = true; handler.removeCallbacksAndMessages(null); stopExit(); stopPulse(); removeSplash(); removeRecovery(); plugin = null; }
    private void trace(String event) { if ((activity.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) Log.i("StartupVisual", "instance=" + instanceId + " launchId=" + launchId + " elapsedMs=" + elapsed() + " " + event); }
}
