package com.iot.manager.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.dto.ClaimLanDeviceRequest;
import com.iot.manager.dto.DeviceView;
import com.iot.manager.dto.LanCandidateView;
import com.iot.manager.entity.ActivityEvent;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceConnection;
import com.iot.manager.entity.Organization;
import com.iot.manager.entity.Site;
import com.iot.manager.entity.Space;
import com.iot.manager.repository.DeviceConnectionRepository;
import com.iot.manager.repository.OrganizationRepository;
import com.iot.manager.repository.SiteRepository;
import com.iot.manager.repository.SpaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class LanDiscoveryService {

    private static final String DEMO_ORGANIZATION_CODE = "demo-org";
    private static final String DEMO_SITE_CODE = "demo-site";
    private static final String LAN_AGENT = "LAN_AGENT";
    private static final String CONNECTED = "CONNECTED";

    private static final List<LanCandidate> CATALOG = List.of(
            new LanCandidate("lan-demo-sensor-01", "Field sensor 01", "LX-100", "192.168.10.21", LAN_AGENT, "lan-agent-v1", -47, DEMO_SITE_CODE),
            new LanCandidate("lan-demo-sensor-02", "Field sensor 02", "LX-100", "192.168.10.22", LAN_AGENT, "lan-agent-v1", -49, DEMO_SITE_CODE),
            new LanCandidate("lan-demo-sensor-03", "Field sensor 03", "LX-110", "192.168.10.23", LAN_AGENT, "lan-agent-v1", -51, DEMO_SITE_CODE),
            new LanCandidate("lan-demo-sensor-04", "Field sensor 04", "LX-110", "192.168.10.24", LAN_AGENT, "lan-agent-v1", -53, DEMO_SITE_CODE),
            new LanCandidate("lan-demo-sensor-05", "Field sensor 05", "LX-120", "192.168.10.25", LAN_AGENT, "lan-agent-v1", -55, DEMO_SITE_CODE),
            new LanCandidate("lan-demo-sensor-06", "Field sensor 06", "LX-120", "192.168.10.26", LAN_AGENT, "lan-agent-v1", -57, DEMO_SITE_CODE)
    );

    private static final Map<String, LanCandidate> CANDIDATES_BY_ID = CATALOG.stream()
            .collect(Collectors.toUnmodifiableMap(LanCandidate::candidateId, Function.identity()));

    private final Set<String> claimedCandidateIds = ConcurrentHashMap.newKeySet();

    private final BootstrapService bootstrapService;
    private final OrganizationRepository organizationRepository;
    private final SiteRepository siteRepository;
    private final SpaceRepository spaceRepository;
    private final DeviceService deviceService;
    private final DeviceConnectionRepository connectionRepository;
    private final AuditEventService auditEventService;
    private final DeviceMapper deviceMapper;
    private final WebSocketService webSocketService;
    private final ObjectMapper objectMapper;
    private final SiteAccessService siteAccessService;

    public List<LanCandidateView> listCandidates(String siteCode) {
        resolveSite(siteCode);
        return CATALOG.stream()
                .filter(candidate -> candidate.siteCode().equals(siteCode))
                .filter(candidate -> !claimedCandidateIds.contains(candidate.candidateId()))
                .map(LanCandidate::toView)
                .toList();
    }

    @Transactional
    public DeviceView claim(String candidateId, ClaimLanDeviceRequest request) {
        LanCandidate candidate = candidate(candidateId);
        Site site = resolveSite(request.siteCode());
        Space space = resolveSpace(site, request.spacePath());

        if (!claimedCandidateIds.add(candidateId)) {
            throw new LanCandidateAlreadyClaimedException(candidateId);
        }
        releaseReservationOnRollback(candidateId);

        try {
            Device device = deviceService.createInContext(Device.builder()
                    .name(request.displayName())
                    .type("SENSOR")
                    .protocol(LAN_AGENT)
                    .location(space.getPath())
                    .build(), space);

            Map<String, Object> metadata = candidateMetadata(candidate);
            DeviceConnection connection = connectionRepository.save(DeviceConnection.builder()
                    .device(device)
                    .transport(candidate.transport())
                    .profileId(candidate.profileId())
                    .externalId(candidate.candidateId())
                    .status(CONNECTED)
                    .metadataJson(writeJson(metadata))
                    .build());
            ActivityEvent claimActivity = auditEventService.recordActivity(
                    device,
                    "device_claimed",
                    "LAN candidate claimed: " + candidate.name(),
                    writeJson(claimPayload(candidate, site, space))
            );

            connectionRepository.flush();
            webSocketService.broadcastEvent("connection_update", connectionPayload(device, connection, metadata));
            webSocketService.sendActivityUpdate(claimActivity);
            return deviceMapper.toView(device);
        } catch (RuntimeException exception) {
            claimedCandidateIds.remove(candidateId);
            throw exception;
        }
    }

    private void releaseReservationOnRollback(String candidateId) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                if (status != STATUS_COMMITTED) {
                    claimedCandidateIds.remove(candidateId);
                }
            }
        });
    }

    private LanCandidate candidate(String candidateId) {
        LanCandidate candidate = CANDIDATES_BY_ID.get(candidateId);
        if (candidate == null) {
            throw new NoSuchElementException("LAN candidate not found");
        }
        return candidate;
    }

    private Site resolveSite(String siteCode) {
        if (siteAccessService.isScopeEnforced()) {
            return siteAccessService.requireSiteAccess(siteCode);
        }
        if (siteCode == null || siteCode.isBlank()) {
            throw new NoSuchElementException("Site not found");
        }

        bootstrapService.ensureDemoContext();
        Organization organization = organizationRepository.findByCode(DEMO_ORGANIZATION_CODE)
                .orElseThrow(() -> new NoSuchElementException("Organization not found"));
        Site site = siteRepository.findByOrganizationAndCode(organization, siteCode)
                .orElseThrow(() -> new NoSuchElementException("Site not found"));
        if (!DEMO_SITE_CODE.equals(site.getCode())) {
            throw new NoSuchElementException("Site not found");
        }
        return site;
    }

    private Space resolveSpace(Site site, String spacePath) {
        if (spacePath == null || spacePath.isBlank()) {
            throw new NoSuchElementException("Space not found");
        }
        return spaceRepository.findBySiteAndPath(site, spacePath)
                .orElseThrow(() -> new NoSuchElementException("Space not found"));
    }

    private Map<String, Object> candidateMetadata(LanCandidate candidate) {
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("model", candidate.model());
        metadata.put("ipAddress", candidate.ipAddress());
        metadata.put("signal", candidate.signal());
        metadata.put("profileId", candidate.profileId());
        return Collections.unmodifiableMap(metadata);
    }

    private Map<String, Object> claimPayload(LanCandidate candidate, Site site, Space space) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("candidateId", candidate.candidateId());
        payload.put("candidateName", candidate.name());
        payload.put("model", candidate.model());
        payload.put("ipAddress", candidate.ipAddress());
        payload.put("transport", candidate.transport());
        payload.put("profileId", candidate.profileId());
        payload.put("signal", candidate.signal());
        payload.put("siteCode", site.getCode());
        payload.put("spacePath", space.getPath());
        return payload;
    }

    private Map<String, Object> connectionPayload(
            Device device,
            DeviceConnection connection,
            Map<String, Object> metadata
    ) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("deviceId", device.getDeviceId());
        payload.put("devicePublicId", device.getPublicId());
        payload.put("deviceName", device.getName());
        payload.put("transport", connection.getTransport());
        payload.put("profileId", connection.getProfileId());
        payload.put("externalId", connection.getExternalId());
        payload.put("status", connection.getStatus());
        payload.put("metadata", metadata);
        return Collections.unmodifiableMap(payload);
    }

    private String writeJson(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Unable to serialize LAN discovery context", exception);
        }
    }

    private record LanCandidate(
            String candidateId,
            String name,
            String model,
            String ipAddress,
            String transport,
            String profileId,
            int signal,
            String siteCode
    ) {

        private LanCandidateView toView() {
            return new LanCandidateView(candidateId, name, model, ipAddress, transport, profileId, signal);
        }
    }
}
