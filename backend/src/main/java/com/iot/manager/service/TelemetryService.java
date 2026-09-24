package com.iot.manager.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceTelemetrySample;
import com.iot.manager.entity.DeviceTelemetrySampleArchive;
import com.iot.manager.entity.ObservedTimeTrust;
import com.iot.manager.config.TimeProperties;
import com.iot.manager.repository.DeviceTelemetrySampleRepository;
import com.iot.manager.repository.DeviceTelemetrySampleArchiveRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class TelemetryService {

    private final DeviceTelemetrySampleRepository sampleRepository;
    private final DeviceTelemetrySampleArchiveRepository archiveRepository;
    private final ObjectMapper objectMapper;
    private final TimeProvider timeProvider;
    private final TimeProperties timeProperties;
    private final PlatformMetricsService platformMetricsService;

    @Transactional
    public void record(Device device, Map<String, Object> state, String source, Instant observedAt) {
        if (device == null || device.getId() == null || state == null) return;
        Instant receivedAt = timeProvider.now();
        Instant bucket = receivedAt.truncatedTo(ChronoUnit.MINUTES);
        ObservedTimeTrust trust = observedTimeTrust(observedAt, receivedAt);
        LocalDateTime legacyBucket = timeProvider.legacyUtc(bucket);
        LocalDateTime legacySampledAt = timeProvider.legacyUtc(observedAt == null ? receivedAt : observedAt);
        String json = writeJson(state);
        // During the migration window an old record can still have a null UTC
        // bucket. Reuse it when its legacy bucket is an exact UTC match rather
        // than creating a second current-minute sample.
        DeviceTelemetrySample sample = sampleRepository.findByDeviceIdAndBucketStartUtc(device.getId(), bucket)
                .or(() -> sampleRepository.findByDeviceIdAndBucketStart(device.getId(), legacyBucket))
                .orElseGet(() -> DeviceTelemetrySample.builder()
                        .device(device)
                        .bucketStart(legacyBucket)
                        .build());
        sample.setBucketStart(legacyBucket);
        sample.setBucketStartUtc(bucket);
        sample.setSampledAt(legacySampledAt);
        sample.setReceivedAt(receivedAt);
        sample.setObservedAt(observedAt);
        sample.setObservedTimeTrust(trust);
        sample.setSource(source == null || source.isBlank() ? "UNKNOWN" : source);
        sample.setStateJson(json);
        sampleRepository.save(sample);
    }

    @Transactional(readOnly = true)
    public java.util.List<Map<String, Object>> history(Long deviceId, LocalDateTime from, LocalDateTime to) {
        Instant start = from == null ? timeProvider.now().minus(ChronoUnit.DAYS.getDuration().multipliedBy(30)) : from.toInstant(java.time.ZoneOffset.UTC);
        Instant end = to == null ? timeProvider.now() : to.toInstant(java.time.ZoneOffset.UTC);
        return historyByReceivedAt(deviceId, start, end);
    }

    @Transactional(readOnly = true)
    public java.util.List<Map<String, Object>> historyByReceivedAt(Long deviceId, Instant from, Instant to) {
        Instant start = from == null ? timeProvider.now().minus(ChronoUnit.DAYS.getDuration().multipliedBy(30)) : from;
        Instant end = to == null ? timeProvider.now() : to;
        LocalDateTime legacyStart = timeProvider.legacyUtc(start);
        LocalDateTime legacyEnd = timeProvider.legacyUtc(end);
        return java.util.stream.Stream.concat(
                        sampleRepository.findByDeviceIdAndReceivedAtBetweenOrderByReceivedAtAsc(deviceId, start, end).stream(),
                        sampleRepository.findByDeviceIdAndReceivedAtIsNullAndSampledAtBetweenOrderBySampledAtAsc(
                                deviceId, legacyStart, legacyEnd
                        ).stream()
                )
                // Unknown legacy wall-clock rows remain visible in a separate
                // branch; they are never interleaved as if their timestamp
                // were a proven server receipt instant.
                .sorted(java.util.Comparator
                        .comparing((DeviceTelemetrySample sample) -> sample.getReceivedAt() != null)
                        .thenComparing(sample -> sample.getReceivedAt() == null
                                ? sample.getSampledAt()
                                : timeProvider.legacyUtc(sample.getReceivedAt())))
                .map(sample -> {
                    boolean legacyUnknown = sample.getReceivedAt() == null;
                    if (legacyUnknown) {
                        platformMetricsService.telemetryLegacyTime();
                    }
                    Map<String, Object> value = new LinkedHashMap<>();
                    value.put("sampledAt", legacyUnknown ? sample.getSampledAt()
                            : sample.getObservedAt() == null ? sample.getReceivedAt() : sample.getObservedAt());
                    value.put("receivedAt", sample.getReceivedAt());
                    value.put("observedAt", sample.getObservedAt());
                    value.put("observedTimeTrust", legacyUnknown
                            ? ObservedTimeTrust.LEGACY_UNKNOWN.name()
                            : sample.getObservedTimeTrust() == null
                                    ? ObservedTimeTrust.UNKNOWN.name()
                                    : sample.getObservedTimeTrust().name());
                    value.put("source", sample.getSource());
                    value.put("state", readJson(sample.getStateJson()));
                    return value;
                })
                .toList();
    }

    @Transactional(readOnly = true)
    public DeviceTelemetrySample latest(Long deviceId) {
        return sampleRepository.findTopByDeviceIdAndReceivedAtIsNotNullOrderByReceivedAtDesc(deviceId)
                .or(() -> sampleRepository.findTopByDeviceIdOrderBySampledAtDesc(deviceId))
                .orElse(null);
    }

    /** Archived data has its own bounded, keyset-paged route and never enters
     * the hot history query used by live clients. */
    @Transactional(readOnly = true)
    public ArchivePage archiveHistory(
            Long deviceId, Instant from, Instant to, Instant afterReceivedAt, Long afterId, int limit
    ) {
        if (from == null || to == null || !from.isBefore(to)
                || Duration.between(from, to).compareTo(Duration.ofDays(31)) > 0) {
            throw new IllegalArgumentException("Archive query requires from < to within a 31-day window");
        }
        if (limit < 1 || limit > 500) {
            throw new IllegalArgumentException("Archive query limit must be between 1 and 500");
        }
        if ((afterReceivedAt == null) != (afterId == null) || afterId != null && afterId < 1) {
            throw new IllegalArgumentException("Archive cursor requires both afterReceivedAt and a positive afterId");
        }
        org.springframework.data.domain.PageRequest page = org.springframework.data.domain.PageRequest.of(0, limit + 1);
        List<DeviceTelemetrySampleArchive> fetched = afterReceivedAt == null
                ? archiveRepository.findArchivePage(deviceId, from, to, page)
                : archiveRepository.findArchivePageAfter(deviceId, from, to, afterReceivedAt, afterId, page);
        boolean hasMore = fetched.size() > limit;
        List<DeviceTelemetrySampleArchive> selected = fetched.subList(0, Math.min(fetched.size(), limit));
        List<Map<String, Object>> items = selected.stream().map(sample -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("sourceSampleId", sample.getSourceSampleId());
            item.put("sampledAt", sample.getSampledAt());
            item.put("receivedAt", sample.getReceivedAt());
            item.put("observedAt", sample.getObservedAt());
            item.put("observedTimeTrust", sample.getObservedTimeTrust());
            item.put("source", sample.getSource());
            item.put("state", readJson(sample.getStateJson()));
            return item;
        }).toList();
        DeviceTelemetrySampleArchive last = hasMore ? selected.get(selected.size() - 1) : null;
        return new ArchivePage(items, last == null ? null : last.getReceivedAt(), last == null ? null : last.getId());
    }

    public record ArchivePage(List<Map<String, Object>> items, Instant nextReceivedAt, Long nextId) { }

    private ObservedTimeTrust observedTimeTrust(Instant observedAt, Instant receivedAt) {
        if (observedAt == null) return ObservedTimeTrust.UNKNOWN;
        Duration absoluteSkew;
        try {
            absoluteSkew = Duration.between(observedAt, receivedAt).abs();
        } catch (ArithmeticException exception) {
            return ObservedTimeTrust.SKEWED;
        }
        return absoluteSkew.compareTo(timeProperties.getClockSkewTolerance()) <= 0
                ? ObservedTimeTrust.TRUSTED
                : ObservedTimeTrust.SKEWED;
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
