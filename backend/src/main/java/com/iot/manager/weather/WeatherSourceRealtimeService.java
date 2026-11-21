package com.iot.manager.weather;

import com.iot.manager.dto.RealtimeEvent;
import com.iot.manager.dto.SiteWeatherView;
import com.iot.manager.entity.SiteWeatherSettings;
import com.iot.manager.repository.SiteWeatherSettingsRepository;
import com.iot.manager.service.TimeProvider;
import com.iot.manager.service.WebSocketService;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionOperations;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/** Reassesses existing weather, never calls a weather provider or polls devices. */
@Service
@Slf4j
public class WeatherSourceRealtimeService {
    private static final Set<String> DEVICE_EVENTS = Set.of("device_update", "device_archived", "telemetry_update", "connection_update");
    private static final int MAX_PENDING_DEVICE_IDS = 2048;
    private static final long COALESCE_MS = 100;
    private final SiteWeatherSettingsRepository settingsRepository;
    private final SiteWeatherService weatherService;
    private final WebSocketService webSocketService;
    private final TimeProvider timeProvider;
    private final TransactionOperations reads;
    private final ScheduledExecutorService worker;
    private final Map<Long, Publication> publications = new ConcurrentHashMap<>();
    private final Set<Long> pendingIds = new LinkedHashSet<>();
    // Guarded by pendingIds. Keep exactly one scheduled or in-flight drain.
    private boolean pendingSweep;
    private boolean drainScheduled;
    private boolean stopped;

    @Autowired
    public WeatherSourceRealtimeService(SiteWeatherSettingsRepository settingsRepository, SiteWeatherService weatherService,
                                        WebSocketService webSocketService, TimeProvider timeProvider,
                                        PlatformTransactionManager transactions) {
        this(settingsRepository, weatherService, webSocketService, timeProvider, readOnly(transactions),
                Executors.newSingleThreadScheduledExecutor(task -> {
                    Thread thread = new Thread(task, "weather-source-reassessment");
                    thread.setDaemon(true);
                    return thread;
                }));
    }

    WeatherSourceRealtimeService(SiteWeatherSettingsRepository settingsRepository, SiteWeatherService weatherService,
                                 WebSocketService webSocketService, TimeProvider timeProvider,
                                 TransactionOperations reads, ScheduledExecutorService worker) {
        this.settingsRepository = settingsRepository;
        this.weatherService = weatherService;
        this.webSocketService = webSocketService;
        this.timeProvider = timeProvider;
        this.reads = reads;
        this.worker = worker;
    }

    private static TransactionTemplate readOnly(PlatformTransactionManager manager) {
        var read = new TransactionTemplate(manager);
        read.setReadOnly(true);
        return read;
    }

    // AFTER_COMMIT still runs on the writer thread before its connection is
    // returned to the pool. Do not obtain a second connection on that path.
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onDeviceEvent(RealtimeEvent event) {
        if (!DEVICE_EVENTS.contains(event.type())) return;
        Set<Long> ids = new LinkedHashSet<>();
        collectIds(event.payload(), ids);
        if (ids.isEmpty()) return;
        synchronized (pendingIds) {
            if (stopped) return;
            if (!pendingSweep) {
                for (Long id : ids) {
                    pendingIds.add(id);
                    if (pendingIds.size() > MAX_PENDING_DEVICE_IDS) {
                        // Bound memory without silently losing an affected source.
                        pendingIds.clear();
                        pendingSweep = true;
                        break;
                    }
                }
            }
            scheduleDrain();
        }
    }

    private void scheduleDrain() {
        if (stopped || drainScheduled || (!pendingSweep && pendingIds.isEmpty())) return;
        try {
            worker.schedule(this::drain, COALESCE_MS, TimeUnit.MILLISECONDS);
            drainScheduled = true;
        } catch (RejectedExecutionException error) {
            log.warn("Weather-source reassessment could not be scheduled", error);
        }
    }

    private void drain() {
        final Set<Long> ids;
        final boolean sweep;
        synchronized (pendingIds) {
            if (stopped) return;
            ids = Set.copyOf(pendingIds);
            sweep = pendingSweep;
            pendingIds.clear();
            pendingSweep = false;
        }
        try {
            List<SiteWeatherView> assessments = reads.execute(status -> {
                List<SiteWeatherSettings> settings = sweep
                        ? settingsRepository.findByEnabledTrueAndCondensationTemperatureDeviceIdIsNotNull()
                        : settingsRepository.findByEnabledTrueAndCondensationTemperatureDeviceIdIn(ids);
                return settings.stream().map(setting -> weatherService.current(setting.getSite())).toList();
            });
            // Release the read connection before delivering any socket messages.
            if (assessments != null) assessments.forEach(this::publishIfChanged);
            if (publications.size() > 4096) {
                Instant cutoff = timeProvider.now().minus(Duration.ofHours(6));
                publications.entrySet().removeIf(entry -> entry.getValue().sentAt().isBefore(cutoff));
            }
        } catch (RuntimeException error) {
            log.warn("Weather-source reassessment failed; the next source event can reassess it", error);
        } finally {
            synchronized (pendingIds) {
                drainScheduled = false;
                scheduleDrain();
            }
        }
    }

    private void publishIfChanged(SiteWeatherView view) {
        Instant now = timeProvider.now();
        var indicators = view.indicators();
        String signature = view.status() + ":" + List.of(indicators.temperature(), indicators.humidity(),
                        indicators.pressure(), indicators.esdRisk(), indicators.condensationRisk()).stream()
                .map(indicator -> indicator.level() + ":" + indicator.ideal()
                        + ("UNAVAILABLE".equals(indicator.level()) ? ":" + indicator.reason() : ""))
                .collect(Collectors.joining("|")) + ":"
                + (view.assessment() == null || view.assessment().temperatureSource() == null ? "none"
                : view.assessment().temperatureSource().deviceId() + ":" + view.assessment().temperatureSource().field());
        // Publish risk transitions on the next drain; same-risk renewals remain
        // capped to once per minute, avoiding a push per measurement.
        publications.compute(view.siteId(), (id, previous) -> {
            if (previous == null || !signature.equals(previous.signature())
                    || Duration.between(previous.sentAt(), now).compareTo(Duration.ofMinutes(1)) >= 0) {
                webSocketService.sendWeatherUpdate(view);
                return new Publication(signature, now);
            }
            return previous;
        });
    }

    @PreDestroy
    void close() {
        synchronized (pendingIds) {
            stopped = true;
            pendingIds.clear();
            pendingSweep = false;
        }
        worker.shutdownNow();
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
