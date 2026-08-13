package com.iot.manager.service;

import com.iot.manager.entity.Organization;
import com.iot.manager.entity.Space;
import com.iot.manager.repository.OrganizationRepository;
import com.iot.manager.repository.SiteRepository;
import com.iot.manager.repository.SpaceRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;

import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;

@SpringBootTest
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
class BootstrapServiceConcurrencyTest {

    @Autowired
    private BootstrapService bootstrapService;

    @Autowired
    private SiteRepository siteRepository;

    @Autowired
    private SpaceRepository spaceRepository;

    @Autowired
    private EntityManager entityManager;

    @SpyBean
    private OrganizationRepository organizationRepository;

    @Test
    void ensureDemoContextReturnsOneSharedHierarchyForConcurrentFirstUse() throws Exception {
        CountDownLatch bothOrganizationLookups = new CountDownLatch(2);
        CountDownLatch releaseOrganizationCreates = new CountDownLatch(1);
        AtomicInteger organizationLookups = new AtomicInteger();
        blockInitialOrganizationLookups(bothOrganizationLookups, releaseOrganizationCreates, organizationLookups);

        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch callersReady = new CountDownLatch(2);
        CountDownLatch startCalls = new CountDownLatch(1);
        try {
            Future<Space> first = executor.submit(() -> ensureAfterStart(callersReady, startCalls));
            Future<Space> second = executor.submit(() -> ensureAfterStart(callersReady, startCalls));

            assertThat(callersReady.await(5, TimeUnit.SECONDS)).isTrue();
            startCalls.countDown();
            assertThat(bothOrganizationLookups.await(5, TimeUnit.SECONDS)).isTrue();
            releaseOrganizationCreates.countDown();

            Space firstField = first.get(5, TimeUnit.SECONDS);
            Space secondField = second.get(5, TimeUnit.SECONDS);

            assertThat(firstField.getPath()).isEqualTo("/operations/field");
            assertThat(secondField.getPath()).isEqualTo("/operations/field");
            assertThat(organizationRepository.count()).isEqualTo(1);
            assertThat(siteRepository.count()).isEqualTo(1);
            assertThat(spaceRepository.count()).isEqualTo(2);
        } finally {
            releaseOrganizationCreates.countDown();
            executor.shutdownNow();
            executor.awaitTermination(5, TimeUnit.SECONDS);
        }
    }

    private void blockInitialOrganizationLookups(
            CountDownLatch bothOrganizationLookups,
            CountDownLatch releaseOrganizationCreates,
        AtomicInteger organizationLookups
    ) {
        doAnswer(invocation -> {
            if (organizationLookups.incrementAndGet() <= 2) {
                bothOrganizationLookups.countDown();
                if (!releaseOrganizationCreates.await(5, TimeUnit.SECONDS)) {
                    throw new AssertionError("Timed out waiting to release concurrent organization creation");
                }
                return Optional.empty();
            }
            return entityManager.createQuery(
                            "select organization from Organization organization where organization.code = :code",
                            Organization.class
                    )
                    .setParameter("code", "demo-org")
                    .getResultStream()
                    .findFirst();
        }).when(organizationRepository).findByCode("demo-org");
    }

    private Space ensureAfterStart(CountDownLatch callersReady, CountDownLatch startCalls) throws InterruptedException {
        callersReady.countDown();
        if (!startCalls.await(5, TimeUnit.SECONDS)) {
            throw new AssertionError("Timed out waiting to start concurrent bootstrap calls");
        }
        return bootstrapService.ensureDemoContext();
    }
}
