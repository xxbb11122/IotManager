package com.iot.manager.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.dto.RealtimeEvent;
import com.iot.manager.entity.ActivityEvent;
import com.iot.manager.entity.Alert;
import com.iot.manager.entity.Device;
import com.iot.manager.repository.DeviceRepository;
import com.iot.manager.repository.SiteRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Publishes versioned realtime events and applies the site scope captured at
 * the WebSocket handshake.  Local R0 sessions registered through the legacy
 * {@link #register(WebSocketSession)} method remain intentionally unscoped.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class WebSocketService {

    private static final Object FILTERED_OUT = new Object();

    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final Map<String, SessionScope> sessionScopes = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper;
    private final DeviceRepository deviceRepository;
    private final SiteRepository siteRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final PlatformMetricsService platformMetricsService;

    /** Legacy/dev registration: receives all events. */
    public void register(WebSocketSession session) {
        registerInternal(session, SessionScope.unscoped());
    }

    /** Secure registration: receives only events belonging to these sites. */
    public void register(WebSocketSession session, Collection<Long> siteIds) {
        Set<Long> normalized = new LinkedHashSet<>();
        if (siteIds != null) {
            siteIds.stream()
                    .filter(java.util.Objects::nonNull)
                    .forEach(normalized::add);
        }
        registerInternal(session, new SessionScope(true, Collections.unmodifiableSet(normalized)));
    }

    private void registerInternal(WebSocketSession session, SessionScope scope) {
        WebSocketSession previous = sessions.put(session.getId(), session);
        sessionScopes.put(session.getId(), scope);
        if (previous == null) platformMetricsService.webSocketOpened();
        log.info("WebSocket connected: {} ({} sessions)", session.getId(), sessions.size());
    }

    public void unregister(WebSocketSession session) {
        removeSession(session.getId());
        log.info("WebSocket disconnected: {} ({} sessions)", session.getId(), sessions.size());
    }

    public void sendDeviceUpdate(Object device) {
        Object payload = device instanceof Device storedDevice
                ? devicePayload(storedDevice)
                : device;
        broadcastEvent("device_update", payload);
    }

    public void sendDeviceArchived(Device device) {
        Device storedDevice = storedDevice(device);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("id", storedDevice.getId());
        payload.put("deviceId", storedDevice.getDeviceId());
        payload.put("publicId", storedDevice.getPublicId());
        payload.put("archivedAt", storedDevice.getArchivedAt());
        addSiteContext(payload, storedDevice);
        broadcastEvent("device_archived", payload);
    }

    public void sendDeviceUpdates(List<Map<String, Object>> updates) {
        broadcastEvent("device_updates", updates);
    }

    public void sendTelemetryUpdate(List<Map<String, Object>> updates) {
        broadcastEvent("telemetry_update", updates);
    }

    public void sendWeatherUpdate(Object weather) {
        broadcastEvent("weather_update", weather);
    }

    public void sendAlert(Object alert) {
        Object payload = alert instanceof Alert storedAlert
                ? alertPayload(storedAlert)
                : alert;
        broadcastEvent("alert", payload);
    }

    public void sendAlertUpdate(Object alert) {
        Object payload = alert instanceof Alert storedAlert
                ? alertPayload(storedAlert)
                : alert;
        broadcastEvent("alert_update", payload);
    }

    public void sendActivityUpdate(ActivityEvent activityEvent) {
        broadcastEvent("activity_update", activityPayload(activityEvent));
    }

    public void sendStats(Map<String, Object> stats) {
        broadcastEvent("stats", stats);
    }

    public void broadcastEvent(String type, Object payload) {
        broadcastEvent(new RealtimeEvent(type, payload));
    }

    public void broadcastEvent(RealtimeEvent event) {
        eventPublisher.publishEvent(event);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void deliverAfterCommit(RealtimeEvent event) {
        broadcastNow(event);
    }

    private void broadcastNow(RealtimeEvent event) {
        if (sessions.isEmpty()) return;

        List<String> dead = new ArrayList<>();
        sessions.forEach((id, session) -> {
            try {
                if (!session.isOpen()) {
                    dead.add(id);
                    return;
                }
                SessionScope scope = sessionScopes.getOrDefault(id, SessionScope.unscoped());
                Object scopedPayload = filterPayload(event.type(), event.payload(), scope);
                if (scopedPayload == FILTERED_OUT) {
                    return;
                }
                RealtimeEvent scopedEvent = scopedPayload == event.payload()
                        ? event
                        : new RealtimeEvent(event.type(), scopedPayload, event.timestamp(), event.version());
                TextMessage message = new TextMessage(objectMapper.writeValueAsString(scopedEvent));
                synchronized (session) {
                    session.sendMessage(message);
                }
                platformMetricsService.webSocketEventDelivered(event.type());
            } catch (IOException | RuntimeException exception) {
                dead.add(id);
            }
        });
        dead.forEach(this::removeSession);
    }

    public int getSessionCount() {
        return sessions.size();
    }

    private void removeSession(String sessionId) {
        if (sessions.remove(sessionId) != null) {
            platformMetricsService.webSocketClosed();
        }
        sessionScopes.remove(sessionId);
    }

    private Object filterPayload(String eventType, Object payload, SessionScope scope) {
        if (!scope.enforced()) {
            return payload;
        }
        if (payload instanceof Collection<?> collection) {
            List<Object> filtered = new ArrayList<>();
            for (Object item : collection) {
                Object allowed = filterPayload(eventType, item, scope);
                if (allowed != FILTERED_OUT) filtered.add(allowed);
            }
            return filtered.isEmpty() ? FILTERED_OUT : List.copyOf(filtered);
        }
        if (payload instanceof Map<?, ?> map) {
            return filterMap(eventType, map, scope);
        }
        if (payload instanceof Device device) {
            return isDeviceAllowed(device, scope) ? payload : FILTERED_OUT;
        }
        if (payload == null || payload instanceof String || payload instanceof Number
                || payload instanceof Boolean) {
            return FILTERED_OUT;
        }
        try {
            Map<String, Object> converted = objectMapper.convertValue(
                    payload, new TypeReference<LinkedHashMap<String, Object>>() { }
            );
            return filterMap(eventType, converted, scope);
        } catch (IllegalArgumentException ignored) {
            return FILTERED_OUT;
        }
    }

    private Object filterMap(String eventType, Map<?, ?> source, SessionScope scope) {
        Map<String, Object> map = new LinkedHashMap<>();
        source.forEach((key, value) -> map.put(String.valueOf(key), value));

        Set<Long> siteIds = resolveSiteIds(eventType, map);
        if (siteIds.isEmpty()) {
            Object nestedPayload = map.get("payload");
            if (nestedPayload instanceof Map<?, ?> nested) {
                Map<String, Object> nestedMap = new LinkedHashMap<>();
                nested.forEach((key, value) -> nestedMap.put(String.valueOf(key), value));
                siteIds = resolveSiteIds(eventType, nestedMap);
            }
        }
        if (siteIds.isEmpty() || siteIds.stream().noneMatch(scope.siteIds()::contains)) {
            return FILTERED_OUT;
        }
        return source;
    }

    private Set<Long> resolveSiteIds(String eventType, Map<String, Object> map) {
        Set<Long> siteIds = new LinkedHashSet<>();
        Object siteId = map.get("siteId");
        if (siteId instanceof Number number) {
            return Set.of(number.longValue());
        }

        resolveDeviceSite(map.get("deviceId")).ifPresent(siteIds::add);
        resolveDeviceSite(map.get("devicePublicId")).ifPresent(siteIds::add);
        if ((eventType.startsWith("device_") || map.containsKey("publicId"))
                && map.get("id") instanceof Number number) {
            resolveDeviceSite(number.longValue()).ifPresent(siteIds::add);
        }
        if (!siteIds.isEmpty()) {
            return siteIds;
        }

        Object siteCode = map.get("siteCode");
        if (siteCode instanceof String code && !code.isBlank()) {
            List<Long> matches = siteRepository.findAllByCode(code.trim()).stream()
                    .map(site -> site.getId())
                    .toList();
            // Site codes are unique only within an organization.  An event
            // without a site id is therefore deliverable only if its code is
            // globally unambiguous; otherwise fail closed.
            if (matches.size() == 1) {
                return Set.of(matches.get(0));
            }
        }
        return siteIds;
    }

    private Optional<Long> resolveDeviceSite(Object identifier) {
        if (identifier instanceof Number number) {
            return deviceRepository.findById(number.longValue()).map(this::siteId);
        }
        if (!(identifier instanceof String value) || value.isBlank()) {
            return Optional.empty();
        }
        Optional<Device> byExternalId = deviceRepository.findByDeviceId(value);
        if (byExternalId.isPresent()) return byExternalId.map(this::siteId);
        return deviceRepository.findByPublicId(value).map(this::siteId);
    }

    private Long siteId(Device device) {
        return device.getSite() == null ? null : device.getSite().getId();
    }

    private boolean isDeviceAllowed(Device device, SessionScope scope) {
        Long siteId = siteId(device);
        return siteId != null && scope.siteIds().contains(siteId);
    }

    private Map<String, Object> alertPayload(Alert alert) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("id", alert.getId());
        payload.put("level", alert.getLevel());
        payload.put("message", alert.getMessage());
        payload.put("resolved", alert.isResolved());
        payload.put("createdAt", alert.getCreatedAt());
        payload.put("resolvedAt", alert.getResolvedAt());

        Device device = storedDevice(alert.getDevice());
        if (device != null) {
            payload.put("deviceId", device.getDeviceId());
            payload.put("devicePublicId", device.getPublicId());
            payload.put("deviceName", device.getName());
            payload.put("deviceStatus", device.getStatus());
            addSiteContext(payload, device);
        }
        return payload;
    }

    private Map<String, Object> activityPayload(ActivityEvent activityEvent) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("id", activityEvent.getId());
        payload.put("eventType", activityEvent.getEventType());
        payload.put("detail", activityEvent.getDetail());
        payload.put("payloadJson", activityEvent.getPayloadJson());
        payload.put("occurredAt", activityEvent.getOccurredAt());
        payload.put("actorId", activityEvent.getActorId());
        payload.put("organizationId", activityEvent.getOrganizationId());
        payload.put("siteId", activityEvent.getSiteId());

        Device device = storedDevice(activityEvent.getDevice());
        if (device != null) {
            payload.put("deviceId", device.getDeviceId());
            payload.put("devicePublicId", device.getPublicId());
            payload.put("deviceName", device.getName());
            payload.put("deviceStatus", device.getStatus());
            addSiteContext(payload, device);
        }
        return payload;
    }

    private Map<String, Object> devicePayload(Device device) {
        Device storedDevice = storedDevice(device);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("id", storedDevice.getId());
        payload.put("publicId", storedDevice.getPublicId());
        payload.put("deviceId", storedDevice.getDeviceId());
        payload.put("name", storedDevice.getName());
        payload.put("type", storedDevice.getType());
        payload.put("status", storedDevice.getStatus());
        payload.put("location", storedDevice.getLocation());
        payload.put("protocol", storedDevice.getProtocol());
        payload.put("firmwareVersion", storedDevice.getFirmwareVersion());
        payload.put("temperature", storedDevice.getTemperature());
        payload.put("humidity", storedDevice.getHumidity());
        payload.put("cpuUsage", storedDevice.getCpuUsage());
        payload.put("uptimeSeconds", storedDevice.getUptimeSeconds());
        payload.put("signalStrength", storedDevice.getSignalStrength());
        payload.put("lastSeen", storedDevice.getLastSeen());
        payload.put("updatedAt", storedDevice.getUpdatedAt());
        addSiteContext(payload, storedDevice);
        return payload;
    }

    private void addSiteContext(Map<String, Object> payload, Device device) {
        if (device.getSite() != null) {
            payload.put("siteId", device.getSite().getId());
            payload.put("siteCode", device.getSite().getCode());
            if (device.getOrganization() != null) {
                payload.put("organizationCode", device.getOrganization().getCode());
            }
        }
    }

    private Device storedDevice(Device device) {
        if (device == null || device.getId() == null) {
            return device;
        }
        return deviceRepository.findById(device.getId()).orElse(device);
    }

    private record SessionScope(boolean enforced, Set<Long> siteIds) {
        private static SessionScope unscoped() {
            return new SessionScope(false, Set.of());
        }
    }
}
