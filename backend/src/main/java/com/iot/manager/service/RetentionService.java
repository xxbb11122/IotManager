package com.iot.manager.service;

import com.iot.manager.config.RetentionProperties;
import com.iot.manager.entity.ActivityEvent;
import com.iot.manager.entity.AgentCredentialRotation;
import com.iot.manager.entity.Alert;
import com.iot.manager.entity.CommandEvent;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceCommand;
import com.iot.manager.entity.DeviceTelemetrySample;
import com.iot.manager.entity.DeviceTelemetrySampleArchive;
import com.iot.manager.entity.RetentionJobRun;
import com.iot.manager.entity.RetentionWatermark;
import com.iot.manager.entity.SiteWeatherForecastPoint;
import com.iot.manager.entity.SiteWeatherSnapshot;
import com.iot.manager.entity.WeatherProviderAccessEvent;
import com.iot.manager.repository.ActivityEventRepository;
import com.iot.manager.repository.AgentCredentialRotationRepository;
import com.iot.manager.repository.AlertRepository;
import com.iot.manager.repository.CommandEventRepository;
import com.iot.manager.repository.DeviceCommandRepository;
import com.iot.manager.repository.DeviceRepository;
import com.iot.manager.repository.DeviceTelemetrySampleArchiveRepository;
import com.iot.manager.repository.DeviceTelemetrySampleRepository;
import com.iot.manager.repository.RetentionJobRunRepository;
import com.iot.manager.repository.RetentionWatermarkRepository;
import com.iot.manager.repository.ScheduledTaskLockRepository;
import com.iot.manager.repository.SiteWeatherForecastPointRepository;
import com.iot.manager.repository.SiteWeatherSnapshotRepository;
import com.iot.manager.repository.WeatherProviderAccessEventRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * R1's conservative data-lifecycle executor. It only acts on rows that carry
 * an authoritative UTC timestamp, processes bounded batches, and treats every
 * hold or uncertainty as a reason not to delete.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RetentionService {

    public static final String POLICY_VERSION = "r1-v1";
    private static final int MAX_BATCHES_PER_RUN = 20;

    private final RetentionProperties properties;
    private final TimeProvider timeProvider;
    private final ScheduledDatabaseTaskGuard scheduledDatabaseTaskGuard;
    private final RetentionTaskLockService retentionTaskLockService;
    private final RetentionHoldService retentionHoldService;
    private final RetentionJobRunRepository jobRunRepository;
    private final RetentionWatermarkRepository watermarkRepository;
    private final ScheduledTaskLockRepository scheduledTaskLockRepository;
    private final DeviceTelemetrySampleRepository telemetryRepository;
    private final DeviceTelemetrySampleArchiveRepository telemetryArchiveRepository;
    private final DeviceRepository deviceRepository;
    private final ActivityEventRepository activityEventRepository;
    private final CommandEventRepository commandEventRepository;
    private final DeviceCommandRepository commandRepository;
    private final AlertRepository alertRepository;
    private final SiteWeatherSnapshotRepository weatherSnapshotRepository;
    private final SiteWeatherForecastPointRepository weatherForecastRepository;
    private final WeatherProviderAccessEventRepository weatherAccessRepository;
    private final AgentCredentialRotationRepository credentialRotationRepository;
    private final PlatformMetricsService platformMetricsService;
    private final PlatformTransactionManager transactionManager;

    @PersistenceContext
    private EntityManager entityManager;

    @Scheduled(cron = "${iot.retention.schedule:0 30 2 * * *}", zone = "UTC")
    public void runScheduled() {
        if (!properties.isEnabled()) return;
        RetentionTaskLockService.Lease lease = retentionTaskLockService.tryAcquire("retention", properties.getLockLease());
        if (!lease.acquired()) return;
        try {
            scheduledDatabaseTaskGuard.run("retention", () -> runOnce(lease));
        } finally {
            retentionTaskLockService.release(lease);
        }
    }

    /**
     * Runs a bounded maintenance pass. Production scheduling is separately
     * gated by iot.retention.enabled; this method remains callable from tests
     * and protected operations tooling so dry-run evidence can be produced.
     */
    public List<RetentionRunOutcome> runOnce() {
        RetentionTaskLockService.Lease lease = retentionTaskLockService.tryAcquire("retention", properties.getLockLease());
        if (!lease.acquired()) throw new IllegalStateException("Retention task is already running on another replica");
        try {
            return runOnce(lease);
        } finally {
            retentionTaskLockService.release(lease);
        }
    }

    private List<RetentionRunOutcome> runOnce(RetentionTaskLockService.Lease lease) {
        properties.validateOrdering();
        Instant now = timeProvider.now();
        String passId = "retention-" + UUID.randomUUID();
        List<RetentionRunOutcome> outcomes = new ArrayList<>();
        outcomes.add(execute(passId, "TELEMETRY", now.minus(properties.getTelemetryTotal()), now,
                () -> retainTelemetry(now, lease)));
        outcomes.add(execute(passId, "ACTIVITY_EVENTS", now.minus(properties.getAudit()), now,
                () -> pruneActivityEvents(now.minus(properties.getAudit()), lease)));
        outcomes.add(execute(passId, "COMMAND_EVENTS", now.minus(properties.getCommand()), now,
                () -> pruneCommandEvents(now.minus(properties.getCommand()), lease)));
        outcomes.add(execute(passId, "COMMANDS", now.minus(properties.getCommand()), now,
                () -> pruneCommands(now.minus(properties.getCommand()), lease)));
        outcomes.add(execute(passId, "ALERTS", now.minus(properties.getAlert()), now,
                () -> pruneAlerts(now.minus(properties.getAlert()), lease)));
        outcomes.add(execute(passId, "WEATHER_SNAPSHOTS", now.minus(properties.getWeatherSnapshot()), now,
                () -> pruneWeatherSnapshots(now.minus(properties.getWeatherSnapshot()), lease)));
        outcomes.add(execute(passId, "WEATHER_FORECASTS", now.minus(properties.getWeatherForecast()), now,
                () -> pruneWeatherForecasts(now.minus(properties.getWeatherForecast()), lease)));
        outcomes.add(execute(passId, "WEATHER_PROVIDER_AUDIT", now.minus(properties.getAudit()), now,
                () -> pruneWeatherAccessEvents(now.minus(properties.getAudit()), lease)));
        outcomes.add(execute(passId, "CREDENTIAL_ROTATIONS", now.minus(properties.getCredentialRotation()), now,
                () -> pruneCredentialRotations(now.minus(properties.getCredentialRotation()), lease)));
        return outcomes;
    }

    private RetentionRunOutcome execute(
            String runId, String category, Instant windowStart, Instant windowEnd, Supplier<CategoryCounts> action
    ) {
        Instant startedAt = timeProvider.now();
        RetentionJobRun run = jobRunRepository.save(RetentionJobRun.builder()
                .runId(runId)
                .policyVersion(POLICY_VERSION)
                .dryRun(properties.isDryRun())
                .dataCategory(category)
                .status("STARTED")
                .windowStart(windowStart)
                .windowEnd(windowEnd)
                .estimatedRows(0)
                .archivedRows(0)
                .deletedRows(0)
                .heldRows(0)
                .failedRows(0)
                .correlationId(runId)
                .startedAt(startedAt)
                .build());
        try {
            CategoryCounts counts = action.get();
            Instant completedAt = timeProvider.now();
            run.setStatus(properties.isDryRun() ? "DRY_RUN" : "COMPLETED");
            run.setEstimatedRows(counts.estimated());
            run.setArchivedRows(counts.archived());
            run.setDeletedRows(counts.deleted());
            run.setHeldRows(counts.held());
            run.setFailedRows(counts.failed());
            run.setWatermark(counts.watermark());
            run.setCompletedAt(completedAt);
            jobRunRepository.save(run);
            platformMetricsService.retentionRowsArchived(category, counts.archived());
            platformMetricsService.retentionRowsDeleted(category, counts.deleted());
            platformMetricsService.retentionRowsHeld(category, counts.held());
            platformMetricsService.retentionJob(category, "success", Duration.between(startedAt, completedAt));
            return new RetentionRunOutcome(runId, category, run.getStatus(), properties.isDryRun(), counts, null);
        } catch (RuntimeException exception) {
            Instant completedAt = timeProvider.now();
            run.setStatus("FAILED");
            run.setCompletedAt(completedAt);
            run.setFailedRows(1);
            run.setFailureReason(truncate(exception.getMessage(), 2000));
            jobRunRepository.save(run);
            platformMetricsService.retentionJob(category, "failure", Duration.between(startedAt, completedAt));
            throw exception;
        }
    }

    private CategoryCounts retainTelemetry(Instant now, RetentionTaskLockService.Lease lease) {
        Instant archiveCutoff = now.minus(properties.getTelemetryTotal());
        Instant hotCutoff = now.minus(properties.getTelemetryHot());
        // Dry-run does not insert archives, but an execution can archive and
        // purge an already-overdue hot row in the same pass. Project those
        // new archive rows so its purge estimate matches the real pass.
        List<PurgeProjection> projectedArchives = new ArrayList<>();
        CategoryCounts archive = executeBatches("TELEMETRY_ARCHIVE", (cursor, holds) -> archiveTelemetryBatch(
                hotCutoff, archiveCutoff, cursor.at(), cursor.id(), now, holds, projectedArchives
        ), lease);
        CategoryCounts purge = properties.isDryRun()
                ? executeBatches("TELEMETRY_PURGE", (cursor, holds) -> previewPurgeArchivedTelemetryBatch(
                        archiveCutoff, cursor.at(), cursor.id(), holds, projectedArchives
                ), lease)
                : executeBatches("TELEMETRY_PURGE", (cursor, holds) -> purgeArchivedTelemetryBatch(
                        archiveCutoff, cursor.at(), cursor.id(), holds
                ), lease);
        return archive.plus(purge);
    }

    /**
     * The cursor survives an interrupted bounded pass only. A complete pass
     * clears it, which means an item skipped due to a temporary hold is never
     * silently excluded from all future retention evaluations.
     */
    private Cursor initialCursor(String key) {
        if (properties.isDryRun()) return Cursor.START;
        return watermarkRepository.findById(key)
                .map(watermark -> new Cursor(watermark.getCursorAt(), watermark.getCursorId()))
                .orElse(Cursor.START);
    }

    private CategoryCounts executeBatches(
            String key, RetentionBatchAction batchAction, RetentionTaskLockService.Lease lease
    ) {
        Cursor cursor = initialCursor(key);
        CategoryCounts total = CategoryCounts.empty();
        boolean complete = false;
        for (int batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
            if (!retentionTaskLockService.renew(lease, properties.getLockLease())) {
                throw new IllegalStateException("Scheduled retention lease was lost; refusing another batch");
            }
            Cursor batchCursor = cursor;
            CursorBatchResult result = inNewTransaction(() -> {
                scheduledTaskLockRepository.findForUpdate(RetentionHoldService.HOLD_GUARD_TASK)
                        .orElseThrow(() -> new IllegalStateException("Retention hold guard row is missing"));
                RetentionHoldService.ActiveHoldIndex holds = retentionHoldService.activeIndex(timeProvider.now());
                CursorBatchResult batchResult = batchAction.apply(batchCursor, holds);
                persistCursor(key, batchResult.lastAt(), batchResult.lastId());
                return batchResult;
            });
            total = total.plus(result.counts());
            if (result.lastAt() != null) {
                cursor = new Cursor(result.lastAt(), result.lastId());
            }
            if (result.fetched() < properties.getBatchSize()) {
                complete = true;
                break;
            }
        }
        if (complete) clearCursor(key);
        return total;
    }

    private void persistCursor(String key, Instant cursorAt, long cursorId) {
        if (properties.isDryRun() || cursorAt == null) return;
        watermarkRepository.save(RetentionWatermark.builder()
                .watermarkKey(key)
                .cursorAt(cursorAt)
                .cursorId(cursorId)
                .updatedAt(timeProvider.now())
                .build());
    }

    private void clearCursor(String key) {
        if (properties.isDryRun()) return;
        inNewTransaction(() -> {
            watermarkRepository.deleteById(key);
            return null;
        });
    }

    private CursorBatchResult archiveTelemetryBatch(
            Instant hotCutoff,
            Instant archiveCutoff,
            Instant cursorAt,
            long cursorId,
            Instant archivedAt,
            RetentionHoldService.ActiveHoldIndex holds,
            List<PurgeProjection> projectedArchives
    ) {
        List<DeviceTelemetrySample> candidates = telemetryRepository.findArchiveCandidatesAfter(
                hotCutoff, cursorAt, cursorId, PageRequest.of(0, properties.getBatchSize())
        );
        if (candidates.isEmpty()) return CursorBatchResult.empty();
        List<DeviceTelemetrySample> removable = new ArrayList<>();
        long held = 0;
        for (DeviceTelemetrySample sample : candidates) {
            Device device = sample.getDevice();
            if (isHeld(holds, "TELEMETRY", device, null)) {
                held++;
                continue;
            }
            removable.add(sample);
        }
        Map<Long, DeviceTelemetrySampleArchive> existingArchives = archiveBySourceIds(removable);
        // A dry-run must surface an already-corrupted replay target instead
        // of predicting that the destructive pass can safely remove it.
        List<DeviceTelemetrySample> alreadyArchived = removable.stream()
                .filter(sample -> existingArchives.containsKey(sample.getId()))
                .toList();
        verifyArchiveBatch(alreadyArchived, existingArchives);
        List<DeviceTelemetrySampleArchive> copies = new ArrayList<>();
        for (DeviceTelemetrySample sample : removable) {
            if (!existingArchives.containsKey(sample.getId())) copies.add(toArchive(sample, archivedAt));
        }
        long archived = copies.size();
        long deleted = removable.size();
        if (properties.isDryRun()) {
            // Archive IDs allocated by the real pass are newer than existing
            // archive IDs. Virtual high IDs preserve the same tie order for
            // rows sharing receivedAt without writing anything in dry-run.
            for (DeviceTelemetrySampleArchive copy : copies) {
                if (copy.getReceivedAt().isBefore(archiveCutoff)) {
                    projectedArchives.add(new PurgeProjection(copy.getReceivedAt(),
                            Long.MAX_VALUE - MAX_BATCHES_PER_RUN * 5_000L + projectedArchives.size(),
                            copy.getDeviceId()));
                }
            }
        } else {
            if (!copies.isEmpty()) telemetryArchiveRepository.saveAllAndFlush(copies);
            // Compare database-persisted values, not the managed objects that
            // may retain sub-microsecond precision lost by a TIMESTAMPTZ write.
            entityManager.flush();
            entityManager.clear();
            List<Long> sourceIds = removable.stream().map(DeviceTelemetrySample::getId).toList();
            List<DeviceTelemetrySample> persistedSources = telemetryRepository.findAllById(sourceIds);
            if (persistedSources.size() != sourceIds.size()) {
                throw new IllegalStateException("Telemetry archive batch source rows changed before verification");
            }
            verifyArchiveBatch(persistedSources, archiveBySourceIds(persistedSources));
            if (!persistedSources.isEmpty()) telemetryRepository.deleteAllInBatch(persistedSources);
        }
        DeviceTelemetrySample last = candidates.get(candidates.size() - 1);
        return new CursorBatchResult(
                candidates.size(), new CategoryCounts(candidates.size(), archived, deleted, held, 0, last.getReceivedAt()),
                last.getReceivedAt(), last.getId()
        );
    }

    private Map<Long, DeviceTelemetrySampleArchive> archiveBySourceIds(List<DeviceTelemetrySample> samples) {
        if (samples.isEmpty()) return Map.of();
        List<Long> ids = samples.stream().map(DeviceTelemetrySample::getId).toList();
        Map<Long, DeviceTelemetrySampleArchive> archives = new HashMap<>();
        telemetryArchiveRepository.findBySourceSampleIdIn(ids)
                .forEach(archive -> archives.put(archive.getSourceSampleId(), archive));
        return archives;
    }

    private void verifyArchiveBatch(
            List<DeviceTelemetrySample> sources,
            Map<Long, DeviceTelemetrySampleArchive> archives
    ) {
        if (archives.size() != sources.size()) {
            throw new IllegalStateException("Telemetry archive batch is incomplete; hot rows were retained");
        }
        for (DeviceTelemetrySample source : sources) {
            DeviceTelemetrySampleArchive archive = archives.get(source.getId());
            if (archive == null) {
                throw new IllegalStateException("Telemetry archive verification failed for source sample " + source.getId()
                        + " (archive row missing)");
            }
            if (!telemetryFingerprint(source).equals(telemetryFingerprint(archive))) {
                throw new IllegalStateException("Telemetry archive verification failed for source sample " + source.getId()
                        + " (differing fields: " + differingArchiveFields(source, archive) + ")");
            }
        }
    }

    private String differingArchiveFields(DeviceTelemetrySample source, DeviceTelemetrySampleArchive archive) {
        List<String> differences = new ArrayList<>();
        if (!Objects.equals(source.getId(), archive.getSourceSampleId())) differences.add("sourceSampleId");
        if (!Objects.equals(source.getDevice().getId(), archive.getDeviceId())) differences.add("deviceId");
        if (!Objects.equals(source.getBucketStart(), archive.getBucketStart())) differences.add("bucketStart");
        if (!Objects.equals(source.getSampledAt(), archive.getSampledAt())) differences.add("sampledAt");
        if (!Objects.equals(source.getReceivedAt(), archive.getReceivedAt())) differences.add("receivedAt");
        if (!Objects.equals(source.getObservedAt(), archive.getObservedAt())) differences.add("observedAt");
        String trust = source.getObservedTimeTrust() == null ? null : source.getObservedTimeTrust().name();
        if (!Objects.equals(trust, archive.getObservedTimeTrust())) differences.add("observedTimeTrust");
        if (!Objects.equals(source.getBucketStartUtc(), archive.getBucketStartUtc())) differences.add("bucketStartUtc");
        if (!Objects.equals(source.getSource(), archive.getSource())) differences.add("source");
        if (!Objects.equals(source.getStateJson(), archive.getStateJson())) differences.add("stateJson");
        return differences.isEmpty() ? "serialized representation" : String.join(",", differences);
    }

    private String telemetryFingerprint(DeviceTelemetrySample sample) {
        StringBuilder value = new StringBuilder();
        appendFingerprintField(value, sample.getId());
        appendFingerprintField(value, sample.getDevice().getId());
        appendFingerprintField(value, sample.getBucketStart());
        appendFingerprintField(value, sample.getSampledAt());
        appendFingerprintField(value, sample.getReceivedAt());
        appendFingerprintField(value, sample.getObservedAt());
        appendFingerprintField(value, sample.getObservedTimeTrust() == null ? null : sample.getObservedTimeTrust().name());
        appendFingerprintField(value, sample.getBucketStartUtc());
        appendFingerprintField(value, sample.getSource());
        appendFingerprintField(value, sample.getStateJson());
        return sha256(value.toString());
    }

    private String telemetryFingerprint(DeviceTelemetrySampleArchive sample) {
        StringBuilder value = new StringBuilder();
        appendFingerprintField(value, sample.getSourceSampleId());
        appendFingerprintField(value, sample.getDeviceId());
        appendFingerprintField(value, sample.getBucketStart());
        appendFingerprintField(value, sample.getSampledAt());
        appendFingerprintField(value, sample.getReceivedAt());
        appendFingerprintField(value, sample.getObservedAt());
        appendFingerprintField(value, sample.getObservedTimeTrust());
        appendFingerprintField(value, sample.getBucketStartUtc());
        appendFingerprintField(value, sample.getSource());
        appendFingerprintField(value, sample.getStateJson());
        return sha256(value.toString());
    }

    private void appendFingerprintField(StringBuilder target, Object field) {
        if (target.length() > 0) target.append('|');
        if (field == null) {
            target.append("-1:");
            return;
        }
        String text = field.toString();
        target.append(text.length()).append(':').append(text);
    }

    private String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is not available", exception);
        }
    }

    private CursorBatchResult purgeArchivedTelemetryBatch(
            Instant cutoff,
            Instant cursorAt,
            long cursorId,
            RetentionHoldService.ActiveHoldIndex holds
    ) {
        List<DeviceTelemetrySampleArchive> candidates = telemetryArchiveRepository.findPurgeCandidatesAfter(
                cutoff, cursorAt, cursorId, PageRequest.of(0, properties.getBatchSize())
        );
        if (candidates.isEmpty()) return CursorBatchResult.empty();
        List<DeviceTelemetrySampleArchive> removable = new ArrayList<>();
        long held = 0;
        for (DeviceTelemetrySampleArchive sample : candidates) {
            Device device = deviceRepository.findById(sample.getDeviceId()).orElse(null);
            if (device == null || isHeld(holds, "TELEMETRY", device, null)) {
                held++;
                continue;
            }
            removable.add(sample);
        }
        if (!properties.isDryRun() && !removable.isEmpty()) telemetryArchiveRepository.deleteAllInBatch(removable);
        DeviceTelemetrySampleArchive last = candidates.get(candidates.size() - 1);
        return new CursorBatchResult(
                candidates.size(), new CategoryCounts(candidates.size(), 0, removable.size(), held, 0, last.getReceivedAt()),
                last.getReceivedAt(), last.getId()
        );
    }

    private CursorBatchResult previewPurgeArchivedTelemetryBatch(
            Instant cutoff,
            Instant cursorAt,
            long cursorId,
            RetentionHoldService.ActiveHoldIndex holds,
            List<PurgeProjection> projectedArchives
    ) {
        int batchSize = properties.getBatchSize();
        List<PurgeProjection> candidates = new ArrayList<>();
        for (DeviceTelemetrySampleArchive archive : telemetryArchiveRepository.findPurgeCandidatesAfter(
                cutoff, cursorAt, cursorId, PageRequest.of(0, batchSize))) {
            candidates.add(new PurgeProjection(archive.getReceivedAt(), archive.getId(), archive.getDeviceId()));
        }
        int added = 0;
        for (PurgeProjection projection : projectedArchives) {
            if (projection.receivedAt().isAfter(cursorAt)
                    || (projection.receivedAt().equals(cursorAt) && projection.id() > cursorId)) {
                candidates.add(projection);
                if (++added == batchSize) break;
            }
        }
        if (candidates.isEmpty()) return CursorBatchResult.empty();
        candidates.sort(Comparator.comparing(PurgeProjection::receivedAt).thenComparingLong(PurgeProjection::id));
        if (candidates.size() > batchSize) candidates = candidates.subList(0, batchSize);
        long held = 0;
        for (PurgeProjection candidate : candidates) {
            Device device = deviceRepository.findById(candidate.deviceId()).orElse(null);
            if (device == null || isHeld(holds, "TELEMETRY", device, null)) held++;
        }
        PurgeProjection last = candidates.get(candidates.size() - 1);
        return new CursorBatchResult(candidates.size(), new CategoryCounts(
                candidates.size(), 0, candidates.size() - held, held, 0, last.receivedAt()),
                last.receivedAt(), last.id());
    }

    private CategoryCounts pruneActivityEvents(Instant cutoff, RetentionTaskLockService.Lease lease) {
        return executeBatches("ACTIVITY_EVENTS", (cursor, holds) -> pruneActivityEventsBatch(cutoff, holds, cursor), lease);
    }

    private CursorBatchResult pruneActivityEventsBatch(
            Instant cutoff, RetentionHoldService.ActiveHoldIndex holds, Cursor cursor
    ) {
        List<ActivityEvent> candidates = activityEventRepository.findRetentionCandidatesAfter(
                cutoff, cursor.at(), cursor.id(), PageRequest.of(0, properties.getBatchSize())
        );
        if (candidates.isEmpty()) return CursorBatchResult.empty();
        List<ActivityEvent> removable = new ArrayList<>();
        long held = 0;
        for (ActivityEvent event : candidates) {
            if (isHeld(holds, "ACTIVITY_EVENTS", event.getDevice(), null)) held++; else removable.add(event);
        }
        if (!properties.isDryRun() && !removable.isEmpty()) activityEventRepository.deleteAllInBatch(removable);
        ActivityEvent last = candidates.get(candidates.size() - 1);
        return new CursorBatchResult(candidates.size(), counts(candidates.size(), 0, removable.size(), held, last.getOccurredAtUtc()),
                last.getOccurredAtUtc(), last.getId());
    }

    private CategoryCounts pruneCommandEvents(Instant cutoff, RetentionTaskLockService.Lease lease) {
        return executeBatches("COMMAND_EVENTS", (cursor, holds) -> pruneCommandEventsBatch(cutoff, holds, cursor), lease);
    }

    private CursorBatchResult pruneCommandEventsBatch(
            Instant cutoff, RetentionHoldService.ActiveHoldIndex holds, Cursor cursor
    ) {
        List<CommandEvent> candidates = commandEventRepository.findRetentionCandidatesAfter(
                cutoff, cursor.at(), cursor.id(), PageRequest.of(0, properties.getBatchSize())
        );
        if (candidates.isEmpty()) return CursorBatchResult.empty();
        List<CommandEvent> removable = new ArrayList<>();
        long held = 0;
        for (CommandEvent event : candidates) {
            DeviceCommand command = event.getCommand();
            if (isHeld(holds, "COMMAND_EVENTS", command.getDevice(), command.getCommandId())) held++; else removable.add(event);
        }
        if (!properties.isDryRun() && !removable.isEmpty()) commandEventRepository.deleteAllInBatch(removable);
        CommandEvent last = candidates.get(candidates.size() - 1);
        return new CursorBatchResult(candidates.size(), counts(candidates.size(), 0, removable.size(), held, last.getOccurredAtUtc()),
                last.getOccurredAtUtc(), last.getId());
    }

    private CategoryCounts pruneCommands(Instant cutoff, RetentionTaskLockService.Lease lease) {
        return executeBatches("COMMANDS", (cursor, holds) -> pruneCommandsBatch(cutoff, holds, cursor), lease);
    }

    private CursorBatchResult pruneCommandsBatch(
            Instant cutoff, RetentionHoldService.ActiveHoldIndex holds, Cursor cursor
    ) {
        List<DeviceCommand> candidates = commandRepository.findRetentionCandidatesAfter(
                cutoff, cursor.at(), cursor.id(), PageRequest.of(0, properties.getBatchSize())
        );
        if (candidates.isEmpty()) return CursorBatchResult.empty();
        List<DeviceCommand> removable = new ArrayList<>();
        long held = 0;
        for (DeviceCommand command : candidates) {
            if (isHeld(holds, "COMMANDS", command.getDevice(), command.getCommandId())) held++; else removable.add(command);
        }
        if (!properties.isDryRun() && !removable.isEmpty()) commandRepository.deleteAllInBatch(removable);
        DeviceCommand last = candidates.get(candidates.size() - 1);
        return new CursorBatchResult(candidates.size(), counts(candidates.size(), 0, removable.size(), held, last.getCompletedAtUtc()),
                last.getCompletedAtUtc(), last.getId());
    }

    private CategoryCounts pruneAlerts(Instant cutoff, RetentionTaskLockService.Lease lease) {
        return executeBatches("ALERTS", (cursor, holds) -> pruneAlertsBatch(cutoff, holds, cursor), lease);
    }

    private CursorBatchResult pruneAlertsBatch(
            Instant cutoff, RetentionHoldService.ActiveHoldIndex holds, Cursor cursor
    ) {
        List<Alert> candidates = alertRepository.findRetentionCandidatesAfter(
                cutoff, cursor.at(), cursor.id(), PageRequest.of(0, properties.getBatchSize())
        );
        if (candidates.isEmpty()) return CursorBatchResult.empty();
        List<Alert> removable = new ArrayList<>();
        long held = 0;
        for (Alert alert : candidates) {
            boolean heldByScope = alert.getDevice() != null
                    ? isHeld(holds, "ALERTS", alert.getDevice(), null)
                    : isHeld(holds, "ALERTS", alert.getSite(), null);
            if (heldByScope) held++; else removable.add(alert);
        }
        if (!properties.isDryRun() && !removable.isEmpty()) alertRepository.deleteAllInBatch(removable);
        Alert last = candidates.get(candidates.size() - 1);
        return new CursorBatchResult(candidates.size(), counts(candidates.size(), 0, removable.size(), held, last.getResolvedAtUtc()),
                last.getResolvedAtUtc(), last.getId());
    }

    private CategoryCounts pruneWeatherSnapshots(Instant cutoff, RetentionTaskLockService.Lease lease) {
        return executeBatches("WEATHER_SNAPSHOTS", (cursor, holds) -> pruneWeatherSnapshotsBatch(cutoff, holds, cursor), lease);
    }

    private CursorBatchResult pruneWeatherSnapshotsBatch(
            Instant cutoff, RetentionHoldService.ActiveHoldIndex holds, Cursor cursor
    ) {
        List<SiteWeatherSnapshot> candidates = weatherSnapshotRepository.findRetentionCandidatesAfter(
                cutoff, cursor.at(), cursor.id(), PageRequest.of(0, properties.getBatchSize())
        );
        if (candidates.isEmpty()) return CursorBatchResult.empty();
        List<SiteWeatherSnapshot> removable = new ArrayList<>();
        Map<Long, Long> currentSnapshotBySite = new HashMap<>();
        long protectedRows = 0;
        for (SiteWeatherSnapshot snapshot : candidates) {
            Long siteId = snapshot.getSite().getId();
            long currentId = currentSnapshotBySite.computeIfAbsent(siteId,
                    id -> weatherSnapshotRepository.findTopBySiteIdOrderByFetchedAtDescIdDesc(id)
                            .map(SiteWeatherSnapshot::getId).orElse(-1L));
            boolean current = currentId == snapshot.getId();
            if (current || isHeld(holds, "WEATHER_SNAPSHOTS", snapshot.getSite(), null)) protectedRows++; else removable.add(snapshot);
        }
        if (!properties.isDryRun() && !removable.isEmpty()) weatherSnapshotRepository.deleteAllInBatch(removable);
        SiteWeatherSnapshot last = candidates.get(candidates.size() - 1);
        return new CursorBatchResult(candidates.size(), counts(candidates.size(), 0, removable.size(), protectedRows, last.getFetchedAt()),
                last.getFetchedAt(), last.getId());
    }

    private CategoryCounts pruneWeatherForecasts(Instant cutoff, RetentionTaskLockService.Lease lease) {
        return executeBatches("WEATHER_FORECASTS", (cursor, holds) -> pruneWeatherForecastsBatch(cutoff, holds, cursor), lease);
    }

    private CursorBatchResult pruneWeatherForecastsBatch(
            Instant cutoff, RetentionHoldService.ActiveHoldIndex holds, Cursor cursor
    ) {
        List<SiteWeatherForecastPoint> candidates = weatherForecastRepository.findRetentionCandidatesAfter(
                cutoff, timeProvider.now(), cursor.at(), cursor.id(), PageRequest.of(0, properties.getBatchSize())
        );
        if (candidates.isEmpty()) return CursorBatchResult.empty();
        List<SiteWeatherForecastPoint> removable = new ArrayList<>();
        long held = 0;
        for (SiteWeatherForecastPoint point : candidates) {
            if (isHeld(holds, "WEATHER_FORECASTS", point.getSite(), null)) held++; else removable.add(point);
        }
        if (!properties.isDryRun() && !removable.isEmpty()) weatherForecastRepository.deleteAllInBatch(removable);
        SiteWeatherForecastPoint last = candidates.get(candidates.size() - 1);
        return new CursorBatchResult(candidates.size(), counts(candidates.size(), 0, removable.size(), held, last.getFetchedAt()),
                last.getFetchedAt(), last.getId());
    }

    private CategoryCounts pruneWeatherAccessEvents(Instant cutoff, RetentionTaskLockService.Lease lease) {
        return executeBatches("WEATHER_PROVIDER_AUDIT", (cursor, holds) -> pruneWeatherAccessEventsBatch(cutoff, holds, cursor), lease);
    }

    private CursorBatchResult pruneWeatherAccessEventsBatch(
            Instant cutoff, RetentionHoldService.ActiveHoldIndex holds, Cursor cursor
    ) {
        List<WeatherProviderAccessEvent> candidates = weatherAccessRepository.findRetentionCandidatesAfter(
                cutoff, cursor.at(), cursor.id(), PageRequest.of(0, properties.getBatchSize())
        );
        if (candidates.isEmpty()) return CursorBatchResult.empty();
        List<WeatherProviderAccessEvent> removable = new ArrayList<>();
        long held = 0;
        for (WeatherProviderAccessEvent event : candidates) {
            if (isHeld(holds, "WEATHER_PROVIDER_AUDIT", event.getSite(), null)) held++; else removable.add(event);
        }
        if (!properties.isDryRun() && !removable.isEmpty()) weatherAccessRepository.deleteAllInBatch(removable);
        WeatherProviderAccessEvent last = candidates.get(candidates.size() - 1);
        return new CursorBatchResult(candidates.size(), counts(candidates.size(), 0, removable.size(), held, last.getOccurredAt()),
                last.getOccurredAt(), last.getId());
    }

    private CategoryCounts pruneCredentialRotations(Instant cutoff, RetentionTaskLockService.Lease lease) {
        return executeBatches("CREDENTIAL_ROTATIONS", (cursor, holds) -> pruneCredentialRotationsBatch(cutoff, holds, cursor), lease);
    }

    private CursorBatchResult pruneCredentialRotationsBatch(
            Instant cutoff, RetentionHoldService.ActiveHoldIndex holds, Cursor cursor
    ) {
        List<AgentCredentialRotation> candidates = credentialRotationRepository.findRetentionCandidatesAfter(
                cutoff, cursor.at(), cursor.id(), PageRequest.of(0, properties.getBatchSize())
        );
        if (candidates.isEmpty()) return CursorBatchResult.empty();
        List<AgentCredentialRotation> removable = new ArrayList<>();
        long held = 0;
        for (AgentCredentialRotation rotation : candidates) {
            if (isHeld(holds, "CREDENTIAL_ROTATIONS", rotation.getAgent().getSite(), null)) held++; else removable.add(rotation);
        }
        if (!properties.isDryRun() && !removable.isEmpty()) credentialRotationRepository.deleteAllInBatch(removable);
        AgentCredentialRotation last = candidates.get(candidates.size() - 1);
        return new CursorBatchResult(candidates.size(), counts(candidates.size(), 0, removable.size(), held, last.getOccurredAtUtc()),
                last.getOccurredAtUtc(), last.getId());
    }

    private DeviceTelemetrySampleArchive toArchive(DeviceTelemetrySample source, Instant archivedAt) {
        return DeviceTelemetrySampleArchive.builder()
                .sourceSampleId(source.getId())
                .deviceId(source.getDevice().getId())
                .bucketStart(source.getBucketStart())
                .sampledAt(source.getSampledAt())
                .receivedAt(source.getReceivedAt())
                .observedAt(source.getObservedAt())
                .observedTimeTrust(source.getObservedTimeTrust() == null ? null : source.getObservedTimeTrust().name())
                .bucketStartUtc(source.getBucketStartUtc())
                .source(source.getSource())
                .stateJson(source.getStateJson())
                .archivedAt(archivedAt)
                .build();
    }

    private boolean isHeld(RetentionHoldService.ActiveHoldIndex holds, String category, Device device, String commandId) {
        if (holds.blocksCategory(category) || holds.matchesCommand(commandId)) return true;
        if (device == null) return true;
        return holds.matches(RetentionHoldService.DEVICE, device.getId())
                || holds.matches(RetentionHoldService.SITE, device.getSite() == null ? null : device.getSite().getId());
    }

    private boolean isHeld(RetentionHoldService.ActiveHoldIndex holds, String category, com.iot.manager.entity.Site site, String commandId) {
        return holds.blocksCategory(category) || holds.matchesCommand(commandId)
                || site == null || holds.matches(RetentionHoldService.SITE, site.getId());
    }

    private CategoryCounts counts(long estimated, long archived, long deleted, long held, Instant watermark) {
        return new CategoryCounts(estimated, archived, deleted, held, 0, watermark);
    }

    private <T> T inNewTransaction(Supplier<T> action) {
        TransactionTemplate template = new TransactionTemplate(transactionManager);
        template.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        template.setTimeout(Math.toIntExact(properties.getBatchTimeout().toSeconds()));
        return template.execute(status -> action.get());
    }

    private String truncate(String value, int maxLength) {
        if (value == null) return null;
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }

    public record RetentionRunOutcome(
            String runId,
            String category,
            String status,
            boolean dryRun,
            CategoryCounts counts,
            String failureReason
    ) { }

    public record CategoryCounts(
            long estimated,
            long archived,
            long deleted,
            long held,
            long failed,
            Instant watermark
    ) {
        static CategoryCounts empty() { return new CategoryCounts(0, 0, 0, 0, 0, null); }

        CategoryCounts plus(CategoryCounts other) {
            Instant resultingWatermark = other.watermark == null ? watermark : other.watermark;
            return new CategoryCounts(
                    estimated + other.estimated,
                    archived + other.archived,
                    deleted + other.deleted,
                    held + other.held,
                    failed + other.failed,
                    resultingWatermark
            );
        }
    }

    @FunctionalInterface
    private interface RetentionBatchAction {
        CursorBatchResult apply(Cursor cursor, RetentionHoldService.ActiveHoldIndex holds);
    }

    /**
     * Carries the last ordered tuple seen, rather than the last row deleted.
     * This intentionally advances across temporarily held rows; once a full
     * pass completes the watermark is cleared so a later run evaluates them
     * again after the hold is released.
     */
    private record CursorBatchResult(int fetched, CategoryCounts counts, Instant lastAt, long lastId) {
        static CursorBatchResult empty() { return new CursorBatchResult(0, CategoryCounts.empty(), null, 0L); }
    }

    private record PurgeProjection(Instant receivedAt, long id, long deviceId) { }

    private record Cursor(Instant at, long id) {
        private static final Cursor START = new Cursor(Instant.EPOCH, 0L);
    }
}
