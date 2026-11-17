package com.iot.manager.weather;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import com.iot.manager.dto.CurrentWeatherView;
import com.iot.manager.dto.EnvironmentIndicatorsView;
import com.iot.manager.dto.SiteWeatherForecastView;
import com.iot.manager.dto.SiteWeatherLocationRequest;
import com.iot.manager.dto.SiteWeatherSettingsRequest;
import com.iot.manager.dto.SiteWeatherSettingsView;
import com.iot.manager.dto.SiteWeatherView;
import com.iot.manager.dto.WeatherForecastPointView;
import com.iot.manager.dto.WeatherAssessmentView;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceProfile;
import com.iot.manager.entity.DeviceTelemetrySample;
import com.iot.manager.entity.ObservedTimeTrust;
import com.iot.manager.entity.Site;
import com.iot.manager.entity.SiteWeatherForecastPoint;
import com.iot.manager.entity.SiteWeatherSettings;
import com.iot.manager.entity.SiteWeatherSnapshot;
import com.iot.manager.entity.WeatherProviderAccessEvent;
import com.iot.manager.repository.DeviceRepository;
import com.iot.manager.repository.DeviceProfileRepository;
import com.iot.manager.repository.DeviceTelemetrySampleRepository;
import com.iot.manager.repository.SiteRepository;
import com.iot.manager.repository.SiteWeatherForecastPointRepository;
import com.iot.manager.repository.SiteWeatherSettingsRepository;
import com.iot.manager.repository.SiteWeatherSnapshotRepository;
import com.iot.manager.repository.WeatherProviderAccessEventRepository;
import com.iot.manager.service.WebSocketService;
import com.iot.manager.service.PlatformMetricsService;
import com.iot.manager.service.TimeProvider;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

@Service
@RequiredArgsConstructor
public class SiteWeatherService {

    private static final Duration FRESH_FOR = Duration.ofMinutes(45);
    private static final Duration STALE_FOR = Duration.ofHours(6);
    private static final Duration MANUAL_REFRESH_COOLDOWN = Duration.ofSeconds(60);
    private static final Duration RETRY_DELAY = Duration.ofSeconds(30);
    private static final Duration SURFACE_TEMPERATURE_MAX_AGE = Duration.ofMinutes(5);
    private static final double LOCATION_CHANGE_THRESHOLD_METERS = 500D;

    private final SiteRepository siteRepository;
    private final DeviceRepository deviceRepository;
    private final DeviceProfileRepository deviceProfileRepository;
    private final DeviceTelemetrySampleRepository telemetrySampleRepository;
    private final SiteWeatherSettingsRepository settingsRepository;
    private final SiteWeatherSnapshotRepository snapshotRepository;
    private final SiteWeatherForecastPointRepository forecastRepository;
    private final WeatherProviderAccessEventRepository weatherProviderAccessEventRepository;
    private final List<WeatherProvider> providers;
    private final WeatherCodeMapper weatherCodeMapper;
    private final EnvironmentStatusEvaluator environmentStatusEvaluator;
    private final WebSocketService webSocketService;
    private final PlatformMetricsService platformMetricsService;
    private final TimeProvider timeProvider;
    private final ObjectMapper objectMapper;
    private final WeatherPrivacyProperties weatherPrivacyProperties;
    private final Set<Long> refreshingSiteIds = ConcurrentHashMap.newKeySet();

    @Transactional(readOnly = true)
    public SiteWeatherView current(String siteCode) {
        return current(site(siteCode));
    }

    @Transactional(readOnly = true)
    public SiteWeatherView current(Site site) {
        SiteWeatherSettings setting = settingsRepository.findBySiteId(site.getId()).orElse(null);
        return buildCurrent(site, setting, latestSnapshot(site, setting));
    }

    @Transactional(readOnly = true)
    public SiteWeatherForecastView forecast(String siteCode, int hours, int days) {
        return forecast(site(siteCode), hours, days);
    }

    @Transactional(readOnly = true)
    public SiteWeatherForecastView forecast(Site site, int hours, int days) {
        SiteWeatherSettings setting = settingsRepository.findBySiteId(site.getId()).orElse(null);
        String configurationFingerprint = configurationFingerprint(setting);
        SiteWeatherSnapshot snapshot = latestSnapshot(site, setting);
        String status = status(setting, snapshot);
        int hourlyLimit = Math.max(0, Math.min(hours, 24));
        int dailyLimit = Math.max(0, Math.min(days, 7));
        return new SiteWeatherForecastView(
                site.getCode(), status, snapshot == null ? null : snapshot.getFetchedAt(),
                configurationFingerprint == null ? List.of() : forecastRepository
                        .findBySiteIdAndConfigurationFingerprintAndForecastKindOrderByForecastAtAsc(
                                site.getId(), configurationFingerprint, SiteWeatherForecastPoint.Kind.HOURLY
                        )
                        .stream().limit(hourlyLimit).map(this::hourlyView).toList(),
                configurationFingerprint == null ? List.of() : forecastRepository
                        .findBySiteIdAndConfigurationFingerprintAndForecastKindOrderByForecastAtAsc(
                                site.getId(), configurationFingerprint, SiteWeatherForecastPoint.Kind.DAILY
                        )
                        .stream().limit(dailyLimit).map(this::dailyView).toList()
        );
    }

    @Transactional(readOnly = true)
    public SiteWeatherSettingsView settings(String siteCode) {
        return settings(site(siteCode));
    }

    @Transactional(readOnly = true)
    public SiteWeatherSettingsView settings(Site site) {
        SiteWeatherSettings setting = settingsRepository.findBySiteId(site.getId()).orElse(null);
        return settingsView(site, setting, latestSnapshot(site, setting));
    }

    @Transactional
    public SiteWeatherSettingsView updateSettings(String siteCode, @Valid SiteWeatherSettingsRequest request) {
        return updateSettings(site(siteCode), request);
    }

    @Transactional
    public SiteWeatherSettingsView updateSettings(Site site, @Valid SiteWeatherSettingsRequest request) {
        validateCoordinates(request.latitude(), request.longitude());
        validateTimezone(request.timezone());
        String providerCode = blankToNull(request.providerCode());
        if (providerCode != null && provider(providerCode) == null) {
            throw new IllegalArgumentException("Unsupported weather provider");
        }
        // Resolve and authorize before mutating managed settings. Never bind a
        // globally addressable device ID from another site to this site's weather.
        Device temperatureDevice = null;
        String temperatureField = blankToNull(request.condensationTemperatureField());
        if (request.condensationTemperatureDeviceId() != null) {
            temperatureDevice = deviceRepository.findById(request.condensationTemperatureDeviceId())
                    .filter(device -> belongsToSite(device, site))
                    .orElseThrow(() -> new NoSuchElementException("Condensation temperature device not found"));
            temperatureField = temperatureField == null ? "temperature" : temperatureField;
            if (!supportsTemperatureField(temperatureDevice, temperatureField)) {
                throw new IllegalArgumentException("Condensation source must be a Celsius temperature telemetry field");
            }
        } else {
            temperatureField = null;
        }
        SiteWeatherSettings setting = settingsRepository.findBySiteId(site.getId())
                .orElseGet(() -> SiteWeatherSettings.builder().site(site).enabled(true).providerCode("OPEN_METEO").build());
        String previousConfigurationFingerprint = configurationFingerprint(setting);
        boolean coordinatesChanged = !Objects.equals(setting.getLatitude(), request.latitude())
                || !Objects.equals(setting.getLongitude(), request.longitude());
        setting.setEnabled(request.enabled() == null ? setting.isEnabled() : request.enabled());
        setting.setProviderCode(providerCode == null ? setting.getProviderCode() : providerCode);
        setting.setLatitude(request.latitude());
        setting.setLongitude(request.longitude());
        setting.setTimezone(blankToNull(request.timezone()));
        setting.setManualElevationM(request.manualElevationM());
        if (coordinatesChanged && request.latitude() != null && request.longitude() != null) {
            setting.setLocationSource("MANUAL");
            setting.setLocationAccuracyM(null);
            setting.setLocationUpdatedAt(timeProvider.now());
        }
        setting.setCondensationTemperatureField(temperatureField);
        setting.setCondensationTemperatureDevice(temperatureDevice);
        SiteWeatherSettings saved = settingsRepository.save(setting);
        if (!Objects.equals(previousConfigurationFingerprint, configurationFingerprint(saved))) {
            // Forecast points have no diagnostic value after their location/provider changes.
            // Snapshots stay intact for history but are filtered by their configuration fingerprint.
            forecastRepository.deleteBySiteId(site.getId());
        }
        return settingsView(site, saved, latestSnapshot(site, saved));
    }

    /**
     * Stores an explicit location selection from the client and immediately
     * refreshes the site weather. This intentionally does not start GPS
     * tracking or retain a device identifier; it only persists the chosen
     * location as the site's weather source.
     */
    @Transactional
    public SiteWeatherView updateLocationAndRefresh(String siteCode, @Valid SiteWeatherLocationRequest request) {
        return updateLocationAndRefresh(site(siteCode), request);
    }

    @Transactional
    public SiteWeatherView updateLocationAndRefresh(Site site, @Valid SiteWeatherLocationRequest request) {
        validateCoordinates(request.latitude(), request.longitude());
        validateTimezone(request.timezone());
        SiteWeatherSettings setting = settingsRepository.findBySiteId(site.getId())
                .orElseGet(() -> SiteWeatherSettings.builder().site(site).enabled(true).providerCode("OPEN_METEO").build());
        String previousConfigurationFingerprint = configurationFingerprint(setting);
        boolean materialLocationChange = hasMaterialLocationChange(setting, request.latitude(), request.longitude());
        boolean timezoneChanged = !Objects.equals(normalizeTimezone(setting.getTimezone()), normalizeTimezone(request.timezone()));
        boolean needsInitialWeather = latestSnapshot(site, setting) == null;
        setting.setEnabled(true);
        if (blankToNull(setting.getProviderCode()) == null) {
            setting.setProviderCode("OPEN_METEO");
        }
        if (materialLocationChange || timezoneChanged) {
            setting.setLatitude(request.latitude());
            setting.setLongitude(request.longitude());
            setting.setTimezone(blankToNull(request.timezone()));
            // Elevation is returned by the weather grid for new coordinates.
            // A previous manual override must not leak into a mobile location update.
            setting.setManualElevationM(null);
        }
        setting.setLocationSource(request.source().toUpperCase(Locale.ROOT));
        setting.setLocationAccuracyM("MOBILE_GPS".equalsIgnoreCase(request.source()) ? request.accuracyM() : null);
        setting.setLocationUpdatedAt(timeProvider.now());
        SiteWeatherSettings saved = settingsRepository.save(setting);
        boolean configurationChanged = !Objects.equals(previousConfigurationFingerprint, configurationFingerprint(saved));
        if (configurationChanged) {
            forecastRepository.deleteBySiteId(site.getId());
        }
        // Saving the location must not be rolled back if Open-Meteo is briefly
        // unavailable. A weather refresh is therefore performed only after the
        // independent repository save has completed.
        if (!materialLocationChange && !timezoneChanged && !needsInitialWeather) {
            return current(site);
        }
        return refreshSiteSafely(site, true);
    }

    @Transactional
    public SiteWeatherView refresh(String siteCode) {
        return refresh(site(siteCode));
    }

    @Transactional
    public SiteWeatherView refresh(Site site) {
        SiteWeatherSettings setting = settingsRepository.findBySiteId(site.getId())
                .orElseThrow(() -> new IllegalArgumentException("Weather is not configured for this site"));
        Instant now = timeProvider.now();
        if (setting.getLastManualRefreshAt() != null
                && Duration.between(setting.getLastManualRefreshAt(), now).compareTo(MANUAL_REFRESH_COOLDOWN) < 0) {
            long remainingSeconds = Math.max(1, MANUAL_REFRESH_COOLDOWN.minus(Duration.between(setting.getLastManualRefreshAt(), now)).toSeconds());
            throw new WeatherRefreshRateLimitedException(remainingSeconds);
        }
        setting.setLastManualRefreshAt(now);
        settingsRepository.save(setting);
        return refreshSiteSafely(site, true);
    }

    @Transactional
    public SiteWeatherView refreshSiteById(Long siteId) {
        Site site = siteRepository.findById(siteId).orElseThrow(() -> new NoSuchElementException("Site not found"));
        return refreshSiteSafely(site, true);
    }

    @Transactional
    public SiteWeatherView retrySiteById(Long siteId) {
        Site site = siteRepository.findById(siteId).orElseThrow(() -> new NoSuchElementException("Site not found"));
        return refreshSiteSafely(site, false);
    }

    @Transactional(readOnly = true)
    public List<Long> enabledSiteIds() {
        return settingsRepository.findByEnabledTrue().stream().map(setting -> setting.getSite().getId()).toList();
    }

    @Transactional(readOnly = true)
    public List<Long> retryDueSiteIds() {
        return settingsRepository.findByEnabledTrueAndRetryAfterLessThanEqual(timeProvider.now())
                .stream().map(setting -> setting.getSite().getId()).toList();
    }

    private SiteWeatherView refreshSiteSafely(Site site, boolean resetRetryBudget) {
        if (resetRetryBudget) {
            settingsRepository.findBySiteId(site.getId()).ifPresent(setting -> {
                setting.setWeatherRetryCount(0);
                setting.setRetryAfter(null);
                settingsRepository.save(setting);
            });
        }
        long startedAtNanos = System.nanoTime();
        try {
            SiteWeatherView view = refreshSite(site);
            recordRefreshOutcome(site, "SUCCESS", elapsedMillis(startedAtNanos));
            platformMetricsService.weatherRefresh(view.source(), "success");
            return view;
        } catch (WeatherRefreshInProgressException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            return recordRefreshFailure(site, exception, elapsedMillis(startedAtNanos));
        }
    }

    private SiteWeatherView refreshSite(Site site) {
        if (!refreshingSiteIds.add(site.getId())) {
            throw new WeatherRefreshInProgressException();
        }
        try {
            SiteWeatherSettings setting = settingsRepository.findBySiteId(site.getId())
                    .orElseThrow(() -> new IllegalArgumentException("Weather is not configured for this site"));
            if (!setting.isEnabled()) throw new IllegalArgumentException("Weather is disabled for this site");
            if (setting.getLatitude() == null || setting.getLongitude() == null) {
                throw new IllegalArgumentException("Weather coordinates are required");
            }
            WeatherProvider provider = provider(setting.getProviderCode());
            if (provider == null) throw new IllegalArgumentException("Unsupported weather provider");
            setting.setLastRefreshAttemptAt(timeProvider.now());
            settingsRepository.save(setting);
            Instant providerRequestedAt = timeProvider.now();
            long providerStartedAtNanos = System.nanoTime();
            WeatherPayload payload;
            try {
                payload = provider.fetch(setting);
                auditProviderAccess(site, setting, provider.getClass().getSimpleName(), providerRequestedAt,
                        "SUCCESS", elapsedMillis(providerStartedAtNanos), null);
            } catch (RuntimeException exception) {
                auditProviderAccess(site, setting, provider.getClass().getSimpleName(), providerRequestedAt,
                        "FAILURE", elapsedMillis(providerStartedAtNanos), providerErrorCode(exception));
                throw exception;
            }
            String configurationFingerprint = configurationFingerprint(setting);
            Instant fetchedAt = timeProvider.now();
            WeatherCondition condition = weatherCodeMapper.map(payload.current().weatherCode());
            SiteWeatherSnapshot snapshot = snapshotRepository.save(SiteWeatherSnapshot.builder()
                    .site(site)
                    .providerCode(payload.providerCode())
                    .observedAt(payload.observedAt())
                    .fetchedAt(fetchedAt)
                    .configurationFingerprint(configurationFingerprint)
                    .weatherCode(payload.current().weatherCode())
                    .conditionText(condition.text())
                    .temperatureC(payload.current().temperatureC())
                    .apparentTemperatureC(payload.current().apparentTemperatureC())
                    .relativeHumidityPct(payload.current().relativeHumidityPct())
                    .surfacePressureHpa(payload.current().surfacePressureHpa())
                    .windSpeedKmh(payload.current().windSpeedKmh())
                    .windDirectionDeg(payload.current().windDirectionDeg())
                    .elevationM(setting.getManualElevationM() != null ? setting.getManualElevationM() : payload.elevationM())
                    .rawPayloadJson(sanitizedRawPayload(payload.rawPayloadJson()))
                    .build());
            forecastRepository.deleteBySiteId(site.getId());
            List<SiteWeatherForecastPoint> points = new ArrayList<>();
            payload.hourly().forEach(point -> points.add(SiteWeatherForecastPoint.builder()
                    .site(site).forecastKind(SiteWeatherForecastPoint.Kind.HOURLY).forecastAt(point.forecastAt())
                    .weatherCode(point.weatherCode()).temperatureC(point.temperatureC())
                    .precipitationProbabilityPct(point.precipitationProbabilityPct()).windSpeedKmh(point.windSpeedKmh())
                    .fetchedAt(fetchedAt).configurationFingerprint(configurationFingerprint).build()));
            payload.daily().forEach(point -> points.add(SiteWeatherForecastPoint.builder()
                    .site(site).forecastKind(SiteWeatherForecastPoint.Kind.DAILY).forecastAt(point.forecastAt())
                    .weatherCode(point.weatherCode()).temperatureMaxC(point.temperatureMaxC()).temperatureMinC(point.temperatureMinC())
                    .precipitationProbabilityPct(point.precipitationProbabilityPct()).windSpeedKmh(point.windSpeedKmh())
                    .fetchedAt(fetchedAt).configurationFingerprint(configurationFingerprint).build()));
            forecastRepository.saveAll(points);
            setting.setLastRefreshError(null);
            setting.setRetryAfter(null);
            setting.setWeatherRetryCount(0);
            settingsRepository.save(setting);
            SiteWeatherView view = buildCurrent(site, setting, snapshot);
            webSocketService.sendWeatherUpdate(view);
            return view;
        } finally {
            refreshingSiteIds.remove(site.getId());
        }
    }

    private SiteWeatherView recordRefreshFailure(Site site, RuntimeException exception, long durationMillis) {
        SiteWeatherSettings setting = settingsRepository.findBySiteId(site.getId()).orElse(null);
        platformMetricsService.weatherRefresh(setting == null ? null : setting.getProviderCode(), "failure");
        if (setting == null) {
            return new SiteWeatherView(site.getCode(), site.getId(), "UNAVAILABLE", null, null, null,
                    "天气配置不存在。", null, null, unavailableIndicators("UNAVAILABLE"));
        }
        Instant attemptedAt = timeProvider.now();
        setting.setLastRefreshAttemptAt(attemptedAt);
        setting.setLastRefreshError(refreshErrorMessage(exception));
        setting.setLastRefreshOutcome("FAILURE");
        setting.setLastRefreshDurationMs(durationMillis);
        if (setting.getWeatherRetryCount() < 1) {
            setting.setWeatherRetryCount(setting.getWeatherRetryCount() + 1);
            setting.setRetryAfter(attemptedAt.plus(RETRY_DELAY));
        } else {
            setting.setRetryAfter(null);
        }
        SiteWeatherSettings saved = settingsRepository.save(setting);
        return buildCurrent(site, saved, latestSnapshot(site, saved));
    }

    private void recordRefreshOutcome(Site site, String outcome, long durationMillis) {
        settingsRepository.findBySiteId(site.getId()).ifPresent(setting -> {
            setting.setLastRefreshOutcome(outcome);
            setting.setLastRefreshDurationMs(durationMillis);
            settingsRepository.save(setting);
        });
    }

    private long elapsedMillis(long startedAtNanos) {
        return Math.max(0L, java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAtNanos));
    }

    private void auditProviderAccess(
            Site site,
            SiteWeatherSettings setting,
            String providerCode,
            Instant requestedAt,
            String outcome,
            long durationMillis,
            String errorCode
    ) {
        weatherProviderAccessEventRepository.save(WeatherProviderAccessEvent.builder()
                .site(site)
                .providerCode(blankToNull(setting.getProviderCode()) == null ? providerCode : setting.getProviderCode())
                .purpose("WEATHER_REFRESH")
                .outcome(outcome)
                .coordinatePrecision("COARSENED".equalsIgnoreCase(setting.getLocationSource()) ? "COARSE" : "EXACT")
                .occurredAt(requestedAt)
                .durationMs(durationMillis)
                .errorCode(errorCode)
                .build());
    }

    private String providerErrorCode(RuntimeException exception) {
        if (exception instanceof WeatherProviderException) return "PROVIDER_ERROR";
        if (exception instanceof IllegalArgumentException) return "INVALID_CONFIGURATION";
        return "UNEXPECTED_ERROR";
    }

    /** Removes exact-coordinate fields before retaining a provider diagnostic payload. */
    private String sanitizedRawPayload(String rawPayload) {
        if (rawPayload == null || rawPayload.isBlank()) return null;
        try {
            JsonNode root = objectMapper.readTree(rawPayload);
            if (!(root instanceof ObjectNode object)) return null;
            object.remove("latitude");
            object.remove("longitude");
            return objectMapper.writeValueAsString(object);
        } catch (Exception ignored) {
            // Diagnostics must never make a successful weather refresh fail.
            return null;
        }
    }

    private SiteWeatherView buildCurrent(Site site, SiteWeatherSettings setting, SiteWeatherSnapshot snapshot) {
        String weatherStatus = status(setting, snapshot);
        if (snapshot == null) {
            return new SiteWeatherView(site.getCode(), site.getId(), weatherStatus, null, null, null,
                    setting == null ? null : setting.getLastRefreshError(), setting == null ? null : setting.getRetryAfter(), null,
                    unavailableIndicators(weatherStatus));
        }
        WeatherCondition condition = weatherCodeMapper.map(snapshot.getWeatherCode());
        SurfaceReading surface = surfaceTemperature(site, setting);
        boolean condensationConfigured = setting != null && setting.getCondensationTemperatureDevice() != null;
        EnvironmentIndicatorsView indicators = environmentStatusEvaluator.evaluate(
                snapshot.getTemperatureC(), snapshot.getRelativeHumidityPct(), snapshot.getSurfacePressureHpa(),
                surface.value(), condensationConfigured
        );
        if ("EXPIRED".equals(weatherStatus) || "UNAVAILABLE".equals(weatherStatus)) {
            indicators = unavailableIndicators(weatherStatus);
        } else if (condensationConfigured && surface.unavailableReason() != null) {
            indicators = new EnvironmentIndicatorsView(indicators.temperature(), indicators.humidity(),
                    indicators.pressure(), indicators.esdRisk(), EnvironmentIndicator.unavailable("不可用",
                    surface.unavailableReason() == null ? "天气数据已过期或停用" : surface.unavailableReason()));
        }
        return new SiteWeatherView(
                site.getCode(), site.getId(), weatherStatus, snapshot.getProviderCode(), snapshot.getObservedAt(), snapshot.getFetchedAt(),
                setting == null ? null : setting.getLastRefreshError(), setting == null ? null : setting.getRetryAfter(),
                new CurrentWeatherView(
                        condition.code(), snapshot.getConditionText(), condition.iconKey(), snapshot.getTemperatureC(),
                        snapshot.getApparentTemperatureC(), snapshot.getRelativeHumidityPct(), snapshot.getSurfacePressureHpa(),
                        snapshot.getWindSpeedKmh(), snapshot.getWindDirectionDeg(), snapshot.getElevationM(),
                        setting != null && setting.getManualElevationM() != null ? "MANUAL"
                                : snapshot.getElevationM() == null ? "UNKNOWN" : "PROVIDER"
                ),
                indicators,
                new WeatherAssessmentView(timeProvider.now(), snapshot.getFetchedAt() == null ? null
                        : snapshot.getFetchedAt().plus(STALE_FOR), surface.source())
        );
    }

    private EnvironmentIndicatorsView unavailableIndicators(String weatherStatus) {
        String reason = switch (weatherStatus) {
            case "PENDING" -> "站点天气已配置，等待首次成功同步";
            case "UNAVAILABLE" -> "天气未配置或当前已停用";
            default -> "天气数据已过期";
        };
        return new EnvironmentIndicatorsView(
                EnvironmentIndicator.unavailable("不可用", reason), EnvironmentIndicator.unavailable("不可用", reason),
                EnvironmentIndicator.unavailable("不可用", reason), EnvironmentIndicator.unavailable("不可用", reason),
                EnvironmentIndicator.unavailable("不可用", reason)
        );
    }

    private SiteWeatherSettingsView settingsView(Site site, SiteWeatherSettings setting, SiteWeatherSnapshot snapshot) {
        if (setting == null) {
            return new SiteWeatherSettingsView(site.getCode(), false, "OPEN_METEO", null, null, null, null,
                    null, null, null, null, null, snapshot == null ? null : snapshot.getFetchedAt(),
                    null, null, null, null, null, null);
        }
        return new SiteWeatherSettingsView(
                site.getCode(), setting.isEnabled(), setting.getProviderCode(), setting.getLatitude(), setting.getLongitude(),
                setting.getTimezone(), setting.getManualElevationM(), setting.getLocationSource(), setting.getLocationAccuracyM(),
                setting.getLocationUpdatedAt(),
                belongsToSite(setting.getCondensationTemperatureDevice(), site)
                        ? setting.getCondensationTemperatureDevice().getId() : null,
                belongsToSite(setting.getCondensationTemperatureDevice(), site)
                        ? setting.getCondensationTemperatureField() : null,
                snapshot == null ? null : snapshot.getFetchedAt(),
                setting.getLastRefreshAttemptAt(), setting.getLastRefreshError(), setting.getLastRefreshOutcome(),
                setting.getLastRefreshDurationMs(), setting.getRetryAfter(),
                setting.getLastManualRefreshAt()
        );
    }

    private WeatherForecastPointView hourlyView(SiteWeatherForecastPoint point) {
        WeatherCondition condition = weatherCodeMapper.map(point.getWeatherCode());
        return new WeatherForecastPointView(point.getForecastAt(), condition.code(), condition.text(), condition.iconKey(),
                point.getTemperatureC(), null, null, point.getPrecipitationProbabilityPct(), point.getWindSpeedKmh());
    }

    private WeatherForecastPointView dailyView(SiteWeatherForecastPoint point) {
        WeatherCondition condition = weatherCodeMapper.map(point.getWeatherCode());
        return new WeatherForecastPointView(point.getForecastAt(), condition.code(), condition.text(), condition.iconKey(),
                null, point.getTemperatureMaxC(), point.getTemperatureMinC(), point.getPrecipitationProbabilityPct(), point.getWindSpeedKmh());
    }

    private boolean belongsToSite(Device device, Site site) {
        return device != null && device.getArchivedAt() == null && device.getSite() != null
                && site.getId() != null && site.getId().equals(device.getSite().getId());
    }

    private boolean supportsTemperatureField(Device device, String field) {
        String profileId = blankToNull(device.getProfileId());
        Integer version = device.getProfileVersion();
        DeviceProfile profile = deviceProfileRepository.findByProfileIdAndProfileVersion(
                profileId == null ? "legacy-generic-v1" : profileId,
                version == null || version < 1 ? 1 : version).filter(DeviceProfile::isEnabled).orElse(null);
        if (profile == null) return false;
        try {
            for (JsonNode telemetry : objectMapper.readTree(profile.getDefinitionJson()).path("telemetry")) {
                String unit = telemetry.path("unit").asText();
                if (field.equals(telemetry.path("id").asText())
                        && "number".equals(telemetry.path("type").asText())
                        && ("C".equals(unit) || "°C".equals(unit))) return true;
            }
        } catch (tools.jackson.core.JacksonException ignored) {
            // An invalid/retired profile is not a usable temperature source.
        }
        return false;
    }

    private SurfaceReading surfaceTemperature(Site site, SiteWeatherSettings setting) {
        if (setting == null || setting.getCondensationTemperatureDevice() == null) return new SurfaceReading(null, null);
        Device device = setting.getCondensationTemperatureDevice();
        // Recheck persisted associations too: devices may have moved or been archived.
        if (!belongsToSite(device, site)) return new SurfaceReading(null, "温度来源不属于当前站点或已归档");
        String field = blankToNull(setting.getCondensationTemperatureField());
        field = field == null ? "temperature" : field;
        if (!supportsTemperatureField(device, field)) return new SurfaceReading(null, "温度来源不再支持摄氏温度遥测");
        if (!"ONLINE".equals(device.getStatus()) && !"WARNING".equals(device.getStatus())) {
            return new SurfaceReading(null, "温度来源设备不在线");
        }
        DeviceTelemetrySample sample = telemetrySampleRepository
                .findTopByDeviceIdAndReceivedAtIsNotNullOrderByReceivedAtDesc(device.getId()).orElse(null);
        if (sample == null || sample.getReceivedAt() == null) return new SurfaceReading(null, "缺少带接收时间的温度遥测");
        Duration age = Duration.between(sample.getReceivedAt(), timeProvider.now());
        if (age.isNegative() || age.compareTo(SURFACE_TEMPERATURE_MAX_AGE) > 0) {
            return new SurfaceReading(null, "温度遥测已过期（超过 5 分钟）或接收时间异常");
        }
        ObservedTimeTrust trust = sample.getObservedTimeTrust();
        // UNKNOWN is legitimate only when the source omitted its clock; the
        // server's received_at remains authoritative. Never revive legacy time.
        if (trust == null || trust == ObservedTimeTrust.SKEWED || trust == ObservedTimeTrust.LEGACY_UNKNOWN
                || (trust == ObservedTimeTrust.UNKNOWN && sample.getObservedAt() != null)
                || (sample.getObservedAt() != null && sample.getObservedAt().isAfter(timeProvider.now()))) {
            return new SurfaceReading(null, "温度遥测来源时间不可信");
        }
        Double value = fieldValue(sample, field);
        return value == null ? new SurfaceReading(null, "温度遥测字段缺失或不是有效数值")
                : new SurfaceReading(value, null, new WeatherAssessmentView.TemperatureSource(
                        device.getId(), device.getDeviceId(), field, sample.getReceivedAt(),
                        sample.getReceivedAt().plus(SURFACE_TEMPERATURE_MAX_AGE)));
    }

    private record SurfaceReading(Double value, String unavailableReason, WeatherAssessmentView.TemperatureSource source) {
        private SurfaceReading(Double value, String unavailableReason) { this(value, unavailableReason, null); }
    }

    private Double fieldValue(DeviceTelemetrySample sample, String field) {
        try {
            JsonNode node = objectMapper.readTree(sample.getStateJson()).path(field);
            return node.isNumber() && Double.isFinite(node.asDouble()) ? node.asDouble() : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private String status(SiteWeatherSettings setting, SiteWeatherSnapshot snapshot) {
        if (setting == null || !setting.isEnabled() || setting.getLatitude() == null || setting.getLongitude() == null) {
            return "UNAVAILABLE";
        }
        if (snapshot == null) return "PENDING";
        Duration age = Duration.between(snapshot.getFetchedAt(), timeProvider.now());
        if (age.compareTo(FRESH_FOR) <= 0) return "FRESH";
        if (age.compareTo(STALE_FOR) <= 0) return "STALE";
        return "EXPIRED";
    }

    private SiteWeatherSnapshot latestSnapshot(Site site, SiteWeatherSettings setting) {
        String configurationFingerprint = configurationFingerprint(setting);
        if (configurationFingerprint == null) return null;
        return snapshotRepository.findTopBySiteIdAndConfigurationFingerprintOrderByFetchedAtDesc(
                site.getId(), configurationFingerprint
        ).orElse(null);
    }

    private String configurationFingerprint(SiteWeatherSettings setting) {
        if (setting == null || setting.getLatitude() == null || setting.getLongitude() == null) return null;
        String providerCode = blankToNull(setting.getProviderCode());
        String timezone = blankToNull(setting.getTimezone());
        String configuration = String.join("|",
                providerCode == null ? "OPEN_METEO" : providerCode.toUpperCase(Locale.ROOT),
                Double.toString(setting.getLatitude()),
                Double.toString(setting.getLongitude()),
                timezone == null ? "UTC" : ZoneId.of(timezone).getId()
        );
        String secret = blankToNull(weatherPrivacyProperties.getFingerprintSecret());
        if (secret == null) {
            throw new IllegalStateException("Weather privacy fingerprint secret must be configured");
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return "v2:" + Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(mac.doFinal(configuration.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Unable to protect weather configuration fingerprint", exception);
        }
    }

    private boolean hasMaterialLocationChange(SiteWeatherSettings setting, double latitude, double longitude) {
        if (setting.getLatitude() == null || setting.getLongitude() == null) return true;
        return haversineMeters(setting.getLatitude(), setting.getLongitude(), latitude, longitude)
                > LOCATION_CHANGE_THRESHOLD_METERS;
    }

    private double haversineMeters(double latitudeA, double longitudeA, double latitudeB, double longitudeB) {
        double latitudeDelta = Math.toRadians(latitudeB - latitudeA);
        double longitudeDelta = Math.toRadians(longitudeB - longitudeA);
        double sinLatitude = Math.sin(latitudeDelta / 2D);
        double sinLongitude = Math.sin(longitudeDelta / 2D);
        double arc = sinLatitude * sinLatitude
                + Math.cos(Math.toRadians(latitudeA)) * Math.cos(Math.toRadians(latitudeB)) * sinLongitude * sinLongitude;
        return 6_371_000D * 2D * Math.atan2(Math.sqrt(arc), Math.sqrt(1D - arc));
    }

    private String normalizeTimezone(String timezone) {
        String candidate = blankToNull(timezone);
        return candidate == null ? "UTC" : ZoneId.of(candidate).getId();
    }

    private String refreshErrorMessage(RuntimeException exception) {
        if (exception instanceof WeatherProviderException) {
            return "天气服务暂时不可用，已保留当前位置并将在 30 秒后自动重试一次。";
        }
        if (exception instanceof IllegalArgumentException) {
            return "天气位置或配置无效，请检查经纬度和时区。";
        }
        return "天气同步暂时失败，已保留当前位置和最近一次有效天气。";
    }

    private Site site(String siteCode) {
        return siteRepository.findFirstByCode(siteCode).orElseThrow(() -> new NoSuchElementException("Site not found"));
    }

    private WeatherProvider provider(String providerCode) {
        return providers.stream().filter(provider -> provider.supports(providerCode)).findFirst().orElse(null);
    }

    private void validateCoordinates(Double latitude, Double longitude) {
        if ((latitude == null) != (longitude == null)) {
            throw new IllegalArgumentException("Latitude and longitude must be set together");
        }
    }

    private void validateTimezone(String timezone) {
        if (timezone == null || timezone.isBlank()) return;
        try {
            ZoneId.of(timezone);
        } catch (Exception exception) {
            throw new IllegalArgumentException("Invalid timezone");
        }
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
