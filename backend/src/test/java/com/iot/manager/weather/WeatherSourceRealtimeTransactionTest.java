package com.iot.manager.weather;

import com.iot.manager.dto.EnvironmentIndicatorsView;
import com.iot.manager.dto.RealtimeEvent;
import com.iot.manager.dto.SiteWeatherView;
import com.iot.manager.entity.Site;
import com.iot.manager.entity.SiteWeatherSettings;
import com.iot.manager.repository.SiteWeatherSettingsRepository;
import com.iot.manager.service.TimeProvider;
import com.iot.manager.service.WebSocketService;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringJUnitConfig(WeatherSourceRealtimeTransactionTest.Config.class)
class WeatherSourceRealtimeTransactionTest {
    @Autowired private PlatformTransactionManager transactions;
    @Autowired private ApplicationEventPublisher events;
    @Autowired private HikariDataSource dataSource;
    @Autowired private SiteWeatherSettingsRepository settings;
    @Autowired private SiteWeatherService weather;
    @Autowired private WebSocketService socket;
    @Autowired private TimeProvider time;

    @Test
    void archiveCommitCanReassessAndPublishEvenWithOnlyOneConnection() throws InterruptedException {
        var jdbc = new JdbcTemplate(dataSource);
        var completed = new CountDownLatch(1);
        var reader = new AtomicReference<Thread>();
        var readOnly = new AtomicBoolean();
        var publishedWithTransaction = new AtomicBoolean(true);
        var site = Site.builder().id(7L).code("test-site").build();
        var binding = SiteWeatherSettings.builder().site(site).enabled(true).build();
        var now = Instant.parse("2026-11-19T00:00:00Z");
        var unknown = EnvironmentIndicator.unavailable("不可用", "温度来源已归档");
        var view = new SiteWeatherView(site.getCode(), site.getId(), "FRESH", "OPEN_METEO",
                now, now, null, null, null, new EnvironmentIndicatorsView(unknown, unknown, unknown, unknown, unknown));
        when(time.now()).thenReturn(now);
        when(settings.findByEnabledTrueAndCondensationTemperatureDeviceIdIn(Set.of(8L))).thenAnswer(invocation -> {
            reader.set(Thread.currentThread());
            readOnly.set(TransactionSynchronizationManager.isActualTransactionActive()
                    && TransactionSynchronizationManager.isCurrentTransactionReadOnly());
            assertEquals(Integer.valueOf(1), jdbc.queryForObject("SELECT 1", Integer.class));
            return List.of(binding);
        });
        when(weather.current(site)).thenReturn(view);
        doAnswer(invocation -> {
            publishedWithTransaction.set(TransactionSynchronizationManager.isActualTransactionActive());
            completed.countDown();
            return null;
        }).when(socket).sendWeatherUpdate(view);

        var writer = Thread.currentThread();
        var transaction = new TransactionTemplate(transactions);
        transaction.executeWithoutResult(status -> {
            assertEquals(Integer.valueOf(1), jdbc.queryForObject("SELECT 1", Integer.class));
            assertEquals(1, dataSource.getHikariPoolMXBean().getActiveConnections());
            events.publishEvent(new RealtimeEvent("device_archived", Map.of("id", 8L), 1L, RealtimeEvent.VERSION));
            verifyNoInteractions(settings);
        });

        assertTrue(completed.await(5, TimeUnit.SECONDS), "The committed event must be delivered without requesting a second writer connection");
        assertNotSame(writer, reader.get());
        assertTrue(readOnly.get());
        assertFalse(publishedWithTransaction.get());
    }

    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement
    @Import(WeatherSourceRealtimeService.class)
    static class Config {
        @Bean(destroyMethod = "close")
        HikariDataSource dataSource() {
            var config = new HikariConfig();
            config.setJdbcUrl("jdbc:h2:mem:weather-after-commit");
            config.setMaximumPoolSize(1);
            config.setMinimumIdle(1);
            config.setConnectionTimeout(500);
            return new HikariDataSource(config);
        }

        @Bean PlatformTransactionManager transactionManager(HikariDataSource source) {
            return new DataSourceTransactionManager(source);
        }

        @Bean SiteWeatherSettingsRepository settings() { return mock(SiteWeatherSettingsRepository.class); }
        @Bean SiteWeatherService weather() { return mock(SiteWeatherService.class); }
        @Bean WebSocketService socket() { return mock(WebSocketService.class); }
        @Bean TimeProvider time() { return mock(TimeProvider.class); }
    }
}
