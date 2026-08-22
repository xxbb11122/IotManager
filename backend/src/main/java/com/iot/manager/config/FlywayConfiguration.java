package com.iot.manager.config;

import org.springframework.boot.autoconfigure.flyway.FlywayConfigurationCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class FlywayConfiguration {

    @Bean
    FlywayConfigurationCustomizer postgresRandomUuidCompatibilityCallback() {
        return configuration -> configuration.callbacks(new PostgresRandomUuidCompatibilityCallback());
    }
}
