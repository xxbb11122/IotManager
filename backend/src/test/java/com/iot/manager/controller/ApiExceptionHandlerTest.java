package com.iot.manager.controller;

import com.iot.manager.config.TimeProperties;
import com.iot.manager.service.TimeProvider;
import com.iot.manager.weather.WeatherRefreshRateLimitedException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class ApiExceptionHandlerTest {

    @Test
    void weatherRefreshCooldownReturnsRetryAfterHeader() {
        var response = new ApiExceptionHandler(new TimeProvider(
                Clock.fixed(Instant.parse("2026-09-23T00:00:00Z"), ZoneOffset.UTC), new TimeProperties()
        ))
                .handleWeatherRefreshRateLimit(new WeatherRefreshRateLimitedException(17));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(response.getHeaders().getFirst("Retry-After")).isEqualTo("17");
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().status()).isEqualTo(429);
    }
}
