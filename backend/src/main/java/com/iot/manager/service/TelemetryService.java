package com.iot.manager.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceTelemetrySample;
import com.iot.manager.repository.DeviceTelemetrySampleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class TelemetryService {

    private final DeviceTelemetrySampleRepository sampleRepository;
    private final ObjectMapper objectMapper;

    @Transactional
    public void record(Device device, Map<String, Object> state, String source, LocalDateTime observedAt) {
        if (device == null || device.getId() == null || state == null) return;
        LocalDateTime sampledAt = observedAt == null ? LocalDateTime.now() : observedAt;
        LocalDateTime bucket = sampledAt.truncatedTo(ChronoUnit.MINUTES);
        String json = writeJson(state);
        DeviceTelemetrySample sample = sampleRepository.findByDeviceIdAndBucketStart(device.getId(), bucket)
                .orElseGet(() -> DeviceTelemetrySample.builder()
                        .device(device)
                        .bucketStart(bucket)
                        .build());
        sample.setSampledAt(sampledAt);
        sample.setSource(source == null || source.isBlank() ? "UNKNOWN" : source);
        sample.setStateJson(json);
        sampleRepository.save(sample);
    }

    @Transactional(readOnly = true)
    public java.util.List<Map<String, Object>> history(Long deviceId, LocalDateTime from, LocalDateTime to) {
        LocalDateTime start = from == null ? LocalDateTime.now().minusDays(30) : from;
        LocalDateTime end = to == null ? LocalDateTime.now() : to;
        return sampleRepository.findByDeviceIdAndSampledAtBetweenOrderBySampledAtAsc(deviceId, start, end).stream()
                .map(sample -> {
                    Map<String, Object> value = new LinkedHashMap<>();
                    value.put("sampledAt", sample.getSampledAt());
                    value.put("source", sample.getSource());
                    value.put("state", readJson(sample.getStateJson()));
                    return value;
                })
                .toList();
    }

    private String writeJson(Map<String, Object> state) {
        try {
            return objectMapper.writeValueAsString(state);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Telemetry state must contain valid JSON values");
        }
    }

    private Map<String, Object> readJson(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<LinkedHashMap<String, Object>>() { });
        } catch (JsonProcessingException exception) {
            return Map.of();
        }
    }
}
