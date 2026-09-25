package com.iot.manager.service;

import com.iot.manager.dto.RetentionHoldRequest;
import com.iot.manager.entity.ActivityEvent;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceTelemetrySample;
import com.iot.manager.entity.DeviceTelemetrySampleArchive;
import com.iot.manager.entity.ObservedTimeTrust;
import com.iot.manager.repository.ActivityEventRepository;
import com.iot.manager.repository.DeviceTelemetrySampleArchiveRepository;
import com.iot.manager.repository.DeviceTelemetrySampleRepository;
import com.iot.manager.repository.RetentionJobRunRepository;
import com.iot.manager.repository.RetentionWatermarkRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Uses the migrated H2 schema rather than mocks: retention is destructive
 * once enabled, so its archive-before-delete and hold behavior must be proved
 * against real repositories and transactions.
 */
@SpringBootTest(properties = {
        "iot.retention.enabled=false",
        "iot.retention.dry-run=false",
        "iot.retention.batch-size=10"
})
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class RetentionServiceIntegrationTest {

    @Autowired
    private RetentionService retentionService;

    @Autowired
    private RetentionHoldService retentionHoldService;

    @Autowired
    private DeviceService deviceService;

    @Autowired
    private DeviceTelemetrySampleRepository telemetryRepository;

    @Autowired
    private DeviceTelemetrySampleArchiveRepository archiveRepository;

    @Autowired
    private ActivityEventRepository activityEventRepository;

    @Autowired
    private RetentionJobRunRepository jobRunRepository;

    @Autowired
    private RetentionWatermarkRepository watermarkRepository;

    @Autowired
    private com.iot.manager.config.RetentionProperties retentionProperties;

    @Autowired
    private TimeProvider timeProvider;

    @AfterEach
    void resetDryRun() {
        retentionProperties.setDryRun(false);
        retentionProperties.setBatchSize(10);
    }

    @Test
    void archivesEligibleTelemetryBeforeDeletingItsHotCopyAndLeavesLegacyRowsUntouched() {
        Device device = device("archive");
        Instant receivedAt = timeProvider.now().minus(120, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MINUTES);
        DeviceTelemetrySample eligible = sample(device, receivedAt, receivedAt.plus(4, ChronoUnit.HOURS));
        DeviceTelemetrySample recent = sample(device, timeProvider.now().minus(2, ChronoUnit.DAYS), timeProvider.now());
        DeviceTelemetrySample legacy = legacySample(device, timeProvider.now().minus(500, ChronoUnit.DAYS));

        retentionService.runOnce();

        assertThat(telemetryRepository.findById(eligible.getId())).isEmpty();
        assertThat(archiveRepository.findAll())
                .anySatisfy(archive -> {
                    assertThat(archive.getSourceSampleId()).isEqualTo(eligible.getId());
                    assertThat(archive.getReceivedAt()).isEqualTo(receivedAt);
                    assertThat(archive.getObservedTimeTrust()).isEqualTo(ObservedTimeTrust.SKEWED.name());
                });
        assertThat(telemetryRepository.findById(recent.getId())).isPresent();
        assertThat(telemetryRepository.findById(legacy.getId())).isPresent();
        assertThat(jobRunRepository.findTop50ByDataCategoryOrderByStartedAtDesc("TELEMETRY"))
                .first()
                .satisfies(run -> {
                    assertThat(run.getStatus()).isEqualTo("COMPLETED");
                    assertThat(run.getArchivedRows()).isGreaterThanOrEqualTo(1);
                    assertThat(run.getDeletedRows()).isGreaterThanOrEqualTo(1);
                });
    }

    @Test
    void activeDeviceHoldBlocksArchiveAndDeletion() {
        Device device = device("held");
        DeviceTelemetrySample eligible = sample(
                device,
                timeProvider.now().minus(120, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MINUTES),
                timeProvider.now().minus(120, ChronoUnit.DAYS)
        );
        retentionHoldService.create(new RetentionHoldRequest(
                RetentionHoldService.DEVICE, String.valueOf(device.getId()), null, "Investigation is active"
        ));

        retentionService.runOnce();

        assertThat(telemetryRepository.findById(eligible.getId())).isPresent();
        assertThat(archiveRepository.findAll()).noneMatch(archive -> archive.getSourceSampleId().equals(eligible.getId()));
        assertThat(jobRunRepository.findTop50ByDataCategoryOrderByStartedAtDesc("TELEMETRY"))
                .first()
                .satisfies(run -> assertThat(run.getHeldRows()).isGreaterThanOrEqualTo(1));
    }

    @Test
    void dryRunRecordsAResultButMakesNoDestructiveChange() {
        Device device = device("dry-run");
        DeviceTelemetrySample eligible = sample(
                device,
                timeProvider.now().minus(120, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MINUTES),
                timeProvider.now().minus(120, ChronoUnit.DAYS)
        );
        retentionProperties.setDryRun(true);

        retentionService.runOnce();

        assertThat(telemetryRepository.findById(eligible.getId())).isPresent();
        assertThat(archiveRepository.findAll()).noneMatch(archive -> archive.getSourceSampleId().equals(eligible.getId()));
        assertThat(jobRunRepository.findTop50ByDataCategoryOrderByStartedAtDesc("TELEMETRY"))
                .first()
                .satisfies(run -> {
                    assertThat(run.isDryRun()).isTrue();
                    assertThat(run.getStatus()).isEqualTo("DRY_RUN");
                    assertThat(run.getEstimatedRows()).isGreaterThanOrEqualTo(1);
                });
    }

    @Test
    void dryRunPredictsTheSameDeletionCountAsAnExpiredHotBacklogExecution() {
        Device device = device("overdue");
        Instant receivedAt = timeProvider.now().minus(400, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MINUTES);
        DeviceTelemetrySample overdue = sample(device, receivedAt, receivedAt);

        retentionProperties.setDryRun(true);
        RetentionService.RetentionRunOutcome prediction = retentionService.runOnce().stream()
                .filter(outcome -> "TELEMETRY".equals(outcome.category()))
                .findFirst().orElseThrow();
        assertThat(telemetryRepository.findById(overdue.getId())).isPresent();
        assertThat(archiveRepository.findAll()).isEmpty();

        retentionProperties.setDryRun(false);
        RetentionService.RetentionRunOutcome execution = retentionService.runOnce().stream()
                .filter(outcome -> "TELEMETRY".equals(outcome.category()))
                .findFirst().orElseThrow();

        assertThat(prediction.counts().archived()).isEqualTo(execution.counts().archived());
        assertThat(prediction.counts().deleted()).isEqualTo(execution.counts().deleted());
    }

    @Test
    void overdueDryRunProjectionRespectsTheBatchLimitAndResumeCursor() {
        retentionProperties.setBatchSize(1);
        Device device = device("batch-preview");
        Instant first = timeProvider.now().minus(400, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MINUTES);
        for (int index = 0; index < 22; index++) {
            sample(device, first.plus(index, ChronoUnit.MINUTES), first.plus(index, ChronoUnit.MINUTES));
        }

        retentionProperties.setDryRun(true);
        RetentionService.CategoryCounts firstPrediction = telemetryCounts(retentionService.runOnce());
        RetentionService.CategoryCounts repeatedPrediction = telemetryCounts(retentionService.runOnce());
        assertThat(firstPrediction.archived()).isEqualTo(20);
        assertThat(firstPrediction.deleted()).isEqualTo(40);
        assertThat(repeatedPrediction).isEqualTo(firstPrediction);
        assertThat(telemetryRepository.findAll()).hasSize(22);
        assertThat(archiveRepository.findAll()).isEmpty();

        retentionProperties.setDryRun(false);
        RetentionService.CategoryCounts firstExecution = telemetryCounts(retentionService.runOnce());
        assertThat(firstExecution.archived()).isEqualTo(firstPrediction.archived());
        assertThat(firstExecution.deleted()).isEqualTo(firstPrediction.deleted());
        assertThat(telemetryRepository.findAll()).hasSize(2);
        assertThat(archiveRepository.findAll()).isEmpty();

        retentionProperties.setDryRun(true);
        RetentionService.CategoryCounts secondPrediction = telemetryCounts(retentionService.runOnce());
        retentionProperties.setDryRun(false);
        RetentionService.CategoryCounts secondExecution = telemetryCounts(retentionService.runOnce());
        assertThat(secondPrediction.archived()).isEqualTo(2);
        assertThat(secondPrediction.deleted()).isEqualTo(4);
        assertThat(secondExecution.archived()).isEqualTo(secondPrediction.archived());
        assertThat(secondExecution.deleted()).isEqualTo(secondPrediction.deleted());
        assertThat(telemetryRepository.findAll()).isEmpty();
        assertThat(archiveRepository.findAll()).isEmpty();
        assertThat(watermarkRepository.findById("TELEMETRY_ARCHIVE")).isEmpty();
        assertThat(watermarkRepository.findById("TELEMETRY_PURGE")).isEmpty();
    }

    @Test
    void interruptedTelemetryPassResumesFromItsWatermarkThenClearsItAfterCompletion() {
        retentionProperties.setBatchSize(1);
        Device device = device("watermark");
        Instant first = timeProvider.now().minus(150, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MINUTES);
        for (int index = 0; index < 22; index++) {
            Instant receivedAt = first.plus(index, ChronoUnit.MINUTES);
            sample(device, receivedAt, receivedAt);
        }

        retentionService.runOnce();

        assertThat(watermarkRepository.findById("TELEMETRY_ARCHIVE")).isPresent();
        assertThat(archiveRepository.findAll().stream()
                .filter(archive -> archive.getDeviceId().equals(device.getId()))).hasSize(20);
        assertThat(telemetryRepository.findAll().stream()
                .filter(sample -> sample.getDevice().getId().equals(device.getId()))).hasSize(2);

        retentionService.runOnce();

        assertThat(watermarkRepository.findById("TELEMETRY_ARCHIVE")).isEmpty();
        assertThat(archiveRepository.findAll().stream()
                .filter(archive -> archive.getDeviceId().equals(device.getId()))).hasSize(22);
        assertThat(telemetryRepository.findAll().stream()
                .filter(sample -> sample.getDevice().getId().equals(device.getId()))).isEmpty();
    }

    @Test
    void nonTelemetryCategoriesUseTheSameBoundedCursorAndResumeSemantics() {
        retentionProperties.setBatchSize(1);
        Device device = device("activity-wm");
        Instant first = timeProvider.now().minus(800, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MINUTES);
        for (int index = 0; index < 22; index++) {
            Instant occurredAt = first.plus(index, ChronoUnit.MINUTES);
            activityEventRepository.saveAndFlush(ActivityEvent.builder()
                    .device(device)
                    .eventType("RETENTION_TEST")
                    .detail("bounded activity retention " + index)
                    .occurredAt(timeProvider.legacyUtc(occurredAt))
                    .occurredAtUtc(occurredAt)
                    .build());
        }

        retentionService.runOnce();

        assertThat(watermarkRepository.findById("ACTIVITY_EVENTS")).isPresent();
        assertThat(retentionEventsFor(device)).hasSize(2);

        retentionService.runOnce();

        assertThat(watermarkRepository.findById("ACTIVITY_EVENTS")).isEmpty();
        assertThat(retentionEventsFor(device)).isEmpty();
    }

    @Test
    void archiveChecksumMismatchFailsTheBatchAndRetainsTheHotSample() {
        Device device = device("archive-check");
        Instant receivedAt = timeProvider.now().minus(120, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MINUTES);
        DeviceTelemetrySample eligible = sample(device, receivedAt, receivedAt);
        archiveRepository.saveAndFlush(DeviceTelemetrySampleArchive.builder()
                .sourceSampleId(eligible.getId())
                .deviceId(device.getId())
                .bucketStart(eligible.getBucketStart())
                .sampledAt(eligible.getSampledAt())
                .receivedAt(eligible.getReceivedAt())
                .observedAt(eligible.getObservedAt())
                .observedTimeTrust(eligible.getObservedTimeTrust().name())
                .bucketStartUtc(eligible.getBucketStartUtc())
                .source(eligible.getSource())
                .stateJson("{\"tampered\":true}")
                .archivedAt(timeProvider.now())
                .build());

        assertThatThrownBy(retentionService::runOnce)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Telemetry archive verification failed");
        assertThat(telemetryRepository.findById(eligible.getId())).isPresent();
    }

    private Device device(String suffix) {
        return deviceService.create(Device.builder()
                .name("Retention " + suffix + " " + UUID.randomUUID())
                .deviceId("retention-" + suffix + "-" + UUID.randomUUID())
                .type("SENSOR")
                .protocol("TEST")
                .profileId("legacy-generic-v1")
                .profileVersion(1)
                .reportedStateJson("{}")
                .desiredStateJson("{}")
                .build());
    }

    private RetentionService.CategoryCounts telemetryCounts(List<RetentionService.RetentionRunOutcome> outcomes) {
        return outcomes.stream().filter(outcome -> "TELEMETRY".equals(outcome.category()))
                .findFirst().orElseThrow().counts();
    }

    private DeviceTelemetrySample sample(Device device, Instant receivedAt, Instant observedAt) {
        Instant bucket = receivedAt.truncatedTo(ChronoUnit.MINUTES);
        return telemetryRepository.saveAndFlush(DeviceTelemetrySample.builder()
                .device(device)
                .bucketStart(timeProvider.legacyUtc(bucket))
                .bucketStartUtc(bucket)
                .sampledAt(timeProvider.legacyUtc(observedAt))
                .receivedAt(receivedAt)
                .observedAt(observedAt)
                .observedTimeTrust(ObservedTimeTrust.SKEWED)
                .source("RETENTION_TEST")
                .stateJson("{\"temperature\":22.5}")
                .build());
    }

    private DeviceTelemetrySample legacySample(Device device, Instant sampledAt) {
        Instant bucket = sampledAt.truncatedTo(ChronoUnit.MINUTES);
        return telemetryRepository.saveAndFlush(DeviceTelemetrySample.builder()
                .device(device)
                .bucketStart(timeProvider.legacyUtc(bucket))
                .sampledAt(timeProvider.legacyUtc(sampledAt))
                .source("LEGACY_TEST")
                .stateJson("{}")
                .build());
    }

    private java.util.List<ActivityEvent> retentionEventsFor(Device device) {
        return activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(device.getId()).stream()
                .filter(event -> "RETENTION_TEST".equals(event.getEventType()))
                .toList();
    }
}
