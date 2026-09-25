package com.iot.manager.service;

import com.iot.manager.dto.RetentionHoldRequest;
import com.iot.manager.entity.DeviceTelemetrySampleArchive;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceTelemetrySample;
import com.iot.manager.entity.ObservedTimeTrust;
import com.iot.manager.repository.DeviceTelemetrySampleArchiveRepository;
import com.iot.manager.repository.DeviceTelemetrySampleRepository;
import com.iot.manager.repository.RetentionJobRunRepository;
import com.iot.manager.repository.RetentionWatermarkRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Instant;
import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Exercises the destructive archive path against the actual production
 * database engine. Docker-less developer machines skip this guard; protected
 * Docker-capable CI is expected to execute it.
 */
@SpringBootTest(properties = {
        "iot.retention.enabled=false",
        "iot.retention.dry-run=false",
        "iot.retention.batch-size=10"
})
@ActiveProfiles("test")
@Testcontainers(disabledWithoutDocker = true)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RetentionServicePostgresIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("iot_manager_retention_test")
            .withUsername("iot_manager")
            .withPassword("test-only-password");

    @DynamicPropertySource
    static void configurePostgres(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.flyway.locations", () -> "classpath:db/migration,classpath:db/migration-postgresql");
    }

    @Autowired
    private RetentionService retentionService;

    @Autowired
    private DeviceService deviceService;

    @Autowired
    private DeviceTelemetrySampleRepository telemetryRepository;

    @Autowired
    private DeviceTelemetrySampleArchiveRepository archiveRepository;

    @Autowired
    private RetentionHoldService retentionHoldService;

    @Autowired
    private RetentionTaskLockService retentionTaskLockService;

    @Autowired
    private RetentionWatermarkRepository watermarkRepository;

    @Autowired
    private RetentionJobRunRepository jobRunRepository;

    @Autowired
    private com.iot.manager.config.RetentionProperties retentionProperties;

    @Autowired
    private TimeProvider timeProvider;

    @Test
    void postgresRetentionProvesDryRunLockHoldCursorIdempotencyAndFailClosedChecksum() {
        Device dryRunDevice = device("pg-dry-run");
        Instant receivedAt = timeProvider.now().minus(120, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MINUTES);
        DeviceTelemetrySample validSample = sample(dryRunDevice, receivedAt, "{\"temperature\":22.5}");
        Device overdueDevice = device("pg-overdue");
        DeviceTelemetrySample overdueSample = sample(overdueDevice,
                timeProvider.now().minus(400, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MINUTES),
                "{\"temperature\":18.5}");
        retentionProperties.setDryRun(true);
        RetentionService.RetentionRunOutcome prediction = retentionService.runOnce().stream()
                .filter(outcome -> "TELEMETRY".equals(outcome.category()))
                .findFirst().orElseThrow();
        assertThat(telemetryRepository.findById(validSample.getId())).isPresent();
        assertThat(telemetryRepository.findById(overdueSample.getId())).isPresent();
        assertThat(archivesFor(dryRunDevice)).isEmpty();
        assertThat(archivesFor(overdueDevice)).isEmpty();

        retentionProperties.setDryRun(false);
        RetentionTaskLockService.Lease lease = retentionTaskLockService.tryAcquire("retention", Duration.ofMinutes(5));
        assertThat(lease.acquired()).isTrue();
        assertThatThrownBy(retentionService::runOnce)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("already running");
        retentionTaskLockService.release(lease);

        RetentionService.RetentionRunOutcome execution = retentionService.runOnce().stream()
                .filter(outcome -> "TELEMETRY".equals(outcome.category()))
                .findFirst().orElseThrow();
        assertThat(prediction.counts().archived()).isEqualTo(execution.counts().archived());
        assertThat(prediction.counts().deleted()).isEqualTo(execution.counts().deleted());
        assertThat(telemetryRepository.findById(validSample.getId())).isEmpty();
        assertThat(telemetryRepository.findById(overdueSample.getId())).isEmpty();
        assertThat(archivesFor(dryRunDevice)).singleElement().satisfies(archive -> {
            assertThat(archive.getSourceSampleId()).isEqualTo(validSample.getId());
            assertThat(archive.getStateJson()).isEqualTo(validSample.getStateJson());
        });
        assertThat(archivesFor(overdueDevice)).isEmpty();
        retentionService.runOnce();
        assertThat(archivesFor(dryRunDevice)).hasSize(1);

        Device heldDevice = device("pg-held");
        DeviceTelemetrySample heldSample = sample(heldDevice,
                timeProvider.now().minus(122, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MINUTES), "{\"temperature\":19}");
        retentionHoldService.create(new RetentionHoldRequest(
                RetentionHoldService.DEVICE, String.valueOf(heldDevice.getId()), null, "PostgreSQL retention hold test"
        ));
        retentionService.runOnce();
        assertThat(telemetryRepository.findById(heldSample.getId())).isPresent();
        assertThat(archivesFor(heldDevice)).isEmpty();

        retentionProperties.setBatchSize(1);
        Device cursorDevice = device("pg-cursor");
        Instant first = timeProvider.now().minus(150, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MINUTES);
        for (int index = 0; index < 22; index++) {
            sample(cursorDevice, first.plus(index, ChronoUnit.MINUTES), "{\"sample\":" + index + "}");
        }
        retentionService.runOnce();
        assertThat(archivesFor(cursorDevice)).hasSize(20);
        assertThat(hotSamplesFor(cursorDevice)).hasSize(2);
        assertThat(watermarkRepository.findById("TELEMETRY_ARCHIVE")).isPresent();
        retentionService.runOnce();
        assertThat(archivesFor(cursorDevice)).hasSize(22);
        assertThat(hotSamplesFor(cursorDevice)).isEmpty();
        assertThat(watermarkRepository.findById("TELEMETRY_ARCHIVE")).isEmpty();

        Device tamperedDevice = device("pg-tampered");
        Instant tamperedAt = timeProvider.now().minus(121, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MINUTES);
        DeviceTelemetrySample tamperedSample = sample(tamperedDevice, tamperedAt, "{\"humidity\":45}");
        archiveRepository.saveAndFlush(DeviceTelemetrySampleArchive.builder()
                .sourceSampleId(tamperedSample.getId())
                .deviceId(tamperedDevice.getId())
                .bucketStart(tamperedSample.getBucketStart())
                .sampledAt(tamperedSample.getSampledAt())
                .receivedAt(tamperedSample.getReceivedAt())
                .observedAt(tamperedSample.getObservedAt())
                .observedTimeTrust(tamperedSample.getObservedTimeTrust().name())
                .bucketStartUtc(tamperedSample.getBucketStartUtc())
                .source(tamperedSample.getSource())
                .stateJson("{\"tampered\":true}")
                .archivedAt(timeProvider.now())
                .build());

        assertThatThrownBy(retentionService::runOnce)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Telemetry archive verification failed");
        assertThat(telemetryRepository.findById(tamperedSample.getId()))
                .as("a checksum mismatch must never delete the PostgreSQL hot row")
                .isPresent();
        assertThat(jobRunRepository.findTop50ByDataCategoryOrderByStartedAtDesc("TELEMETRY"))
                .first()
                .satisfies(run -> assertThat(run.getStatus()).isEqualTo("FAILED"));
    }

    private Device device(String prefix) {
        return deviceService.create(Device.builder()
                .name("Retention PostgreSQL " + UUID.randomUUID())
                .deviceId(prefix + "-" + UUID.randomUUID())
                .type("SENSOR")
                .protocol("TEST")
                .profileId("legacy-generic-v1")
                .profileVersion(1)
                .reportedStateJson("{}")
                .desiredStateJson("{}")
                .build());
    }

    private DeviceTelemetrySample sample(Device device, Instant receivedAt, String stateJson) {
        Instant observedAt = receivedAt.plus(2, ChronoUnit.MINUTES);
        Instant bucket = receivedAt.truncatedTo(ChronoUnit.MINUTES);
        return telemetryRepository.saveAndFlush(DeviceTelemetrySample.builder()
                .device(device)
                .bucketStart(timeProvider.legacyUtc(bucket))
                .bucketStartUtc(bucket)
                .sampledAt(timeProvider.legacyUtc(observedAt))
                .receivedAt(receivedAt)
                .observedAt(observedAt)
                .observedTimeTrust(ObservedTimeTrust.SKEWED)
                .source("RETENTION_POSTGRES_TEST")
                .stateJson(stateJson)
                .build());
    }

    private List<DeviceTelemetrySampleArchive> archivesFor(Device device) {
        return archiveRepository.findAll().stream()
                .filter(archive -> archive.getDeviceId().equals(device.getId()))
                .toList();
    }

    private List<DeviceTelemetrySample> hotSamplesFor(Device device) {
        return telemetryRepository.findAll().stream()
                .filter(sample -> sample.getDevice().getId().equals(device.getId()))
                .toList();
    }
}
