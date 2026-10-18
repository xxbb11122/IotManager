package com.iot.manager.glassnext;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import android.os.SystemClock;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Instrumented ownership/recovery tests. No device commands or login actions. */
@RunWith(AndroidJUnit4.class)
public class StartupCoordinatorTest {
    @Test public void retryWithoutJavaScriptReachesNativeRecoveryAndRejectsTheOldAttempt() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<String> instance = new AtomicReference<>();
            scenario.onActivity(activity -> {
                StartupCoordinator value = activity.getStartupCoordinator();
                int launch = value.launchState().optInt("launchId");
                instance.set(value.launchState().optString("activityInstanceId"));
                assertTrue(value.failStartup(launch, instance.get()));
                activity.getBridge().getWebView().getSettings().setJavaScriptEnabled(false);
                activity.findViewById(R.id.startup_retry).performClick();
                assertEquals(launch + 1, value.launchState().optInt("launchId"));
                assertFalse(activity.findViewById(R.id.startup_retry).isEnabled());
                assertFalse(value.prepareReveal(launch, instance.get(), false));
            });
            AtomicReference<String> phase = new AtomicReference<>();
            long deadline = SystemClock.elapsedRealtime() + 11000;
            do {
                SystemClock.sleep(200);
                scenario.onActivity(activity -> phase.set(activity.getStartupCoordinator().launchState().optString("phase")));
            } while (!"NATIVE_FALLBACK".equals(phase.get()) && SystemClock.elapsedRealtime() < deadline);
            assertEquals("NATIVE_FALLBACK", phase.get());
            scenario.onActivity(activity -> {
                assertTrue(activity.findViewById(R.id.startup_retry).isEnabled());
                assertTrue(activity.getStartupCoordinator().launchState().optInt("probeCount") <= 4);
            });
        }
    }

    @Test public void recoveryIsVisibleAndCannotBePassedByALateReady() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                StartupCoordinator value = activity.getStartupCoordinator();
                int launch = value.launchState().optInt("launchId");
                String instance = value.launchState().optString("activityInstanceId");
                boolean accepted = value.failStartup(launch, instance);
                assertTrue("Cold activity must still own its startup cover", accepted);
                assertEquals("NATIVE_FALLBACK", value.launchState().optString("phase"));
                assertNotNull(activity.findViewById(R.id.startup_recovery));
                assertTrue(activity.findViewById(R.id.startup_retry).isEnabled());
                assertFalse(value.prepareReveal(launch, instance, false));
                assertFalse(value.failStartup(launch, instance));
            });
        }
    }

    @Test public void activityRecreationRejectsAnOldActivityWithTheSameLaunchNumber() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<String> old = new AtomicReference<>();
            scenario.onActivity(activity -> old.set(activity.getStartupCoordinator().launchState().optString("activityInstanceId")));
            scenario.recreate();
            scenario.onActivity(activity -> {
                StartupCoordinator value = activity.getStartupCoordinator();
                assertNotEquals(old.get(), value.launchState().optString("activityInstanceId"));
                int launch = value.launchState().optInt("launchId");
                assertFalse(value.prepareReveal(launch, old.get(), false));
                assertFalse(value.reportWebCoverReady(launch, old.get(), true));
                assertFalse(value.failStartup(launch, old.get()));
            });
        }
    }
}
