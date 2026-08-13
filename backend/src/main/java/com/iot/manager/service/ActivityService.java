package com.iot.manager.service;

import com.iot.manager.dto.ActivityView;
import com.iot.manager.dto.PageResponse;
import com.iot.manager.repository.ActivityEventRepository;
import com.iot.manager.repository.DeviceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

import java.util.List;
import java.util.NoSuchElementException;

@Service
@RequiredArgsConstructor
public class ActivityService {

    private final DeviceRepository deviceRepository;
    private final ActivityEventRepository activityEventRepository;
    private final DeviceMapper deviceMapper;

    @Transactional(readOnly = true)
    public List<ActivityView> getByDeviceId(Long deviceId) {
        if (!deviceRepository.existsById(deviceId)) {
            throw new NoSuchElementException("Device not found");
        }
        return activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(deviceId).stream()
                .map(deviceMapper::toActivityView)
                .toList();
    }

    @Transactional(readOnly = true)
    public PageResponse<ActivityView> history(Long deviceId, int page, int size) {
        if (!deviceRepository.existsById(deviceId)) {
            throw new NoSuchElementException("Device not found");
        }
        int normalizedPage = Math.max(0, page);
        int normalizedSize = Math.min(100, Math.max(1, size));
        return PageResponse.from(
                activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(
                        deviceId, PageRequest.of(normalizedPage, normalizedSize, Sort.by(Sort.Direction.DESC, "occurredAt", "id"))
                ),
                deviceMapper::toActivityView
        );
    }
}
