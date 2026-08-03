package com.iot.manager.edgeagent.protocol;

import java.util.List;

/** Declares a driver offered by an individual agent installation. */
public record DriverDescriptor(String driverId, String driverVersion, List<String> profileIds) {
    public DriverDescriptor {
        driverId = ProtocolValue.text(driverId, "driverId");
        driverVersion = ProtocolValue.text(driverVersion, "driverVersion");
        profileIds = ProtocolValue.list(profileIds, "profileIds");
    }
}
