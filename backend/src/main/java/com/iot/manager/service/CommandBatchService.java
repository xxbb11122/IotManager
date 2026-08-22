package com.iot.manager.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.dto.CommandBatchRequest;
import com.iot.manager.dto.CommandBatchTarget;
import com.iot.manager.dto.CommandBatchView;
import com.iot.manager.dto.DeviceCommandView;
import com.iot.manager.entity.CommandBatch;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.Organization;
import com.iot.manager.entity.Site;
import com.iot.manager.repository.CommandBatchRepository;
import com.iot.manager.repository.DeviceCommandRepository;
import com.iot.manager.repository.DeviceGroupRepository;
import com.iot.manager.repository.DeviceRepository;
import com.iot.manager.repository.OrganizationRepository;
import com.iot.manager.repository.SiteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class CommandBatchService {

    private static final int MAX_TARGETS = 200;
    private static final String DEMO_ORGANIZATION_CODE = "demo-org";

    private final CommandBatchRepository batchRepository;
    private final DeviceCommandRepository commandRepository;
    private final DeviceRepository deviceRepository;
    private final DeviceGroupRepository groupRepository;
    private final OrganizationRepository organizationRepository;
    private final SiteRepository siteRepository;
    private final BootstrapService bootstrapService;
    private final DeviceGroupService groupService;
    private final DeviceProfileService profileService;
    private final CommandService commandService;
    private final CommandBatchSummaryService summaryService;
    private final ObjectMapper objectMapper;
    private final SiteAccessService siteAccessService;
    private final AuditContextService auditContextService;

    @Transactional
    public CommandBatchView create(CommandBatchRequest request) {
        Site site = resolveSite(request.siteCode());
        List<Device> targets = resolveTargets(site, request.target());
        if (targets.isEmpty()) throw new CommandValidationException(Map.of("target", "must contain at least one device"));
        if (targets.size() > MAX_TARGETS) {
            throw new CommandValidationException(Map.of("target", "must contain at most " + MAX_TARGETS + " devices"));
        }
        Map<String, Object> parameters = request.parameters() == null ? Map.of() : request.parameters();
        String fingerprint = fingerprint(site, targets, request.type(), parameters, request.target());
        CommandBatch existing = batchRepository.findBySiteIdAndIdempotencyKey(site.getId(), request.idempotencyKey().trim())
                .orElse(null);
        if (existing != null) {
            if (!existing.getRequestFingerprint().equals(fingerprint)) {
                throw new IdempotencyConflictException("Idempotency key was already used for a different batch request");
            }
            return summaryService.toView(existing);
        }

        String batchId = "batch-" + UUID.randomUUID();
        String groupId = normalizeGroupId(request.target());
        CommandBatch batch = batchRepository.save(CommandBatch.builder()
                .batchId(batchId)
                .site(site)
                .group(groupId == null ? null : groupEntity(groupId))
                .targetKind(groupId == null ? "SELECTION" : "GROUP")
                .targetLabel(groupId == null ? "Selected devices" : groupId)
                .type(request.type().trim().toLowerCase(java.util.Locale.ROOT))
                .parametersJson(writeJson(parameters))
                .status("QUEUED")
                .idempotencyKey(request.idempotencyKey().trim())
                .requestFingerprint(fingerprint)
                .requestedVia("CONSOLE")
                .requestedBy(auditContextService.currentSubjectOrAnonymous())
                .requestedAt(LocalDateTime.now())
                .expiresAt(expiry(request.expiresInSeconds()))
                .totalCount(0)
                .pendingCount(0)
                .sentCount(0)
                .acknowledgedCount(0)
                .failedCount(0)
                .rejectedCount(0)
                .version(0L)
                .build());

        for (Device device : targets.stream().sorted(Comparator.comparing(Device::getId)).toList()) {
            String childKey = batchId + ":" + device.getId();
            try {
                profileService.validateCommand(device, new com.iot.manager.dto.DeviceCommandRequest(
                        request.type(), childKey, parameters
                ));
                commandService.submitBatchTarget(
                        device.getId(), request.type(), parameters, batchId, childKey, fingerprint, batch.getExpiresAt()
                );
            } catch (CommandValidationException exception) {
                commandService.rejectBatchTarget(
                        device.getId(), request.type(), parameters, batchId, childKey, fingerprint,
                        exception.getMessage()
                );
            }
        }
        return summaryService.refresh(batchId);
    }

    @Transactional(readOnly = true)
    public CommandBatchView get(String batchId) {
        return summaryService.get(batchId);
    }

    @Transactional(readOnly = true)
    public List<CommandBatchView> list(String siteCode) {
        Site site = resolveSite(siteCode);
        return batchRepository.findBySiteCodeOrderByRequestedAtDesc(site.getCode()).stream()
                .map(summaryService::toView)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<DeviceCommandView> commands(String batchId) {
        if (batchRepository.findByBatchId(batchId).isEmpty()) throw new NoSuchElementException("Command batch not found");
        return commandRepository.findByBatchIdOrderByRequestedAtAscIdAsc(batchId).stream()
                .map(command -> commandService.getByCommandId(command.getCommandId()))
                .toList();
    }

    private List<Device> resolveTargets(Site site, CommandBatchTarget target) {
        if (target == null) throw new CommandValidationException(Map.of("target", "must not be null"));
        String groupId = normalizeGroupId(target);
        List<Long> explicit = target.deviceIds() == null ? List.of() : target.deviceIds().stream()
                .filter(java.util.Objects::nonNull).distinct().toList();
        if ((groupId == null && explicit.isEmpty()) || (groupId != null && !explicit.isEmpty())) {
            throw new CommandValidationException(Map.of("target", "provide exactly one of groupId or deviceIds"));
        }
        List<Device> targets;
        if (groupId != null) {
            if (!site.getCode().equals(groupService.get(groupId).siteCode())) {
                throw new CommandValidationException(Map.of("target.groupId", "must belong to the selected site"));
            }
            targets = groupService.activeMembers(groupId);
        } else {
            targets = deviceRepository.findAllById(explicit);
            if (targets.size() != explicit.size()) throw new NoSuchElementException("Device not found");
        }
        for (Device device : targets) {
            if (device.getArchivedAt() != null) throw new CommandValidationException(Map.of("target", "cannot include archived devices"));
            if (device.getSite() == null || !site.getId().equals(device.getSite().getId())) {
                throw new CommandValidationException(Map.of("target", "all devices must belong to the selected site"));
            }
        }
        return new ArrayList<>(targets);
    }

    private com.iot.manager.entity.DeviceGroup groupEntity(String groupId) {
        return groupRepository.findByPublicId(groupId)
                .orElseThrow(() -> new NoSuchElementException("Device group not found"));
    }

    private Site resolveSite(String siteCode) {
        if (siteAccessService.isScopeEnforced()) {
            return siteAccessService.requireSiteAccess(siteCode);
        }
        bootstrapService.ensureDemoContext();
        Organization organization = organizationRepository.findByCode(DEMO_ORGANIZATION_CODE)
                .orElseThrow(() -> new NoSuchElementException("Organization not found"));
        return siteRepository.findByOrganizationAndCode(organization, siteCode.trim())
                .orElseThrow(() -> new NoSuchElementException("Site not found"));
    }

    private String normalizeGroupId(CommandBatchTarget target) {
        return target.groupId() == null || target.groupId().isBlank() ? null : target.groupId().trim();
    }

    private LocalDateTime expiry(Integer seconds) {
        if (seconds == null) return LocalDateTime.now().plusMinutes(5);
        if (seconds < 1 || seconds > 3600) {
            throw new CommandValidationException(Map.of("expiresInSeconds", "must be between 1 and 3600"));
        }
        return LocalDateTime.now().plusSeconds(seconds);
    }

    private String fingerprint(Site site, List<Device> targets, String type, Map<String, Object> parameters, CommandBatchTarget target) {
        Map<String, Object> source = new LinkedHashMap<>();
        source.put("site", site.getCode());
        source.put("type", type == null ? "" : type.trim().toLowerCase(java.util.Locale.ROOT));
        source.put("target", targets.stream().map(Device::getId).sorted().toList());
        source.put("parameters", parameters);
        source.put("targetKind", normalizeGroupId(target) == null ? "SELECTION" : "GROUP");
        return sha256(writeJson(source));
    }

    private String writeJson(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new CommandValidationException(Map.of("parameters", "must contain valid JSON values"));
        }
    }

    private String sha256(String value) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(64);
            for (byte item : hash) result.append(String.format("%02x", item));
            return result.toString();
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
