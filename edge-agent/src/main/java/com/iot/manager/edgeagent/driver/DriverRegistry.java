package com.iot.manager.edgeagent.driver;

import com.iot.manager.edgeagent.protocol.DriverDescriptor;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Small explicit registry; later profile loading can compose it without changing driver code. */
public final class DriverRegistry {
    private final Map<String, DeviceDriver> drivers;

    public DriverRegistry(Collection<? extends DeviceDriver> drivers) {
        Objects.requireNonNull(drivers, "drivers");
        Map<String, DeviceDriver> registered = new LinkedHashMap<>();
        for (DeviceDriver driver : drivers) {
            DeviceDriver previous = registered.putIfAbsent(driver.driverId(), driver);
            if (previous != null) {
                throw new IllegalArgumentException("Duplicate edge driver id: " + driver.driverId());
            }
        }
        this.drivers = Map.copyOf(registered);
    }

    public DeviceDriver require(String driverId) throws DeviceDriverException {
        DeviceDriver driver = drivers.get(driverId);
        if (driver == null) {
            throw DeviceDriverException.rejected("UNKNOWN_DRIVER", "No local driver is registered for " + driverId);
        }
        return driver;
    }

    public Collection<DeviceDriver> all() {
        return drivers.values();
    }

    public List<DriverDescriptor> descriptors() {
        return drivers.values().stream().map(DeviceDriver::descriptor).toList();
    }
}
