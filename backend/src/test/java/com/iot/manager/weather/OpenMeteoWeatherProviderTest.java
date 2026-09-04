package com.iot.manager.weather;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.entity.SiteWeatherSettings;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.LongFunction;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OpenMeteoWeatherProviderTest {

    private static final long OBSERVED_AT = 1_786_588_200L;

    @Test
    void normalizesOnlyTheNext24HoursAndSevenDailyForecasts() throws Exception {
        HttpServer server = serverReturning(validPayload());
        server.start();
        try {
            OpenMeteoWeatherProvider provider = provider(server);

            WeatherPayload payload = provider.fetch(settings());

            assertThat(payload.current().temperatureC()).isEqualTo(23D);
            assertThat(payload.current().relativeHumidityPct()).isEqualTo(65);
            assertThat(payload.elevationM()).isEqualTo(32D);
            assertThat(payload.hourly()).hasSize(24);
            assertThat(payload.hourly().get(0).forecastAt()).isEqualTo(Instant.ofEpochSecond(OBSERVED_AT));
            assertThat(payload.daily()).hasSize(7);
            assertThat(payload.rawPayloadJson()).contains("surface_pressure");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsSuccessfulHttpResponsesThatDoNotContainUsableWeatherData() throws Exception {
        HttpServer server = serverReturning("{}");
        server.start();
        try {
            OpenMeteoWeatherProvider provider = provider(server);

            assertThatThrownBy(() -> provider.fetch(settings()))
                    .isInstanceOf(WeatherProviderException.class)
                    .hasMessageContaining("current weather");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void sendsTheOpenMeteoForecastContractThroughTheRealHttpAdapter() throws Exception {
        AtomicReference<URI> requestedUri = new AtomicReference<>();
        AtomicReference<String> acceptHeader = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/forecast", exchange -> {
            requestedUri.set(exchange.getRequestURI());
            acceptHeader.set(exchange.getRequestHeaders().getFirst("Accept"));
            byte[] body = validPayload().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            provider(server).fetch(settings());

            String query = URLDecoder.decode(requestedUri.get().getRawQuery(), StandardCharsets.UTF_8);
            assertThat(query)
                    .contains("latitude=22.5431", "longitude=114.0579", "timezone=Asia/Shanghai")
                    .contains("current=temperature_2m,relative_humidity_2m")
                    .contains("hourly=temperature_2m,relative_humidity_2m")
                    .contains("daily=weather_code,temperature_2m_max")
                    .contains("forecast_days=7", "timeformat=unixtime");
            assertThat(acceptHeader.get()).isEqualTo("application/json");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void mapsZeroOffsetAliasesToTheUtcValueAcceptedByOpenMeteo() throws Exception {
        AtomicReference<URI> requestedUri = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/forecast", exchange -> {
            requestedUri.set(exchange.getRequestURI());
            byte[] body = validPayload().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            OpenMeteoWeatherProvider provider = provider(server);
            for (String timezone : List.of("+00:00", "Z")) {
                provider.fetch(settings(timezone));

                String query = URLDecoder.decode(requestedUri.get().getRawQuery(), StandardCharsets.UTF_8);
                assertThat(query).contains("timezone=UTC").doesNotContain("timezone=+00:00", "timezone=Z");
            }
        } finally {
            server.stop(0);
        }
    }

    @Test
    void usesLocationTimezoneForNonZeroFixedOffsetsThatOpenMeteoDoesNotAccept() throws Exception {
        AtomicReference<URI> requestedUri = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/forecast", exchange -> {
            requestedUri.set(exchange.getRequestURI());
            byte[] body = validPayload().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            provider(server).fetch(settings("+08:00"));

            String query = URLDecoder.decode(requestedUri.get().getRawQuery(), StandardCharsets.UTF_8);
            assertThat(query).contains("timezone=auto");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void enforcesTheConfiguredDeadlineWhenTheWeatherUpstreamStalls() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/forecast", exchange -> {
            try {
                Thread.sleep(1_500);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
            } finally {
                exchange.close();
            }
        });
        server.start();
        try {
            OpenMeteoWeatherProvider provider = new OpenMeteoWeatherProvider(
                    new ObjectMapper(), "http://localhost:" + server.getAddress().getPort() + "/forecast", 1
            );

            assertThatThrownBy(() -> provider.fetch(settings()))
                    .isInstanceOf(WeatherProviderException.class)
                    .hasRootCauseInstanceOf(HttpTimeoutException.class);
        } finally {
            server.stop(0);
        }
    }

    private OpenMeteoWeatherProvider provider(HttpServer server) {
        return new OpenMeteoWeatherProvider(
                new ObjectMapper(), "http://localhost:" + server.getAddress().getPort() + "/forecast", 2
        );
    }

    private SiteWeatherSettings settings() {
        return settings("Asia/Shanghai");
    }

    private SiteWeatherSettings settings(String timezone) {
        return SiteWeatherSettings.builder()
                .latitude(22.5431).longitude(114.0579).timezone(timezone).build();
    }

    private HttpServer serverReturning(String response) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/forecast", exchange -> {
            byte[] body = response.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        return server;
    }

    private String validPayload() {
        return """
                {
                  "elevation": 32,
                  "current": {"time": %d, "weather_code": 2, "temperature_2m": 23,
                    "apparent_temperature": 24.1, "relative_humidity_2m": 65, "surface_pressure": 1013,
                    "wind_speed_10m": 12, "wind_direction_10m": 135},
                  "hourly": {"time": [%s], "weather_code": [%s], "temperature_2m": [%s],
                    "precipitation_probability": [%s], "wind_speed_10m": [%s]},
                  "daily": {"time": [%s], "weather_code": [%s], "temperature_2m_max": [%s],
                    "temperature_2m_min": [%s], "precipitation_probability_max": [%s], "wind_speed_10m_max": [%s]}
                }
                """.formatted(
                OBSERVED_AT,
                series(27, index -> OBSERVED_AT + (index - 3L) * 3_600),
                series(27, index -> 2), series(27, index -> 23 + index), series(27, index -> 10), series(27, index -> 12),
                series(7, index -> OBSERVED_AT + index * 86_400L),
                series(7, index -> 2), series(7, index -> 31), series(7, index -> 25), series(7, index -> 20), series(7, index -> 18)
        );
    }

    private String series(int count, LongFunction<Number> value) {
        return IntStream.range(0, count)
                .mapToObj(index -> value.apply(index).toString())
                .collect(java.util.stream.Collectors.joining(","));
    }
}
