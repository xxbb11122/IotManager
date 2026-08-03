package com.iot.manager.dto;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public record DeviceView(
        Long id,
        String publicId,
        String deviceId,
        String name,
        String type,
        String status,
        String location,
        String organizationCode,
        String siteCode,
        String spacePath,
        Map<String, Object> reportedState,
        Map<String, Object> desiredState,
        List<ConnectionView> connections,
        LocalDateTime lastSeen,
        LocalDateTime updatedAt,
        String protocol,
        String firmwareVersion,
        Double temperature,
        Double humidity,
        Double cpuUsage,
        Long uptimeSeconds,
        Double signalStrength,
        String profileId,
        Integer profileVersion,
        Map<String, Object> capabilities,
        LocalDateTime archivedAt
) {

    public DeviceView {
        reportedState = immutableMap(reportedState);
        desiredState = immutableMap(desiredState);
        capabilities = immutableMap(capabilities);
        connections = immutableList(connections);
    }

    static Map<String, Object> immutableMap(Map<String, ?> source) {
        if (source == null || source.isEmpty()) {
            return Map.of();
        }

        Map<String, Object> copy = new LinkedHashMap<>();
        source.forEach((key, value) -> copy.put(key, immutableValue(value)));
        return Collections.unmodifiableMap(copy);
    }

    private static <T> List<T> immutableList(Collection<T> source) {
        if (source == null || source.isEmpty()) {
            return List.of();
        }
        return Collections.unmodifiableList(new ArrayList<>(source));
    }

    private static Object immutableValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> copy = new LinkedHashMap<>();
            map.forEach((key, nestedValue) -> copy.put(String.valueOf(key), immutableValue(nestedValue)));
            return Collections.unmodifiableMap(copy);
        }
        if (value instanceof Collection<?> collection) {
            List<Object> copy = new ArrayList<>();
            collection.forEach(item -> copy.add(immutableValue(item)));
            return Collections.unmodifiableList(copy);
        }
        return value;
    }
}
