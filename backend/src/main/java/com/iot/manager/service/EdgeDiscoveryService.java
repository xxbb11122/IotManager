package com.iot.manager.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.dto.ClaimLanDeviceRequest;
import com.iot.manager.dto.DeviceProfileView;
import com.iot.manager.dto.DeviceView;
import com.iot.manager.dto.LanCandidateView;
import com.iot.manager.entity.ActivityEvent;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceConnection;
import com.iot.manager.entity.DiscoveredDevice;
import com.iot.manager.entity.Organization;
import com.iot.manager.entity.Site;
import com.iot.manager.entity.Space;
import com.iot.manager.repository.ActivityEventRepository;
import com.iot.manager.repository.DeviceConnectionRepository;
import com.iot.manager.repository.DiscoveredDeviceRepository;
import com.iot.manager.repository.EdgeAgentRepository;
import com.iot.manager.repository.OrganizationRepository;
import com.iot.manager.repository.SiteRepository;
import com.iot.manager.repository.SpaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

@Service
@RequiredArgsConstructor
public class EdgeDiscoveryService {

    private static final String DEMO_ORGANIZATION_CODE = "demo-org";

    private final DiscoveredDeviceRepository discoveredRepository;
    private final EdgeAgentRepository agentRepository;
    private final OrganizationRepository organizationRepository;
    private final SiteRepository siteRepository;
    private final SpaceRepository spaceRepository;
    private final BootstrapService bootstrapService;
    private final DeviceProfileService profileService;
    private final DeviceService deviceService;
    private final DeviceConnectionRepository connectionRepository;
    private final ActivityEventRepository activityEventRepository;
    private final DeviceMapper deviceMapper;
    private final WebSocketService webSocketService;
    private final ObjectMapper objectMapper;

    @Transactional(readOnly = true)
    public boolean hasConnectedAgent(String siteCode) {
        return agentRepository.existsBySiteCodeAndStatus(siteCode, "ONLINE");
    }

    @Transactional(readOnly = true)
    public List<LanCandidateView> listCandidates(String siteCode) {
        return discoveredRepository.findByAgentSiteCodeAndStatusOrderByLastSeenDesc(siteCode, "DISCOVERED").stream()
                .map(this::toCandidateView)
                .toList();
    }

    @Transactional(readOnly = true)
    public boolean ownsCandidate(String candidateId) {
        return discoveredRepository.findByCandidateId(candidateId).isPresent();
    }

    @Transactional
    public DeviceView claim(String candidateId, ClaimLanDeviceRequest request) {
        DiscoveredDevice candidate = discoveredRepository.findByCandidateIdForUpdate(candidateId)
                .orElseThrow(() -> new NoSuchElementException("LAN candidate not found"));
        if (!"DISCOVERED".equals(candidate.getStatus())) {
            throw new LanCandidateAlreadyClaimedException(candidateId);
        }
        Site site = resolveSite(request.siteCode());
        if (!site.getId().equals(candidate.getAgent().getSite().getId())) {
            throw new IllegalArgumentException("Candidate belongs to a different site");
        }
        Space space = resolveSpace(site, request.spacePath());
        DeviceProfileView profile = profileService.get(candidate.getProfileId(), candidate.getProfileVersion());
        Device device = deviceService.createInContext(Device.builder()
                .name(request.displayName().trim())
                .type(profile.deviceType())
                .protocol("LAN_AGENT")
                .location(space.getPath())
                .profileId(candidate.getProfileId())
                .profileVersion(candidate.getProfileVersion())
                .reportedStateJson(writeJson(reportedState(candidate)))
                .desiredStateJson("{}")
                .build(), space);
        Map<String, Object> metadata = metadata(candidate);
        DeviceConnection connection = connectionRepository.save(DeviceConnection.builder()
                .device(device)
                .transport("LAN_AGENT")
                .profileId(candidate.getProfileId())
                .profileVersion(candidate.getProfileVersion())
                .agentId(candidate.getAgent().getAgentId())
                .driverId(string(metadata.get("driverId")))
                .externalId(candidate.getExternalId())
                .status("CONNECTED")
                .connectedAt(LocalDateTime.now())
                .lastSeen(candidate.getLastSeen())
                .metadataJson(writeJson(metadata))
                .build());
        candidate.setStatus("CLAIMED");
        candidate.setClaimedDevice(device);
        ActivityEvent activity = activityEventRepository.save(ActivityEvent.builder()
                .device(device)
                .eventType("DEVICE_CLAIMED")
                .detail("Edge Agent LAN candidate claimed")
                .payloadJson(writeJson(Map.of(
                        "candidateId", candidate.getCandidateId(),
                        "agentId", candidate.getAgent().getAgentId(),
                        "externalId", candidate.getExternalId()
                )))
                .occurredAt(LocalDateTime.now())
                .build());
        webSocketService.broadcastEvent("connection_update", Map.of(
                "deviceId", device.getDeviceId(), "transport", connection.getTransport(),
                "profileId", connection.getProfileId(), "agentId", connection.getAgentId(),
                "status", connection.getStatus()
        ));
        webSocketService.sendActivityUpdate(activity);
        return deviceMapper.toView(device);
    }

    private LanCandidateView toCandidateView(DiscoveredDevice candidate) {
        Map<String, Object> metadata = metadata(candidate);
        String endpoint = candidate.getEndpoint();
        String host = endpoint;
        try {
            host = URI.create(endpoint).getHost();
        } catch (RuntimeException ignored) { }
        String model = candidate.getModel();
        if (model == null || model.isBlank()) model = string(metadata.get("driverId"));
        return new LanCandidateView(
                candidate.getCandidateId(), candidate.getDisplayName(), model, host,
                "LAN_AGENT", candidate.getProfileId(), -45
        );
    }

    private Site resolveSite(String siteCode) {
        bootstrapService.ensureDemoContext();
        Organization organization = organizationRepository.findByCode(DEMO_ORGANIZATION_CODE)
                .orElseThrow(() -> new NoSuchElementException("Organization not found"));
        return siteRepository.findByOrganizationAndCode(organization, siteCode)
                .orElseThrow(() -> new NoSuchElementException("Site not found"));
    }

    private Space resolveSpace(Site site, String spacePath) {
        return spaceRepository.findBySiteAndPath(site, spacePath)
                .orElseThrow(() -> new NoSuchElementException("Space not found"));
    }

    private Map<String, Object> metadata(DiscoveredDevice candidate) {
        if (candidate.getMetadataJson() == null || candidate.getMetadataJson().isBlank()) return Map.of();
        try {
            return objectMapper.readValue(candidate.getMetadataJson(), new TypeReference<LinkedHashMap<String, Object>>() { });
        } catch (JsonProcessingException exception) {
            return Map.of();
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> reportedState(DiscoveredDevice candidate) {
        Object state = metadata(candidate).get("reportedState");
        if (state instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            map.forEach((key, value) -> result.put(String.valueOf(key), value));
            return result;
        }
        return Map.of();
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Unable to serialize edge discovery metadata", exception);
        }
    }

    private String string(Object value) {
        return value instanceof String string && !string.isBlank() ? string : null;
    }
}
