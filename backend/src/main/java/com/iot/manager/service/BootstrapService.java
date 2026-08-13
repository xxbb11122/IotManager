package com.iot.manager.service;

import com.iot.manager.entity.Organization;
import com.iot.manager.entity.Site;
import com.iot.manager.entity.Space;
import com.iot.manager.repository.OrganizationRepository;
import com.iot.manager.repository.SiteRepository;
import com.iot.manager.repository.SpaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.SQLException;

@Service
@RequiredArgsConstructor
public class BootstrapService {

    private static final String DEMO_ORGANIZATION_CODE = "demo-org";
    private static final String DEMO_SITE_CODE = "demo-site";
    private static final String OPERATIONS_PATH = "/operations";
    private static final String FIELD_PATH = "/operations/field";

    private final OrganizationRepository organizationRepository;
    private final SiteRepository siteRepository;
    private final SpaceRepository spaceRepository;
    private final PlatformTransactionManager transactionManager;

    public Space ensureDemoContext() {
        try {
            return executeInNewTransaction(this::createDemoContext);
        } catch (DataIntegrityViolationException exception) {
            if (!isUniqueConstraintViolation(exception)) {
                throw exception;
            }
            return executeInNewTransaction(() -> reloadDemoFieldSpace(exception));
        }
    }

    private Space createDemoContext() {
        Organization organization = organizationRepository.findByCode(DEMO_ORGANIZATION_CODE)
                .orElseGet(() -> organizationRepository.saveAndFlush(Organization.builder()
                        .code(DEMO_ORGANIZATION_CODE)
                        .name("Demo Organization")
                        .build()));

        Site site = siteRepository.findByOrganizationAndCode(organization, DEMO_SITE_CODE)
                .orElseGet(() -> siteRepository.saveAndFlush(Site.builder()
                        .organization(organization)
                        .code(DEMO_SITE_CODE)
                        .name("Demo Site")
                        .build()));

        Space operations = spaceRepository.findBySiteAndPath(site, OPERATIONS_PATH)
                .orElseGet(() -> spaceRepository.saveAndFlush(Space.builder()
                        .site(site)
                        .name("Operations")
                        .path(OPERATIONS_PATH)
                        .build()));

        return spaceRepository.findBySiteAndPath(site, FIELD_PATH)
                .orElseGet(() -> spaceRepository.saveAndFlush(Space.builder()
                        .site(site)
                        .parent(operations)
                        .name("Field")
                        .path(FIELD_PATH)
                        .build()));
    }

    private Space reloadDemoFieldSpace(DataIntegrityViolationException duplicateException) {
        Organization organization = organizationRepository.findByCode(DEMO_ORGANIZATION_CODE)
                .orElseThrow(() -> duplicateException);
        Site site = siteRepository.findByOrganizationAndCode(organization, DEMO_SITE_CODE)
                .orElseThrow(() -> duplicateException);
        return spaceRepository.findBySiteAndPath(site, FIELD_PATH)
                .orElseThrow(() -> duplicateException);
    }

    private Space executeInNewTransaction(SpaceSupplier operation) {
        TransactionTemplate transactionTemplate = new TransactionTemplate(transactionManager);
        transactionTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return transactionTemplate.execute(status -> operation.get());
    }

    private boolean isUniqueConstraintViolation(DataIntegrityViolationException exception) {
        Throwable cause = exception;
        while (cause != null) {
            if (cause instanceof SQLException sqlException && "23505".equals(sqlException.getSQLState())) {
                return true;
            }
            cause = cause.getCause();
        }
        return false;
    }

    @FunctionalInterface
    private interface SpaceSupplier {
        Space get();
    }
}
