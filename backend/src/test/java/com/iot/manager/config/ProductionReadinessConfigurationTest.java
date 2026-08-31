package com.iot.manager.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.core.io.ClassPathResource;

import static org.assertj.core.api.Assertions.assertThat;

/** Guards the deployment contract that removes traffic when PostgreSQL is unavailable. */
class ProductionReadinessConfigurationTest {

    @Test
    void productionReadinessIncludesTheDatabaseHealthContributor() {
        YamlPropertiesFactoryBean yaml = new YamlPropertiesFactoryBean();
        yaml.setResources(new ClassPathResource("application-prod.yml"));
        yaml.afterPropertiesSet();

        assertThat(yaml.getObject())
                .containsEntry("management.endpoint.health.group.readiness.include", "readinessState,db")
                .containsEntry("spring.flyway.connect-retries", "${IOT_FLYWAY_CONNECT_RETRIES:24}")
                .containsEntry("spring.flyway.connect-retries-interval", "${IOT_FLYWAY_CONNECT_RETRIES_INTERVAL:5s}");
    }
}
