package com.iot.manager.edgeagent.driver.shelly;

import com.fasterxml.jackson.databind.JsonNode;
import com.iot.manager.edgeagent.driver.DeviceCommand;
import com.iot.manager.edgeagent.driver.DeviceDriver;
import com.iot.manager.edgeagent.driver.DeviceDriverException;
import com.iot.manager.edgeagent.driver.DiscoveryContext;
import com.iot.manager.edgeagent.driver.DriverCommandResult;
import com.iot.manager.edgeagent.protocol.CommandStatus;
import com.iot.manager.edgeagent.protocol.DiscoveredDevice;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Local driver for Shelly Plus Plug S Gen2 devices. It is intentionally limited
 * to an observable power command until an approved profile adds more controls.
 */
public final class ShellyPlusPlugSDriver implements DeviceDriver {
    public static final String DRIVER_ID = "shelly-plus-plug-s-rpc-v1";
    public static final String PROFILE_ID = "shelly-plus-plug-s-v1";
    private static final String VERSION = "0.1.0";

    private final ShellyRpcClient rpcClient;
    private final Clock clock;
    private final Duration commandTimeout;

    public ShellyPlusPlugSDriver(ShellyRpcClient rpcClient) {
        this(rpcClient, Duration.ofSeconds(5), Clock.systemUTC());
    }

    public ShellyPlusPlugSDriver(ShellyRpcClient rpcClient, Duration commandTimeout) {
        this(rpcClient, commandTimeout, Clock.systemUTC());
    }

    ShellyPlusPlugSDriver(ShellyRpcClient rpcClient, Duration commandTimeout, Clock clock) {
        this.rpcClient = rpcClient;
        if (commandTimeout == null || commandTimeout.isNegative() || commandTimeout.isZero()) {
            throw new IllegalArgumentException("commandTimeout must be positive");
        }
        this.commandTimeout = commandTimeout;
        this.clock = clock;
    }

    @Override
    public String driverId() {
        return DRIVER_ID;
    }

    @Override
    public String driverVersion() {
        return VERSION;
    }

    @Override
    public Set<String> supportedProfileIds() {
        return Set.of(PROFILE_ID);
    }

    @Override
    public List<DiscoveredDevice> discover(DiscoveryContext context) {
        List<DiscoveredDevice> devices = new ArrayList<>();
        for (URI seed : context.seedEndpointsFor(DRIVER_ID)) {
            try {
                URI endpoint = rpcClient.normalizeEndpoint(seed);
                JsonNode info = rpcClient.call(endpoint, "Shelly.GetDeviceInfo", Map.of(), context.requestTimeout());
                if (!isPlusPlugS(info)) {
                    continue;
                }
                Map<String, Object> state = readState(endpoint, context.requestTimeout());
                String mac = requiredText(info, "mac");
                String stableMac = mac.replaceAll("[^A-Za-z0-9]", "").toUpperCase(Locale.ROOT);
                String name = text(info, "name");
                if (name == null) {
                    name = "Shelly Plus Plug S " + stableMac.substring(Math.max(0, stableMac.length() - 6));
                }

                Map<String, Object> identity = new LinkedHashMap<>();
                identity.put("mac", mac);
                identity.put("model", text(info, "model"));
                identity.put("generation", info.path("gen").asInt());
                identity.put("shellyId", text(info, "id"));
                devices.add(new DiscoveredDevice(
                        "shelly:" + stableMac,
                        DRIVER_ID,
                        PROFILE_ID,
                        name,
                        endpoint,
                        identity,
                        state,
                        Instant.now(clock)
                ));
            } catch (RuntimeException | DeviceDriverException ignored) {
                // One powered-off or unrelated seed must not hide other devices in the snapshot.
            }
        }
        return List.copyOf(devices);
    }

    @Override
    public DriverCommandResult execute(DeviceCommand command) throws DeviceDriverException {
        if (!"set_power".equals(command.command())) {
            throw DeviceDriverException.rejected("UNSUPPORTED_COMMAND", "Shelly Plus Plug S supports only set_power");
        }
        Object value = command.parameters().get("on");
        if (!(value instanceof Boolean requestedOn)) {
            throw DeviceDriverException.rejected("INVALID_PARAMETER", "set_power requires a Boolean on parameter");
        }

        URI endpoint = rpcClient.normalizeEndpoint(command.endpoint());
        try {
            rpcClient.call(endpoint, "Switch.Set", Map.of("id", "0", "on", requestedOn.toString()), commandTimeout);
        } catch (DeviceDriverException writeFailure) {
            return resolveUnknownWrite(endpoint, requestedOn, writeFailure);
        }

        Map<String, Object> reportedState;
        try {
            reportedState = readState(endpoint, commandTimeout);
        } catch (DeviceDriverException readFailure) {
            return DriverCommandResult.unconfirmed(
                    "SHELLY_READBACK_UNAVAILABLE",
                    "Shelly accepted the command but state read-back was unavailable: " + readFailure.getMessage(),
                    Map.of()
            );
        }
        Object actual = reportedState.get("power");
        if (!requestedOn.equals(actual)) {
            return DriverCommandResult.failed(
                    "SHELLY_STATE_MISMATCH",
                    "Shelly read-back did not confirm the requested power state",
                    reportedState
            );
        }
        return DriverCommandResult.acknowledged(reportedState);
    }

    private DriverCommandResult resolveUnknownWrite(URI endpoint, boolean requestedOn, DeviceDriverException writeFailure) {
        try {
            Map<String, Object> state = readState(endpoint, commandTimeout);
            if (Boolean.valueOf(requestedOn).equals(state.get("power"))) {
                return DriverCommandResult.acknowledged(state);
            }
            return DriverCommandResult.unconfirmed(
                    "SHELLY_COMMAND_RESULT_UNKNOWN",
                    "Shelly command transport failed and read-back did not confirm the requested state",
                    state
            );
        } catch (DeviceDriverException readFailure) {
            return DriverCommandResult.unconfirmed(
                    "SHELLY_COMMAND_RESULT_UNKNOWN",
                    "Shelly command transport failed and state read-back was unavailable: " + writeFailure.getMessage(),
                    Map.of()
            );
        }
    }

    public Map<String, Object> readState(URI endpoint, java.time.Duration timeout) throws DeviceDriverException {
        JsonNode status = rpcClient.call(endpoint, "Switch.GetStatus", Map.of("id", "0"), timeout);
        if (!status.has("output") || !status.path("output").isBoolean()) {
            throw new DeviceDriverException(CommandStatus.UNCONFIRMED, "SHELLY_INVALID_STATE", "Shelly response omitted Boolean output");
        }

        Map<String, Object> state = new LinkedHashMap<>();
        state.put("power", status.path("output").asBoolean());
        putNumber(state, "voltage", status.get("voltage"));
        putNumber(state, "current", status.get("current"));
        putNumber(state, "powerWatts", status.get("apower"));
        JsonNode temperature = status.path("temperature");
        if (temperature.isObject()) {
            putNumber(state, "temperature", temperature.get("tC"));
        }
        JsonNode energy = status.path("aenergy");
        if (energy.isObject()) {
            putNumber(state, "totalEnergyWh", energy.get("total"));
        }
        return Map.copyOf(state);
    }

    private static boolean isPlusPlugS(JsonNode info) {
        if (info.path("gen").asInt() < 2) {
            return false;
        }
        String model = text(info, "model");
        String app = text(info, "app");
        return (model != null && (model.toUpperCase(Locale.ROOT).contains("SNPL-00116")
                || model.toUpperCase(Locale.ROOT).contains("SPSW-104PE16")))
                || (app != null && app.equalsIgnoreCase("PlusPlugS"));
    }

    private static String requiredText(JsonNode node, String field) throws DeviceDriverException {
        String value = text(node, field);
        if (value == null) {
            throw new DeviceDriverException(CommandStatus.FAILED, "SHELLY_IDENTITY_MISSING", "Shelly device did not return " + field);
        }
        return value;
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.isTextual() && !value.asText().isBlank() ? value.asText().trim() : null;
    }

    private static void putNumber(Map<String, Object> target, String key, JsonNode value) {
        if (value != null && value.isNumber()) {
            target.put(key, value.numberValue());
        }
    }
}
