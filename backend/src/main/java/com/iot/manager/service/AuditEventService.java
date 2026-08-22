package com.iot.manager.service;

import com.iot.manager.entity.ActivityEvent;
import com.iot.manager.entity.CommandEvent;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceCommand;
import com.iot.manager.entity.Organization;
import com.iot.manager.entity.Site;
import com.iot.manager.repository.ActivityEventRepository;
import com.iot.manager.repository.CommandEventRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Locale;
import java.util.Objects;

/**
 * Centralizes audit persistence so every event retains the actor and the
 * organization/site boundary that applied at write time.  This avoids relying
 * on a mutable device relationship when an auditor reads historical events.
 */
@Service
@RequiredArgsConstructor
public class AuditEventService {

    private final ActivityEventRepository activityEventRepository;
    private final CommandEventRepository commandEventRepository;
    private final AuditContextService auditContextService;

    public ActivityEvent recordActivity(
            Device device,
            String eventType,
            String detail,
            String payloadJson
    ) {
        Device target = Objects.requireNonNull(device, "device is required for an activity event");
        AuditScope scope = scopeFor(target);
        return activityEventRepository.save(ActivityEvent.builder()
                .device(target)
                .actorId(auditContextService.currentActorId())
                .organizationId(scope.organizationId())
                .siteId(scope.siteId())
                .eventType(eventType)
                .detail(detail)
                .payloadJson(payloadJson)
                .occurredAt(LocalDateTime.now())
                .build());
    }

    /** Writes matching command and activity records with one immutable scope. */
    public ActivityEvent recordCommandTransition(
            DeviceCommand command,
            Device device,
            String previousStatus,
            String activityType,
            String detail,
            String payloadJson
    ) {
        DeviceCommand targetCommand = Objects.requireNonNull(command, "command is required for a command event");
        Device targetDevice = Objects.requireNonNull(device, "device is required for a command event");
        AuditScope scope = scopeFor(targetDevice);
        Long actorId = auditContextService.currentActorId();
        LocalDateTime occurredAt = LocalDateTime.now();

        commandEventRepository.save(CommandEvent.builder()
                .command(targetCommand)
                .actorId(actorId)
                .organizationId(scope.organizationId())
                .siteId(scope.siteId())
                .fromStatus(previousStatus)
                .toStatus(targetCommand.getStatus())
                .eventType(activityType.toUpperCase(Locale.ROOT))
                .detail(detail)
                .payloadJson(payloadJson)
                .occurredAt(occurredAt)
                .build());

        return activityEventRepository.save(ActivityEvent.builder()
                .device(targetDevice)
                .actorId(actorId)
                .organizationId(scope.organizationId())
                .siteId(scope.siteId())
                .eventType(activityType)
                .detail(detail)
                .payloadJson(payloadJson)
                .occurredAt(occurredAt)
                .build());
    }

    private AuditScope scopeFor(Device device) {
        Site site = device.getSite();
        Organization organization = device.getOrganization();
        if (organization == null && site != null) {
            organization = site.getOrganization();
        }
        return new AuditScope(
                organization == null ? null : organization.getId(),
                site == null ? null : site.getId()
        );
    }

    private record AuditScope(Long organizationId, Long siteId) {
    }
}
