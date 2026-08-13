package com.iot.manager.service;

import com.iot.manager.dto.DeviceCreateRequest;
import com.iot.manager.dto.DeviceUpdateRequest;
import com.iot.manager.dto.DeviceView;
import com.iot.manager.entity.ActivityEvent;
import com.iot.manager.entity.Alert;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.Space;
import com.iot.manager.repository.ActivityEventRepository;
import com.iot.manager.repository.AlertRepository;
import com.iot.manager.repository.DeviceCommandRepository;
import com.iot.manager.repository.DeviceConnectionRepository;
import com.iot.manager.repository.DeviceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class DeviceService {

    private final DeviceRepository deviceRepo;
    private final AlertRepository alertRepo;
    private final ActivityEventRepository activityEventRepo;
    private final DeviceCommandRepository deviceCommandRepo;
    private final DeviceConnectionRepository connectionRepo;
    private final BootstrapService bootstrapService;
    private final DeviceMapper deviceMapper;
    private final WebSocketService webSocketService;

    public List<Device> getAll(String status, String type, String search) {
        return findDevices(status, type, search);
    }

    @Transactional(readOnly = true)
    public List<DeviceView> getAllViews(String status, String type, String search) {
        return deviceMapper.toViews(findDevices(status, type, search));
    }

    public Optional<Device> getById(Long id) {
        return deviceRepo.findById(id);
    }

    public Optional<Device> getByDeviceId(String deviceId) {
        return deviceRepo.findByDeviceId(deviceId);
    }

    @Transactional(readOnly = true)
    public Optional<DeviceView> getViewById(Long id) {
        return deviceRepo.findById(id).map(deviceMapper::toView);
    }

    @Transactional(readOnly = true)
    public Optional<DeviceView> getViewByDeviceId(String deviceId) {
        return deviceRepo.findByDeviceId(deviceId).map(deviceMapper::toView);
    }

    @Transactional
    public Device create(Device device) {
        return createInContext(device, bootstrapService.ensureDemoContext());
    }

    @Transactional
    public Device createInContext(Device device, Space space) {
        if (space == null) {
            throw new NoSuchElementException("Space not found");
        }

        if (device.getDeviceId() == null || device.getDeviceId().isBlank()) {
            device.setDeviceId("DEV-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase());
        }
        if (device.getPublicId() == null || device.getPublicId().isBlank()) {
            device.setPublicId("device-" + UUID.randomUUID());
        }
        if (device.getStatus() == null || device.getStatus().isBlank()) {
            device.setStatus("OFFLINE");
        }
        if (device.getTemperature() == null) {
            device.setTemperature(0D);
        }
        if (device.getHumidity() == null) {
            device.setHumidity(0D);
        }
        if (device.getCpuUsage() == null) {
            device.setCpuUsage(0D);
        }
        if (device.getUptimeSeconds() == null) {
            device.setUptimeSeconds(0L);
        }
        if (device.getSignalStrength() == null) {
            device.setSignalStrength(0D);
        }
        if (device.getReportedStateJson() == null || device.getReportedStateJson().isBlank()) {
            device.setReportedStateJson("{}");
        }
        if (device.getDesiredStateJson() == null || device.getDesiredStateJson().isBlank()) {
            device.setDesiredStateJson("{}");
        }

        device.setOrganization(space.getSite().getOrganization());
        device.setSite(space.getSite());
        device.setSpace(space);

        Device saved = deviceRepo.save(device);
        activityEventRepo.save(ActivityEvent.builder()
                .device(saved)
                .eventType("DEVICE_REGISTERED")
                .detail("Device registered")
                .payloadJson("{\"deviceId\":\"" + saved.getDeviceId() + "\"}")
                .occurredAt(LocalDateTime.now())
                .build());
        webSocketService.sendDeviceUpdate(saved);
        return saved;
    }

    @Transactional
    public DeviceView create(DeviceCreateRequest request) {
        Device device = Device.builder()
                .name(request.name())
                .type(request.type())
                .protocol(request.protocol())
                .location(request.location())
                .firmwareVersion(request.firmwareVersion())
                .status(request.status())
                .build();
        return deviceMapper.toView(create(device));
    }

    @Transactional
    public Device update(Long id, Device partial) {
        return updateDevice(
                id,
                partial.getName(),
                partial.getType(),
                partial.getProtocol(),
                partial.getLocation(),
                partial.getFirmwareVersion(),
                partial.getStatus()
        );
    }

    @Transactional
    public DeviceView update(Long id, DeviceUpdateRequest request) {
        return deviceMapper.toView(updateDevice(
                id,
                request.name(),
                request.type(),
                request.protocol(),
                request.location(),
                request.firmwareVersion(),
                request.status()
        ));
    }

    @Transactional
    public void delete(Long id) {
        Device device = deviceRepo.findById(id)
                .orElseThrow(() -> new NoSuchElementException("Device not found"));
        if (device.getArchivedAt() != null) {
            return;
        }
        device.setArchivedAt(LocalDateTime.now());
        device.setArchivedReason("Archived through device API");
        device.setArchivedBy("anonymous");
        activityEventRepo.save(ActivityEvent.builder()
                .device(device)
                .eventType("DEVICE_ARCHIVED")
                .detail("Device archived; command and telemetry history retained")
                .payloadJson("{\"reason\":\"Archived through device API\"}")
                .occurredAt(LocalDateTime.now())
                .build());
        webSocketService.sendDeviceArchived(device);
    }

    public Map<String, Object> getDashboardStats() {
        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("total", deviceRepo.findAllActive(Sort.by(Sort.Direction.DESC, "updatedAt")).size());
        stats.put("online", deviceRepo.countByStatusAndArchivedAtIsNull("ONLINE"));
        stats.put("offline", deviceRepo.countByStatusAndArchivedAtIsNull("OFFLINE"));
        stats.put("warning", deviceRepo.countByStatusAndArchivedAtIsNull("WARNING"));
        stats.put("activeAlerts", alertRepo.countByResolvedFalse());

        List<Object[]> byStatus = deviceRepo.countGroupByStatus();
        Map<String, Long> statusMap = new LinkedHashMap<>();
        byStatus.forEach(row -> statusMap.put((String) row[0], (Long) row[1]));
        stats.put("statusBreakdown", statusMap);

        List<Object[]> byType = deviceRepo.countGroupByType();
        Map<String, Long> typeMap = new LinkedHashMap<>();
        byType.forEach(row -> typeMap.put((String) row[0], (Long) row[1]));
        stats.put("typeBreakdown", typeMap);

        return stats;
    }

    public List<Alert> getActiveAlerts() {
        return alertRepo.findByResolvedFalseOrderByCreatedAtDesc();
    }

    public List<Alert> getRecentAlerts() {
        return alertRepo.findTop20ByOrderByCreatedAtDesc();
    }

    @Transactional
    public Alert resolveAlert(Long alertId) {
        Alert alert = alertRepo.findById(alertId)
                .orElseThrow(() -> new NoSuchElementException("Alert not found"));
        if (alert.isResolved()) {
            return alert;
        }
        alert.setResolved(true);
        alert.setResolvedAt(LocalDateTime.now());
        alert.setStatus("RESOLVED");
        Alert saved = alertRepo.save(alert);
        if (saved.getDevice() != null) {
            ActivityEvent event = activityEventRepo.save(ActivityEvent.builder()
                    .device(saved.getDevice())
                    .eventType("ALERT_RESOLVED")
                    .detail("Alert resolved")
                    .payloadJson("{\"alertId\":" + saved.getId() + "}")
                    .occurredAt(LocalDateTime.now())
                    .build());
            webSocketService.sendActivityUpdate(event);
        }
        webSocketService.sendAlertUpdate(saved);
        return saved;
    }

    @Transactional
    public Alert createAlert(Device device, String level, String message) {
        Alert alert = Alert.builder()
                .device(device)
                .level(level)
                .message(message)
                .resolved(false)
                .status("OPEN")
                .build();
        return alertRepo.save(alert);
    }

    private List<Device> findDevices(String status, String type, String search) {
        if (search != null && !search.isEmpty()) {
            return deviceRepo.findActiveByNameContainingOrDeviceIdContaining(search);
        }
        if (status != null && !status.isEmpty()) {
            return deviceRepo.findByStatusAndArchivedAtIsNull(status);
        }
        if (type != null && !type.isEmpty()) {
            return deviceRepo.findByTypeAndArchivedAtIsNull(type);
        }
        return deviceRepo.findAllActive(Sort.by(Sort.Direction.DESC, "updatedAt"));
    }

    private Device updateDevice(
            Long id,
            String name,
            String type,
            String protocol,
            String location,
            String firmwareVersion,
            String status
    ) {
        Device device = deviceRepo.findById(id)
                .orElseThrow(() -> new NoSuchElementException("Device not found"));
        if (name != null) {
            device.setName(name);
        }
        if (type != null) {
            device.setType(type);
        }
        if (protocol != null) {
            device.setProtocol(protocol);
        }
        if (location != null) {
            device.setLocation(location);
        }
        if (firmwareVersion != null) {
            device.setFirmwareVersion(firmwareVersion);
        }
        if (status != null) {
            device.setStatus(status);
        }
        Device saved = deviceRepo.save(device);
        webSocketService.sendDeviceUpdate(saved);
        return saved;
    }
}
