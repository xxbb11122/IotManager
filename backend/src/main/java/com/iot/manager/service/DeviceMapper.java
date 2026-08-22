package com.iot.manager.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.dto.ActivityView;
import com.iot.manager.dto.ConnectionView;
import com.iot.manager.dto.DeviceView;
import com.iot.manager.entity.ActivityEvent;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceConnection;
import com.iot.manager.entity.Organization;
import com.iot.manager.entity.Site;
import com.iot.manager.entity.Space;
import com.iot.manager.repository.DeviceConnectionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
public class DeviceMapper {

    private static final Set<String> SECRET_METADATA_TOKENS = Set.of(
            "password",
            "passwd",
            "secret",
            "token",
            "authorization",
            "apikey",
            "accesskey",
            "privatekey",
            "credential"
    );

    private final DeviceConnectionRepository connectionRepository;
    private final ObjectMapper objectMapper;
    private final DeviceProfileService profileService;

    public DeviceView toView(Device device) {
        if (device == null) {
            return null;
        }
        return toView(device, connectionRepository.findByDeviceId(device.getId()).stream()
                .map(this::toConnectionView)
                .toList());
    }

    public List<DeviceView> toViews(Collection<Device> devices) {
        if (devices == null || devices.isEmpty()) {
            return List.of();
        }

        List<Long> deviceIds = devices.stream()
                .map(Device::getId)
                .filter(id -> id != null)
                .toList();
        Map<Long, List<ConnectionView>> connectionsByDeviceId = connectionRepository.findByDeviceIdIn(deviceIds).stream()
                .collect(Collectors.groupingBy(
                        connection -> connection.getDevice().getId(),
                        LinkedHashMap::new,
                        Collectors.mapping(this::toConnectionView, Collectors.toList())
                ));

        return devices.stream()
                .map(device -> toView(device, connectionsByDeviceId.getOrDefault(device.getId(), List.of())))
                .toList();
    }

    public ActivityView toActivityView(ActivityEvent event) {
        if (event == null) {
            return null;
        }
        return new ActivityView(
                event.getId(),
                event.getEventType(),
                event.getDetail(),
                parseObject(event.getPayloadJson()),
                event.getOccurredAt(),
                event.getActorId(),
                event.getOrganizationId(),
                event.getSiteId()
        );
    }

    private DeviceView toView(Device device, List<ConnectionView> connections) {
        Organization organization = device.getOrganization();
        Site site = device.getSite();
        Space space = device.getSpace();

        return new DeviceView(
                device.getId(),
                device.getPublicId(),
                device.getDeviceId(),
                device.getName(),
                device.getType(),
                device.getStatus(),
                device.getLocation(),
                organization == null ? null : organization.getCode(),
                site == null ? null : site.getCode(),
                space == null ? null : space.getPath(),
                parseObject(device.getReportedStateJson()),
                parseObject(device.getDesiredStateJson()),
                connections,
                device.getLastSeen(),
                device.getUpdatedAt(),
                device.getProtocol(),
                device.getFirmwareVersion(),
                device.getTemperature(),
                device.getHumidity(),
                device.getCpuUsage(),
                device.getUptimeSeconds(),
                device.getSignalStrength(),
                device.getProfileId(),
                device.getProfileVersion(),
                capabilities(device),
                device.getArchivedAt()
        );
    }

    private ConnectionView toConnectionView(DeviceConnection connection) {
        return new ConnectionView(
                connection.getTransport(),
                connection.getProfileId(),
                connection.getProfileVersion(),
                connection.getExternalId(),
                connection.getStatus(),
                connection.getAgentId(),
                connection.getDriverId(),
                removeSecrets(parseObject(connection.getMetadataJson()))
        );
    }

    private Map<String, Object> capabilities(Device device) {
        try {
            return profileService.capabilities(device.getProfileId(), device.getProfileVersion());
        } catch (CommandValidationException ignored) {
            return Map.of();
        }
    }

    private Map<String, Object> parseObject(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<LinkedHashMap<String, Object>>() {
            });
        } catch (JsonProcessingException exception) {
            return Map.of();
        }
    }

    private Map<String, Object> removeSecrets(Map<String, Object> metadata) {
        Map<String, Object> sanitized = new LinkedHashMap<>();
        metadata.forEach((key, value) -> {
            if (!isSecretMetadataKey(key)) {
                sanitized.put(key, removeSecrets(value));
            }
        });
        return sanitized;
    }

    private Object removeSecrets(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> nested = new LinkedHashMap<>();
            map.forEach((key, nestedValue) -> {
                String nestedKey = String.valueOf(key);
                if (!isSecretMetadataKey(nestedKey)) {
                    nested.put(nestedKey, removeSecrets(nestedValue));
                }
            });
            return nested;
        }
        if (value instanceof Collection<?> collection) {
            List<Object> sanitized = new ArrayList<>();
            collection.forEach(item -> sanitized.add(removeSecrets(item)));
            return sanitized;
        }
        return value;
    }

    private boolean isSecretMetadataKey(String key) {
        String normalized = key.replaceAll("[^A-Za-z0-9]", "").toLowerCase(Locale.ROOT);
        return SECRET_METADATA_TOKENS.stream().anyMatch(normalized::contains);
    }
}
