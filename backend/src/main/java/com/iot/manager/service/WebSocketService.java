package com.iot.manager.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.dto.RealtimeEvent;
import com.iot.manager.entity.ActivityEvent;
import com.iot.manager.entity.Alert;
import com.iot.manager.entity.Device;
import com.iot.manager.repository.DeviceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
@Slf4j
public class WebSocketService {

    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper;
    private final DeviceRepository deviceRepository;
    private final ApplicationEventPublisher eventPublisher;

    public void register(WebSocketSession session) {
        sessions.put(session.getId(), session);
        log.info("WebSocket 连接: {} (当前 {} 个)", session.getId(), sessions.size());
    }

    public void unregister(WebSocketSession session) {
        sessions.remove(session.getId());
        log.info("WebSocket 断开: {} (剩余 {} 个)", session.getId(), sessions.size());
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
        try {
            String json = objectMapper.writeValueAsString(event);
            TextMessage tm = new TextMessage(json);

            List<String> dead = new ArrayList<>();
            sessions.forEach((id, session) -> {
                try {
                    if (session.isOpen()) {
                        synchronized (session) {
                            session.sendMessage(tm);
                        }
                    } else {
                        dead.add(id);
                    }
                } catch (IOException e) {
                    dead.add(id);
                }
            });
            dead.forEach(sessions::remove);
        } catch (Exception e) {
            log.error("广播失败", e);
        }
    }

    public int getSessionCount() {
        return sessions.size();
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

        Device device = storedDevice(activityEvent.getDevice());
        if (device != null) {
            payload.put("deviceId", device.getDeviceId());
            payload.put("devicePublicId", device.getPublicId());
            payload.put("deviceName", device.getName());
            payload.put("deviceStatus", device.getStatus());
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
        return payload;
    }

    private Device storedDevice(Device device) {
        if (device == null || device.getId() == null) {
            return device;
        }
        return deviceRepository.findById(device.getId()).orElse(device);
    }
}
