package com.iot.manager.weather;

import com.iot.manager.dto.RealtimeEvent;
import com.iot.manager.dto.SiteWeatherView;
import com.iot.manager.entity.SiteWeatherSettings;
import com.iot.manager.repository.SiteWeatherSettingsRepository;
import com.iot.manager.service.TimeProvider;
import com.iot.manager.service.WebSocketService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** Reassesses existing weather, never calls a weather provider or polls devices. */
@Service
@RequiredArgsConstructor
public class WeatherSourceRealtimeService {
    private final SiteWeatherSettingsRepository settingsRepository;
    private final SiteWeatherService weatherService;
    private final WebSocketService webSocketService;
    private final TimeProvider timeProvider;
    private final Map<Long, Publication> publications = new ConcurrentHashMap<>();

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public void onDeviceEvent(RealtimeEvent event) {
        if (!Set.of("device_update", "device_archived", "telemetry_update", "connection_update").contains(event.type())) return;
        Set<Long> ids = new LinkedHashSet<>();
        collectIds(event.payload(), ids);
        if (ids.isEmpty()) return;
        for (SiteWeatherSettings setting : settingsRepository.findByEnabledTrueAndCondensationTemperatureDeviceIdIn(ids)) {
            SiteWeatherView view = weatherService.current(setting.getSite());
            Instant now = timeProvider.now();
            var indicators = view.indicators();
            String signature = view.status() + ":" + java.util.List.of(indicators.temperature(), indicators.humidity(),
                    indicators.pressure(), indicators.esdRisk(), indicators.condensationRisk()).stream()
                    .map(indicator -> indicator.level() + ":" + indicator.ideal()
                            + ("UNAVAILABLE".equals(indicator.level()) ? ":" + indicator.reason() : ""))
                    .collect(java.util.stream.Collectors.joining("|")) + ":"
                    + (view.assessment() == null || view.assessment().temperatureSource() == null ? "none"
                    : view.assessment().temperatureSource().deviceId() + ":" + view.assessment().temperatureSource().field());
            // Risk transitions are immediate. Same-risk receipt/deadline renewals
            // are coalesced to once per minute, avoiding a push per measurement.
            publications.compute(setting.getSite().getId(), (id, previous) -> {
                if (previous == null || !signature.equals(previous.signature())
                        || Duration.between(previous.sentAt(), now).compareTo(Duration.ofMinutes(1)) >= 0) {
                    webSocketService.sendWeatherUpdate(view);
                    return new Publication(signature, now);
                }
                return previous;
            });
        }
        if (publications.size() > 4096) {
            Instant cutoff = timeProvider.now().minus(Duration.ofHours(6));
            publications.entrySet().removeIf(entry -> entry.getValue().sentAt().isBefore(cutoff));
        }
    }

    private void collectIds(Object value, Set<Long> ids) {
        if (value instanceof Collection<?> items) { items.forEach(item -> collectIds(item, ids)); return; }
        if (!(value instanceof Map<?, ?> map)) return;
        Object id = map.get("id");
        if (!(id instanceof Number)) id = map.get("databaseId");
        if (!(id instanceof Number)) id = map.get("deviceId");
        if (id instanceof Number number && number.longValue() > 0) ids.add(number.longValue());
    }

    private record Publication(String signature, Instant sentAt) { }
}
