package com.iot.manager.service;

import com.iot.manager.dto.DeviceCreateRequest;
import com.iot.manager.dto.DeviceUpdateRequest;
import com.iot.manager.dto.DeviceView;
import com.iot.manager.entity.ActivityEvent;
import com.iot.manager.entity.Alert;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.Space;
import com.iot.manager.repository.AlertRepository;
import com.iot.manager.repository.DeviceCommandRepository;
import com.iot.manager.repository.DeviceConnectionRepository;
import com.iot.manager.repository.DeviceRepository;
import com.iot.manager.repository.SpaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class DeviceService {

    private final DeviceRepository deviceRepo;
    private final SpaceRepository spaceRepo;
    private final AlertRepository alertRepo;
    private final AuditEventService auditEventService;
    private final AuditContextService auditContextService;
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

    @Transactional(readOnly = true)
    public List<DeviceView> getAllViews(
            String status, String type, String search, Collection<Long> allowedSiteIds
    ) {
        return deviceMapper.toViews(findDevices(status, type, search, allowedSiteIds));
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

        // Callers may resolve a space in a separate transaction (for example
        // an authenticated site-selection request). Reload it here so the
        // site/organization associations are managed before they are copied
        // onto the new device.
        Space managedSpace = spaceRepo.findById(space.getId())
                .orElseThrow(() -> new NoSuchElementException("Space not found"));

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

        device.setOrganization(managedSpace.getSite().getOrganization());
        device.setSite(managedSpace.getSite());
        device.setSpace(managedSpace);

        Device saved = deviceRepo.save(device);
        auditEventService.recordActivity(
                saved,
                "DEVICE_REGISTERED",
                "Device registered",
                "{\"deviceId\":\"" + saved.getDeviceId() + "\"}"
        );
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
    public DeviceView create(DeviceCreateRequest request, Space space) {
        Device device = Device.builder()
                .name(request.name())
                .type(request.type())
                .protocol(request.protocol())
                .location(request.location())
                .firmwareVersion(request.firmwareVersion())
                .status(request.status())
                .build();
        return deviceMapper.toView(createInContext(device, space));
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
        device.setArchivedBy(auditContextService.currentSubjectOrAnonymous());
        auditEventService.recordActivity(
                device,
                "DEVICE_ARCHIVED",
                "Device archived; command and telemetry history retained",
                "{\"reason\":\"Archived through device API\"}"
        );
        webSocketService.sendDeviceArchived(device);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getDashboardStats() {
        return getDashboardStats(null);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getDashboardStats(Collection<Long> allowedSiteIds) {
        List<Device> devices = findDevices(null, null, null, allowedSiteIds);
        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("total", devices.size());
        stats.put("online", devices.stream().filter(device -> "ONLINE".equals(device.getStatus())).count());
        stats.put("offline", devices.stream().filter(device -> "OFFLINE".equals(device.getStatus())).count());
        stats.put("warning", devices.stream().filter(device -> "WARNING".equals(device.getStatus())).count());
        stats.put("activeAlerts", alertRepo.findByResolvedFalseOrderByCreatedAtDesc().stream()
                .filter(alert -> allowedSiteIds == null
                        || (alert.getDevice() != null && alert.getDevice().getSite() != null
                        && allowedSiteIds.contains(alert.getDevice().getSite().getId())))
                .count());

        Map<String, Long> statusMap = new LinkedHashMap<>();
        devices.forEach(device -> statusMap.merge(device.getStatus(), 1L, Long::sum));
        stats.put("statusBreakdown", statusMap);

        Map<String, Long> typeMap = new LinkedHashMap<>();
        devices.forEach(device -> typeMap.merge(device.getType(), 1L, Long::sum));
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
            ActivityEvent event = auditEventService.recordActivity(
                    saved.getDevice(),
                    "ALERT_RESOLVED",
                    "Alert resolved",
                    "{\"alertId\":" + saved.getId() + "}"
            );
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
        return findDevices(status, type, search, null);
    }

    private List<Device> findDevices(
            String status, String type, String search, Collection<Long> allowedSiteIds
    ) {
        List<Device> devices;
        if (search != null && !search.isEmpty()) {
            devices = deviceRepo.findActiveByNameContainingOrDeviceIdContaining(search);
        } else if (status != null && !status.isEmpty()) {
            devices = deviceRepo.findByStatusAndArchivedAtIsNull(status);
        } else if (type != null && !type.isEmpty()) {
            devices = deviceRepo.findByTypeAndArchivedAtIsNull(type);
        } else {
            devices = deviceRepo.findAllActive(Sort.by(Sort.Direction.DESC, "updatedAt"));
        }
        if (allowedSiteIds == null) {
            return devices;
        }
        return devices.stream()
                .filter(device -> device.getSite() != null && allowedSiteIds.contains(device.getSite().getId()))
                .toList();
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
