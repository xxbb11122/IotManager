package com.iot.manager.config;

import com.iot.manager.service.PlatformMetricsService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class ApiRateLimitFilterTest {

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void limitsReadRequestsPerCallerAndReturnsRetryInformation() throws Exception {
        ApiRateLimitProperties properties = new ApiRateLimitProperties();
        properties.setEnabled(true);
        properties.setReadsPerMinute(2);
        PlatformMetricsService metrics = mock(PlatformMetricsService.class);
        ApiRateLimitFilter filter = new ApiRateLimitFilter(properties, metrics);

        assertThat(response(filter).getStatus()).isEqualTo(200);
        assertThat(response(filter).getStatus()).isEqualTo(200);
        MockHttpServletResponse limited = response(filter);

        assertThat(limited.getStatus()).isEqualTo(429);
        assertThat(limited.getHeader("Retry-After")).isNotBlank();
        assertThat(limited.getContentAsString()).contains("retryAfterSeconds");
        verify(metrics).rateLimited("read");
    }

    private MockHttpServletResponse response(ApiRateLimitFilter filter) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/devices");
        request.setRemoteAddr("192.0.2.10");
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, new MockFilterChain());
        return response;
    }
}
