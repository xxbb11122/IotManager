package com.iot.manager.service;

import com.iot.manager.entity.ScheduledTaskLock;
import com.iot.manager.repository.ScheduledTaskLockRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * A database lease prevents two Backend replicas from running the same
 * destructive maintenance pass. The database row lock is held only while the
 * lease is acquired/released; a bounded lease protects the actual work and
 * naturally expires if a process is lost.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RetentionTaskLockService {

    private final ScheduledTaskLockRepository repository;
    private final PlatformTransactionManager transactionManager;
    private final TimeProvider timeProvider;

    public Lease tryAcquire(String taskName, Duration leaseDuration) {
        if (leaseDuration == null || leaseDuration.isZero() || leaseDuration.isNegative()) {
            throw new IllegalArgumentException("Retention task lock lease must be positive");
        }
        String holderId = "retention-" + UUID.randomUUID();
        try {
            return acquire(taskName, holderId, leaseDuration);
        } catch (DataIntegrityViolationException firstCreationRace) {
            // Two fresh replicas can both observe no row. Let the primary-key
            // constraint select the winner, then lock the newly created row.
            return acquire(taskName, holderId, leaseDuration);
        }
    }

    public void release(Lease lease) {
        if (lease == null || !lease.acquired()) return;
        inNewTransaction(() -> {
            repository.findForUpdate(lease.taskName()).ifPresent(taskLock -> {
                if (lease.holderId().equals(taskLock.getHolderId())) {
                    Instant now = timeProvider.now();
                    taskLock.setHolderId(null);
                    taskLock.setLeaseUntil(now);
                    taskLock.setUpdatedAt(now);
                    repository.save(taskLock);
                }
            });
            return null;
        });
    }

    public boolean renew(Lease lease, Duration leaseDuration) {
        if (lease == null || !lease.acquired() || leaseDuration == null
                || leaseDuration.isZero() || leaseDuration.isNegative()) return false;
        return inNewTransaction(() -> {
            ScheduledTaskLock taskLock = repository.findForUpdate(lease.taskName()).orElse(null);
            Instant now = timeProvider.now();
            if (taskLock == null || !lease.holderId().equals(taskLock.getHolderId())
                    || !taskLock.getLeaseUntil().isAfter(now)) return false;
            taskLock.setLeaseUntil(now.plus(leaseDuration));
            taskLock.setUpdatedAt(now);
            repository.save(taskLock);
            return true;
        });
    }

    private Lease acquire(String taskName, String holderId, Duration leaseDuration) {
        return inNewTransaction(() -> {
            Instant now = timeProvider.now();
            ScheduledTaskLock taskLock = repository.findForUpdate(taskName).orElse(null);
            if (taskLock == null) {
                taskLock = ScheduledTaskLock.builder()
                        .taskName(taskName)
                        .leaseUntil(Instant.EPOCH)
                        .updatedAt(now)
                        .build();
                repository.saveAndFlush(taskLock);
            }
            if (taskLock.getLeaseUntil().isAfter(now) && taskLock.getHolderId() != null) {
                log.info("Scheduled retention task {} is already owned until {}; this replica will skip the pass.",
                        taskName, taskLock.getLeaseUntil());
                return Lease.notAcquired(taskName);
            }
            taskLock.setHolderId(holderId);
            taskLock.setLeaseUntil(now.plus(leaseDuration));
            taskLock.setUpdatedAt(now);
            repository.save(taskLock);
            return Lease.acquired(taskName, holderId);
        });
    }

    private <T> T inNewTransaction(Supplier<T> action) {
        TransactionTemplate template = new TransactionTemplate(transactionManager);
        template.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        template.setTimeout(10);
        return template.execute(status -> action.get());
    }

    public record Lease(String taskName, String holderId, boolean acquired) {
        static Lease acquired(String taskName, String holderId) {
            return new Lease(taskName, holderId, true);
        }

        static Lease notAcquired(String taskName) {
            return new Lease(taskName, null, false);
        }
    }
}
