package com.iot.manager.service;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/** The maintenance lease is database-backed, not a JVM-local mutex. */
@SpringBootTest
@ActiveProfiles("test")
class RetentionTaskLockServiceIntegrationTest {

    @Autowired
    private RetentionTaskLockService lockService;

    @Test
    void onlyOneHolderCanOwnAnActiveRetentionLease() {
        RetentionTaskLockService.Lease first = lockService.tryAcquire("retention-lock-test", Duration.ofMinutes(5));
        RetentionTaskLockService.Lease second = lockService.tryAcquire("retention-lock-test", Duration.ofMinutes(5));

        assertThat(first.acquired()).isTrue();
        assertThat(second.acquired()).isFalse();

        lockService.release(first);
        RetentionTaskLockService.Lease third = lockService.tryAcquire("retention-lock-test", Duration.ofMinutes(5));
        assertThat(third.acquired()).isTrue();
        lockService.release(third);
    }
}
