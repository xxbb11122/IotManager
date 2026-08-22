package com.iot.manager.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class RequestCorrelationFilterTest {

    @Test
    void preservesSafeRequestIdentifiersAndGeneratesMissingTraceIdentifiers() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/devices");
        request.addHeader("X-Request-Id", "request-12345678");
        MockHttpServletResponse response = new MockHttpServletResponse();

        new RequestCorrelationFilter().doFilter(request, response, new MockFilterChain());

        assertThat(response.getHeader("X-Request-Id")).isEqualTo("request-12345678");
        assertThat(response.getHeader("X-Trace-Id")).matches("[0-9a-f-]{36}");
    }
}
