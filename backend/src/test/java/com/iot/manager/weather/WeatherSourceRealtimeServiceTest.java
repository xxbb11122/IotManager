package com.iot.manager.weather;

import com.iot.manager.dto.EnvironmentIndicatorsView;
import com.iot.manager.dto.RealtimeEvent;
import com.iot.manager.dto.SiteWeatherView;
import com.iot.manager.dto.WeatherAssessmentView;
import com.iot.manager.entity.Site;
import com.iot.manager.entity.SiteWeatherSettings;
import com.iot.manager.repository.SiteWeatherSettingsRepository;
import com.iot.manager.service.TimeProvider;
import com.iot.manager.service.WebSocketService;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionOperations;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.stream.LongStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

class WeatherSourceRealtimeServiceTest {
    @Test
    void batchesCommittedEventsAndCoalescesSameRiskWithoutDelayingTransitionUntilRenewal() {
        var settings = mock(SiteWeatherSettingsRepository.class);
        var weather = mock(SiteWeatherService.class);
        var socket = mock(WebSocketService.class);
        var time = mock(TimeProvider.class);
        var queue = new ManualWorker();
        var service = new WeatherSourceRealtimeService(settings, weather, socket, time,
                TransactionOperations.withoutTransaction(), queue.executor);
        var site = Site.builder().id(7L).code("test-site").build();
        when(settings.findByEnabledTrueAndCondensationTemperatureDeviceIdIn(Set.of(8L)))
                .thenReturn(List.of(SiteWeatherSettings.builder().site(site).enabled(true).build()));
        Instant now = Instant.parse("2026-11-17T00:00:00Z");
        when(time.now()).thenReturn(now);
        var suitable = view("SUITABLE", "温差 5", now);
        when(weather.current(site)).thenReturn(suitable);
        var event = new RealtimeEvent("telemetry_update", List.of(Map.of("id", 8L)), 1L, 1);
        service.onDeviceEvent(event);
        service.onDeviceEvent(event);
        verifyNoInteractions(settings, weather, socket);
        queue.drain();
        verify(settings).findByEnabledTrueAndCondensationTemperatureDeviceIdIn(Set.of(8L));
        verify(socket).sendWeatherUpdate(suitable);
        // Changing numeric explanations alone must not create a push per sample.
        when(weather.current(site)).thenReturn(view("SUITABLE", "温差 6", now));
        service.onDeviceEvent(event);
        queue.drain();
        verify(socket, times(1)).sendWeatherUpdate(any());
        var risky = view("RISK", "过低", now);
        when(weather.current(site)).thenReturn(risky);
        service.onDeviceEvent(event);
        queue.drain();
        verify(socket).sendWeatherUpdate(risky);
        when(time.now()).thenReturn(now.plusSeconds(60));
        service.onDeviceEvent(event);
        queue.drain();
        verify(socket, times(3)).sendWeatherUpdate(any());
        service.onDeviceEvent(new RealtimeEvent("weather_update", risky, 1L, 1));
        verifyNoMoreInteractions(socket);
    }

    @Test
    void unrelatedDevicesAndNonDeviceEventsNeverReadWeatherOrCallAProvider() {
        var settings = mock(SiteWeatherSettingsRepository.class);
        var weather = mock(SiteWeatherService.class);
        var socket = mock(WebSocketService.class);
        var time = mock(TimeProvider.class);
        var queue = new ManualWorker();
        var service = new WeatherSourceRealtimeService(settings, weather, socket, time,
                TransactionOperations.withoutTransaction(), queue.executor);
        when(settings.findByEnabledTrueAndCondensationTemperatureDeviceIdIn(Set.of(99L))).thenReturn(List.of());
        service.onDeviceEvent(new RealtimeEvent("device_update", Map.of("id", 99L), 1L, 1));
        service.onDeviceEvent(new RealtimeEvent("alert", Map.of("id", 8L), 1L, 1));
        service.onDeviceEvent(new RealtimeEvent("device_update", Map.of("id", "not-a-database-id"), 1L, 1));
        queue.drain();
        verify(settings).findByEnabledTrueAndCondensationTemperatureDeviceIdIn(Set.of(99L));
        verifyNoMoreInteractions(settings);
        verifyNoInteractions(weather, socket, time);
    }

    @Test
    void overloadBatchesIntoOneConfiguredSourceSweepInsteadOfGrowingOrDroppingWork() {
        var settings = mock(SiteWeatherSettingsRepository.class);
        var weather = mock(SiteWeatherService.class);
        var socket = mock(WebSocketService.class);
        var time = mock(TimeProvider.class);
        var queue = new ManualWorker();
        var service = new WeatherSourceRealtimeService(settings, weather, socket, time,
                TransactionOperations.withoutTransaction(), queue.executor);
        var site = Site.builder().id(7L).code("test-site").build();
        var archivedSource = SiteWeatherSettings.builder().site(site).enabled(true).build();
        var now = Instant.parse("2026-11-17T00:00:00Z");
        var assessed = view("UNAVAILABLE", "来源已归档", now);
        when(time.now()).thenReturn(now);
        when(weather.current(site)).thenReturn(assessed);
        when(settings.findByEnabledTrueAndCondensationTemperatureDeviceIdIsNotNull()).thenReturn(List.of(archivedSource));
        LongStream.rangeClosed(1, 4096).forEach(id ->
                service.onDeviceEvent(new RealtimeEvent("device_archived", Map.of("id", id), 1L, 1)));
        verifyNoInteractions(settings);
        queue.drain();
        verify(settings).findByEnabledTrueAndCondensationTemperatureDeviceIdIsNotNull();
        verifyNoMoreInteractions(settings);
        verify(socket).sendWeatherUpdate(assessed);
        service.close();
        service.onDeviceEvent(new RealtimeEvent("device_archived", Map.of("id", 8L), 1L, 1));
        assertEquals(0, queue.pending.size());
        verify(queue.executor).shutdownNow();
    }

    private static final class ManualWorker {
        private final Deque<Runnable> pending = new ArrayDeque<>();
        private final ScheduledExecutorService executor = mock(ScheduledExecutorService.class);

        private ManualWorker() {
            when(executor.schedule(any(Runnable.class), anyLong(), eq(TimeUnit.MILLISECONDS)))
                    .thenAnswer(invocation -> { pending.add(invocation.getArgument(0)); return null; });
        }

        private void drain() {
            assertEquals(1, pending.size());
            pending.remove().run();
        }
    }

    private SiteWeatherView view(String level, String reason, Instant now) {
        var indicator = new EnvironmentIndicator(level, "test", true, reason);
        return new SiteWeatherView("test-site", 7L, "FRESH", "OPEN_METEO", now, now, null, null, null,
                new EnvironmentIndicatorsView(indicator, indicator, indicator, indicator, indicator),
                new WeatherAssessmentView(now, now.plusSeconds(21600),
                        new WeatherAssessmentView.TemperatureSource(8L, "sensor-8", "temperature", now, now.plusSeconds(300))));
    }
}
