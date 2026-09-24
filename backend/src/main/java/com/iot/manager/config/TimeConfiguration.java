package com.iot.manager.config;

import com.iot.manager.service.TimeProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.auditing.DateTimeProvider;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

import java.time.Clock;
import java.util.Optional;

/**
 * Provides the single authoritative clock for platform decisions.  Tests may
 * replace this bean with {@link Clock#fixed(java.time.Instant, java.time.ZoneId)}.
 */
@Configuration
@EnableJpaAuditing(dateTimeProviderRef = "legacyDateTimeProvider")
public class TimeConfiguration {

    @Bean
    @ConditionalOnMissingBean(Clock.class)
    Clock applicationClock() {
        return Clock.systemUTC();
    }

    @Bean
    DateTimeProvider legacyDateTimeProvider(TimeProvider timeProvider) {
        return () -> Optional.of(timeProvider.legacyServerNow());
    }
}
