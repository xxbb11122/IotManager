package com.iot.manager.service;

import com.iot.manager.entity.ActivityEvent;
import com.iot.manager.entity.Alert;
import com.iot.manager.entity.Device;
import com.iot.manager.repository.ActivityEventRepository;
import com.iot.manager.repository.AlertRepository;
import com.iot.manager.repository.DeviceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.PostConstruct;
import java.time.LocalDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(name = "iot.simulator.enabled", havingValue = "true", matchIfMissing = false)
public class DeviceSimulator {

    private final DeviceRepository deviceRepo;
    private final AlertRepository alertRepo;
    private final ActivityEventRepository activityEventRepo;
    private final WebSocketService wsService;
    private final DeviceService deviceService;

    @Value("${iot.simulator.initial-device-count:12}")
    private int initialCount;

    @Value("${iot.simulator.interval-ms:4000}")
    private long intervalMs;

    @Value("${iot.simulator.scheduling-enabled:true}")
    private boolean schedulingEnabled;

    private final Random rng = new Random();

    private static final String ONLINE = "ONLINE";
    private static final String OFFLINE = "OFFLINE";
    private static final String WARNING = "WARNING";
    private static final String MAINTENANCE = "MAINTENANCE";
    private static final Set<String> VALID_STATUSES = Set.of(ONLINE, OFFLINE, WARNING, MAINTENANCE);

    private static final double MIN_TEMPERATURE = -40D;
    private static final double MAX_TEMPERATURE = 85D;
    private static final double MIN_HUMIDITY = 0D;
    private static final double MAX_HUMIDITY = 100D;
    private static final double MIN_CPU_USAGE = 0D;
    private static final double MAX_CPU_USAGE = 100D;
    private static final double MIN_SIGNAL_STRENGTH = -95D;
    private static final double MAX_SIGNAL_STRENGTH = -20D;

    private static final String[] TYPES = {"SENSOR", "SENSOR", "SENSOR", "GATEWAY", "ACTUATOR", "CAMERA"};
    private static final String[] PROTOCOLS = {"MQTT", "MQTT", "CoAP", "HTTP", "Modbus"};
    private static final String[] LOCATIONS = {"A栋-1F", "A栋-2F", "B栋-1F", "B栋-3F", "C栋-屋顶", "D栋-地下室", "园区东门", "园区西侧"};
    private static final String[] NAMES = {"温湿度传感器", "振动传感器", "电力监测仪", "边缘网关", "智能阀门", "网络摄像机", "烟感探测器", "PM2.5监测站", "水浸传感器", "UPS监控模块"};

    @PostConstruct
    public void initDevices() {
        if (deviceRepo.count() > 0) return;

        List<Device> devices = new ArrayList<>();
        for (int i = 0; i < initialCount; i++) {
            String type = TYPES[rng.nextInt(TYPES.length)];
            Device d = Device.builder()
                    .name(NAMES[rng.nextInt(NAMES.length)] + " #" + (i + 1))
                    .deviceId("DEV-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase())
                    .type(type)
                    .protocol(PROTOCOLS[rng.nextInt(PROTOCOLS.length)])
                    .status(ONLINE)
                    .location(LOCATIONS[rng.nextInt(LOCATIONS.length)])
                    .firmwareVersion("v" + (1 + rng.nextInt(3)) + "." + rng.nextInt(10) + "." + rng.nextInt(20))
                    .temperature(15.0 + rng.nextDouble() * 30.0)
                    .humidity(30.0 + rng.nextDouble() * 50.0)
                    .cpuUsage(rng.nextDouble() * 70.0)
                    .uptimeSeconds(rng.nextLong(604800L))
                    .signalStrength(-30.0 - rng.nextDouble() * 60.0)
                    .lastSeen(LocalDateTime.now())
                    .build();
            devices.add(d);
        }
        devices.forEach(deviceService::create);
        log.info("已初始化 {} 个模拟设备", initialCount);
    }

    @Scheduled(fixedDelayString = "${iot.simulator.interval-ms:4000}")
    @Transactional
    public void simulateTelemetry() {
        if (!schedulingEnabled) {
            return;
        }
        simulateTelemetryInternal();
    }

    @Transactional
    public void simulateTelemetryTick() {
        simulateTelemetryInternal();
    }

    private void simulateTelemetryInternal() {
        List<Device> devices = deviceRepo.findAll();
        if (devices.isEmpty()) {
            return;
        }

        List<Map<String, Object>> updates = new ArrayList<>();
        int batchSize = Math.min(devices.size(), 6);
        List<Device> batch = new ArrayList<>(devices);
        Collections.shuffle(batch, rng);

        for (int i = 0; i < batchSize; i++) {
            Device device = deviceRepo.findByIdForUpdate(batch.get(i).getId())
                    .orElseThrow(() -> new NoSuchElementException("Device not found"));
            String previousStatus = normalizeStatus(device.getStatus());
            String requestedStatus = chooseNextStatus(device, previousStatus);
            updateTelemetry(device, LocalDateTime.now());

            Device saved = persistStatus(device, previousStatus, requestedStatus);
            updates.add(toTelemetryUpdate(saved));
        }

        if (!updates.isEmpty()) {
            List<Map<String, Object>> telemetryUpdates = List.copyOf(updates);
            wsService.sendDeviceUpdates(telemetryUpdates);
            wsService.sendTelemetryUpdate(telemetryUpdates);
        }
    }

    @Transactional
    public Device applyStatusEventForTest(Long deviceId, String requestedStatus) {
        if (!VALID_STATUSES.contains(requestedStatus)) {
            throw new IllegalArgumentException("Unsupported device status: " + requestedStatus);
        }

        Device device = deviceRepo.findByIdForUpdate(deviceId)
                .orElseThrow(() -> new NoSuchElementException("Device not found"));
        String previousStatus = normalizeStatus(device.getStatus());
        device.setLastSeen(LocalDateTime.now());
        return persistStatus(device, previousStatus, requestedStatus);
    }

    private String chooseNextStatus(Device device, String currentStatus) {
        double event = rng.nextDouble();
        if (event < 0.03D) {
            return OFFLINE;
        }
        if (event < 0.06D) {
            device.setCpuUsage(85D + rng.nextDouble() * 14D);
            return WARNING;
        }
        if (OFFLINE.equals(currentStatus) && event < 0.15D) {
            return ONLINE;
        }
        if (WARNING.equals(currentStatus) && rng.nextDouble() > 0.7D) {
            return ONLINE;
        }
        return currentStatus;
    }

    private void updateTelemetry(Device device, LocalDateTime now) {
        device.setTemperature(clamp(
                numericValue(device.getTemperature(), 0D) + (rng.nextDouble() - 0.5D) * 2D,
                MIN_TEMPERATURE,
                MAX_TEMPERATURE
        ));
        device.setHumidity(clamp(
                numericValue(device.getHumidity(), 0D) + (rng.nextDouble() - 0.5D) * 4D,
                MIN_HUMIDITY,
                MAX_HUMIDITY
        ));
        device.setCpuUsage(clamp(
                numericValue(device.getCpuUsage(), 0D) + (rng.nextDouble() - 0.5D) * 8D,
                MIN_CPU_USAGE,
                MAX_CPU_USAGE
        ));
        device.setSignalStrength(clamp(
                numericValue(device.getSignalStrength(), MAX_SIGNAL_STRENGTH) + (rng.nextDouble() - 0.5D) * 5D,
                MIN_SIGNAL_STRENGTH,
                MAX_SIGNAL_STRENGTH
        ));
        device.setUptimeSeconds(safeUptime(device.getUptimeSeconds()) + intervalSeconds());
        device.setLastSeen(now);
    }

    private Device persistStatus(Device device, String previousStatus, String requestedStatus) {
        device.setStatus(requestedStatus);
        Device saved = deviceRepo.save(device);
        if (!previousStatus.equals(requestedStatus)) {
            Alert alert = createUnresolvedAlert(saved, requestedStatus);
            ActivityEvent activityEvent = createStatusActivity(saved, requestedStatus);
            if (alert != null) {
                wsService.sendAlert(alert);
                wsService.sendAlertUpdate(alert);
            }
            if (activityEvent != null) {
                wsService.sendActivityUpdate(activityEvent);
            }
            wsService.sendDeviceUpdate(saved);
        }
        return saved;
    }

    private Alert createUnresolvedAlert(Device device, String status) {
        if (!WARNING.equals(status) && !OFFLINE.equals(status)) {
            return null;
        }

        String level = OFFLINE.equals(status) ? "CRITICAL" : "WARNING";
        String message = "Device entered " + status + " status";
        if (alertRepo.existsByDevice_IdAndResolvedFalseAndLevelAndMessage(
                device.getId(),
                level,
                message
        )) {
            return null;
        }

        return alertRepo.save(Alert.builder()
                .device(device)
                .level(level)
                .message(message)
                .resolved(false)
                .build());
    }

    private ActivityEvent createStatusActivity(Device device, String status) {
        if (!WARNING.equals(status) && !OFFLINE.equals(status)) {
            return null;
        }

        return activityEventRepo.save(ActivityEvent.builder()
                .device(device)
                .eventType("DEVICE_" + status)
                .detail("Device entered " + status + " status")
                .payloadJson("{\"status\":\"" + status + "\"}")
                .occurredAt(LocalDateTime.now())
                .build());
    }

    private Map<String, Object> toTelemetryUpdate(Device device) {
        Map<String, Object> update = new LinkedHashMap<>();
        update.put("deviceId", device.getDeviceId());
        update.put("name", device.getName());
        update.put("type", device.getType());
        update.put("status", device.getStatus());
        update.put("temperature", rounded(device.getTemperature()));
        update.put("humidity", rounded(device.getHumidity()));
        update.put("cpuUsage", rounded(device.getCpuUsage()));
        update.put("signalStrength", rounded(device.getSignalStrength()));
        update.put("uptimeSeconds", device.getUptimeSeconds());
        update.put("lastSeen", device.getLastSeen().toString());
        return update;
    }

    private long intervalSeconds() {
        return Math.max(1L, intervalMs / 1000L);
    }

    private String normalizeStatus(String status) {
        return status == null || status.isBlank() ? OFFLINE : status;
    }

    private double numericValue(Double value, double fallback) {
        return value == null ? fallback : value;
    }

    private long safeUptime(Long uptimeSeconds) {
        return uptimeSeconds == null ? 0L : Math.max(0L, uptimeSeconds);
    }

    private double clamp(double value, double minimum, double maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private double rounded(Double value) {
        return Math.round(numericValue(value, 0D) * 10D) / 10D;
    }
}
