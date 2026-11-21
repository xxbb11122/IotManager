package com.iot.manager.ai;

import com.iot.manager.service.DeviceStatusOverviewService;
import com.iot.manager.service.TimeProvider;

import java.time.Instant;
import java.util.Set;

/** Minimal, typed one-turn evidence. In particular, mobile inputs have no hardware identifier or free-text metadata. */
public record AiDeviceDiagnosis(int version, Source source, Issue issue, String publicId, String field, BleObservation observation) {
    public enum Source { PLATFORM, MOBILE_BLE }
    public enum Issue { BLE_CONNECT, BLE_NO_DATA, FIELD_STALE, FIELD_NO_DATA, EDGE_DELIVERY, COMMAND_UNCONFIRMED, PLATFORM_LINK }
    public enum BleLink { CONNECTED, DISCONNECTED, BOUND, UNKNOWN }
    public enum BleError { BLE_DISABLED, BLE_PERMISSION_DENIED, CONNECTION_CHECK_FAILED }
    public enum CommandState { PENDING, SENT, ACKNOWLEDGED, UNCONFIRMED, FAILED, REJECTED, UNKNOWN }
    public record BleObservation(Instant capturedAt, BleLink linkState, boolean hasProfile, boolean hasReading,
                                 BleError errorCode, CommandState commandState) { }

    public AiDeviceDiagnosis {
        if (version != 1 || source == null || issue == null
                || (field != null && !field.matches("[A-Za-z][A-Za-z0-9_]{0,47}")))
            throw new IllegalArgumentException("Invalid device diagnosis context");
        if (source == Source.PLATFORM) {
            if (publicId == null || !publicId.matches("[A-Za-z0-9_-]{1,100}") || observation != null
                    || issue == Issue.BLE_CONNECT || issue == Issue.BLE_NO_DATA)
                throw new IllegalArgumentException("Invalid platform diagnosis target");
        } else if (publicId != null || observation == null || observation.capturedAt() == null || observation.linkState() == null
                || (field != null && !Set.of("battery", "power").contains(field))
                || !(issue == Issue.BLE_CONNECT || issue == Issue.BLE_NO_DATA || issue == Issue.COMMAND_UNCONFIRMED))
            throw new IllegalArgumentException("Invalid mobile BLE observation");
    }

    /** Includes user intent and local snapshot, not the live site state. A same-key retry must replay its original result. */
    public String fingerprint() {
        return version + "|" + source + "|" + issue + "|" + publicId + "|" + field + "|" + observation;
    }

    public String evidence(long siteId, DeviceStatusOverviewService overview, TimeProvider clock) {
        StringBuilder text = new StringBuilder("repair issue: ").append(issue).append('\n');
        if (source == Source.MOBILE_BLE) {
            Instant now = clock.now();
            if (observation.capturedAt().isBefore(now.minusSeconds(180)) || observation.capturedAt().isAfter(now.plusSeconds(15)))
                throw new IllegalArgumentException("Mobile BLE evidence expired; capture another assessment");
            return text.append("source: caller's app-local BLE observation, not server-verified hardware\n")
                    .append("captured at: ").append(observation.capturedAt()).append("\nlink: ").append(observation.linkState())
                    .append("\nknown profile: ").append(observation.hasProfile()).append("\nfield: ").append(field)
                    .append("\nindependent sample available: ").append(observation.hasReading())
                    .append("\nlocal error: ").append(observation.errorCode())
                    .append("\ncommand state: ").append(observation.commandState()).toString();
        }
        var device = overview.detail(siteId, publicId, null);
        if (device.demo()) throw new IllegalArgumentException("Demo records cannot be used as live diagnosis evidence");
        text.append("source: authorized platform ").append(device.source()).append("\nas of: ").append(device.asOf())
                .append("\nlink: ").append(device.linkState()).append("\nlast device communication: ").append(device.lastCommunicationAt());
        if (device.profileId() != null && device.profileId().matches("[A-Za-z0-9_-]{1,64}"))
            text.append("\nprofile: ").append(device.profileId()).append(" v").append(device.profileVersion());
        if (device.firmwareVersion() != null && device.firmwareVersion().matches("[A-Za-z0-9._+-]{1,40}"))
            text.append("\nfirmware: ").append(device.firmwareVersion());
        if (field != null) {
            var measurement = device.fields().stream().filter(candidate -> field.equals(candidate.key())).findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("The field is not declared by this device profile"));
            text.append("\nfield: ").append(measurement.key()).append(", validity: ").append(measurement.validity());
            if (!measurement.samples().isEmpty()) {
                var sample = measurement.samples().get(0);
                text.append(", received at: ").append(sample.receivedAt()).append(", observed time trust: ").append(sample.timeTrust());
            }
        }
        if (device.command() != null) text.append("\nlatest command state: ").append(device.command().state())
                .append(", failure code: ").append(device.command().failureCode());
        device.links().stream().filter(link -> "LAN_AGENT".equals(link.transport())).findFirst().ifPresent(link ->
                text.append("\nagent state (not device state): ").append(link.agentStatus()));
        return text.toString();
    }
}
