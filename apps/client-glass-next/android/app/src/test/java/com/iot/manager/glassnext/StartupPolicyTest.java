package com.iot.manager.glassnext;

import org.junit.Test;
import static org.junit.Assert.*;

public class StartupPolicyTest {
    @Test public void onlyRemainingHoldIsAdded() {
        assertEquals(130, StartupPolicy.remainingHold(50, false));
        assertEquals(0, StartupPolicy.remainingHold(3000, false));
        assertEquals(0, StartupPolicy.remainingHold(0, true));
    }
    @Test public void probesAreBoundedEvenWithoutAWebResponse() {
        assertEquals(250, StartupPolicy.probeDelay(0));
        assertEquals(1000, StartupPolicy.probeDelay(3));
        assertEquals(-1, StartupPolicy.probeDelay(4));
        assertEquals(-1, StartupPolicy.probeDelay(-1));
    }
    @Test public void activityRecreationAndRetryInvalidateOldIdentities() {
        assertTrue(StartupPolicy.matches("activity-a", 2, "activity-a", 2));
        assertFalse(StartupPolicy.matches("activity-a", 1, "activity-a", 2));
        assertFalse(StartupPolicy.matches("activity-old", 1, "activity-new", 1));
        assertFalse(StartupPolicy.matches(null, 1, "activity-new", 1));
    }
    @Test public void onlyAConfirmedWebCoverCanTakeOverBeforeHandoff() {
        assertTrue(StartupPolicy.canReleaseToWeb(false, true));
        assertFalse(StartupPolicy.canReleaseToWeb(true, true));
        assertFalse(StartupPolicy.canReleaseToWeb(false, false));
    }
}
