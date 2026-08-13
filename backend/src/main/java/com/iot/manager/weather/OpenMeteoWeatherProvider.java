package com.iot.manager.weather;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.entity.SiteWeatherSettings;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

@Component
public class OpenMeteoWeatherProvider implements WeatherProvider {

    private static final String CURRENT = "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m";
    private static final String HOURLY = "temperature_2m,relative_humidity_2m,weather_code,precipitation_probability,wind_speed_10m";
    private static final String DAILY = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max";

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private final String baseUrl;
    private final Duration requestTimeout;

    public OpenMeteoWeatherProvider(
            ObjectMapper objectMapper,
            @Value("${iot.weather.open-meteo.base-url:https://api.open-meteo.com/v1/forecast}") String baseUrl,
            @Value("${iot.weather.open-meteo.timeout-seconds:10}") long timeoutSeconds
    ) {
        this.objectMapper = objectMapper;
        this.baseUrl = baseUrl;
        this.requestTimeout = Duration.ofSeconds(Math.max(1, timeoutSeconds));
        this.httpClient = HttpClient.newBuilder().connectTimeout(this.requestTimeout).build();
    }

    @Override
    public boolean supports(String providerCode) {
        return "OPEN_METEO".equalsIgnoreCase(providerCode);
    }

    @Override
    public WeatherPayload fetch(SiteWeatherSettings settings) {
        if (settings.getLatitude() == null || settings.getLongitude() == null) {
            throw new IllegalArgumentException("Weather coordinates are required");
        }
        ZoneId zone = zone(settings.getTimezone());
        String url = baseUrl + "?latitude=" + settings.getLatitude()
                + "&longitude=" + settings.getLongitude()
                + "&current=" + encode(CURRENT)
                + "&hourly=" + encode(HOURLY)
                + "&daily=" + encode(DAILY)
                + "&timezone=" + encode(zone.getId())
                + "&forecast_days=7&timeformat=unixtime";
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(requestTimeout)
                    .header("Accept", "application/json")
                    .GET()
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new WeatherProviderException("Weather provider returned HTTP " + response.statusCode());
            }
            JsonNode root = objectMapper.readTree(response.body());
            if (root == null || !root.isObject()) {
                throw new WeatherProviderException("Weather provider returned an invalid response body");
            }
            JsonNode current = root.path("current");
            if (!current.isObject()) {
                throw new WeatherProviderException("Weather provider response is missing current weather");
            }
            Instant observedAt = requiredInstant(current.path("time"), zone, "current.time");
            WeatherPayload.Current currentData = new WeatherPayload.Current(
                    requiredInteger(current, "weather_code"), requiredNumber(current, "temperature_2m"),
                    number(current, "apparent_temperature"), integer(current, "relative_humidity_2m"),
                    requiredNumber(current, "surface_pressure"), number(current, "wind_speed_10m"),
                    integer(current, "wind_direction_10m")
            );
            if (currentData.relativeHumidityPct() == null) {
                throw new WeatherProviderException("Weather provider response is missing current.relative_humidity_2m");
            }
            List<WeatherPayload.Hourly> hourly = hourly(root.path("hourly"), zone, observedAt);
            List<WeatherPayload.Daily> daily = daily(root.path("daily"), zone);
            if (!hasCompleteForecast(hourly, daily)) {
                throw new WeatherProviderException("Weather provider response does not contain a complete 24-hour and 7-day forecast");
            }
            return new WeatherPayload(
                    "OPEN_METEO", observedAt, number(root, "elevation"), currentData,
                    hourly, daily, response.body()
            );
        } catch (IOException exception) {
            throw new WeatherProviderException("Weather provider response could not be read", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new WeatherProviderException("Weather provider request interrupted", exception);
        }
    }

    private List<WeatherPayload.Hourly> hourly(JsonNode node, ZoneId zone, Instant observedAt) {
        List<WeatherPayload.Hourly> result = new ArrayList<>();
        JsonNode times = node.path("time");
        Instant currentHour = observedAt.truncatedTo(ChronoUnit.HOURS);
        for (int index = 0; index < times.size() && result.size() < 24; index++) {
            Instant forecastAt = instant(times.path(index), zone, null);
            if (forecastAt == null || forecastAt.isBefore(currentHour)) {
                continue;
            }
            result.add(new WeatherPayload.Hourly(
                    forecastAt, integer(node, "weather_code", index),
                    number(node, "temperature_2m", index), integer(node, "precipitation_probability", index),
                    number(node, "wind_speed_10m", index)
            ));
        }
        return result;
    }

    private List<WeatherPayload.Daily> daily(JsonNode node, ZoneId zone) {
        List<WeatherPayload.Daily> result = new ArrayList<>();
        JsonNode times = node.path("time");
        for (int index = 0; index < times.size() && result.size() < 7; index++) {
            result.add(new WeatherPayload.Daily(
                    instant(times.path(index), zone, null), integer(node, "weather_code", index),
                    number(node, "temperature_2m_max", index), number(node, "temperature_2m_min", index),
                    integer(node, "precipitation_probability_max", index), number(node, "wind_speed_10m_max", index)
            ));
        }
        return result.stream().filter(point -> point.forecastAt() != null).toList();
    }

    private boolean hasCompleteForecast(List<WeatherPayload.Hourly> hourly, List<WeatherPayload.Daily> daily) {
        return hourly.size() >= 24
                && daily.size() >= 7
                && hourly.stream().allMatch(point -> point.forecastAt() != null
                        && point.weatherCode() != null && point.temperatureC() != null)
                && daily.stream().allMatch(point -> point.forecastAt() != null
                        && point.weatherCode() != null && point.temperatureMaxC() != null && point.temperatureMinC() != null);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static ZoneId zone(String value) {
        try {
            return value == null || value.isBlank() ? ZoneId.of("UTC") : ZoneId.of(value);
        } catch (Exception exception) {
            throw new IllegalArgumentException("Invalid timezone");
        }
    }

    private static Instant instant(JsonNode value, ZoneId zone, Instant fallback) {
        if (value == null || value.isMissingNode() || value.isNull()) return fallback;
        if (value.isNumber()) return Instant.ofEpochSecond(value.asLong());
        try {
            return Instant.ofEpochSecond(Long.parseLong(value.asText()));
        } catch (NumberFormatException ignored) {
            try {
                return LocalDateTime.parse(value.asText()).atZone(zone).toInstant();
            } catch (Exception ignoredAgain) {
                return fallback;
            }
        }
    }

    private static Instant requiredInstant(JsonNode value, ZoneId zone, String field) {
        Instant result = instant(value, zone, null);
        if (result == null) {
            throw new WeatherProviderException("Weather provider response is missing or invalid " + field);
        }
        return result;
    }

    private static Double number(JsonNode parent, String key) {
        JsonNode node = parent.path(key);
        return node.isNumber() ? node.asDouble() : null;
    }

    private static Double requiredNumber(JsonNode parent, String key) {
        Double value = number(parent, key);
        if (value == null) {
            throw new WeatherProviderException("Weather provider response is missing " + key);
        }
        return value;
    }

    private static Double number(JsonNode parent, String key, int index) {
        JsonNode node = parent.path(key).path(index);
        return node.isNumber() ? node.asDouble() : null;
    }

    private static Integer integer(JsonNode parent, String key) {
        JsonNode node = parent.path(key);
        return node.isNumber() ? node.asInt() : null;
    }

    private static Integer requiredInteger(JsonNode parent, String key) {
        Integer value = integer(parent, key);
        if (value == null) {
            throw new WeatherProviderException("Weather provider response is missing " + key);
        }
        return value;
    }

    private static Integer integer(JsonNode parent, String key, int index) {
        JsonNode node = parent.path(key).path(index);
        return node.isNumber() ? node.asInt() : null;
    }
}
