package com.iot.manager.edgeagent.driver;

import com.iot.manager.edgeagent.protocol.DiscoveredDevice;
import com.iot.manager.edgeagent.protocol.DriverDescriptor;

import java.util.List;
import java.util.Set;

/** Contract for one local device family. Protocol encoding stays inside the implementing driver. */
public interface DeviceDriver {
    String driverId();

    String driverVersion();

    Set<String> supportedProfileIds();

    List<DiscoveredDevice> discover(DiscoveryContext context);

    DriverCommandResult execute(DeviceCommand command) throws DeviceDriverException;

    default DriverDescriptor descriptor() {
        return new DriverDescriptor(driverId(), driverVersion(), supportedProfileIds().stream().sorted().toList());
    }
}
