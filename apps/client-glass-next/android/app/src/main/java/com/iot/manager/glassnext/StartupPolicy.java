package com.iot.manager.glassnext;

/** Pure timing/ownership decisions, shared by coordinator and local JUnit tests. */
final class StartupPolicy {
    static final long MIN_HOLD_MS = 180, EXIT_MS = 340, EXIT_DEADLINE_MS = 480;
    static final long TIMEOUT_MS = 8000, RESCUE_MS = 9500;
    static final long[] PROBE_DELAYS = {250, 500, 1000, 1000};

    static long remainingHold(long elapsed, boolean reduced) {
        return reduced ? 0 : Math.max(0, MIN_HOLD_MS - Math.max(0, elapsed));
    }
    static long probeDelay(int attempt) {
        return attempt >= 0 && attempt < PROBE_DELAYS.length ? PROBE_DELAYS[attempt] : -1;
    }
    static boolean matches(String instance, int launch, String expectedInstance, int expectedLaunch) {
        return instance != null && instance.equals(expectedInstance) && launch == expectedLaunch;
    }
    static boolean canReleaseToWeb(boolean prepared, boolean webReady) {
        return !prepared && webReady;
    }
}
