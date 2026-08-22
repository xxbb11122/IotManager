package com.iot.manager.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

/** Adds safe request/trace identifiers to every response and structured log. */
public class RequestCorrelationFilter extends OncePerRequestFilter {

    private static final String REQUEST_ID_HEADER = "X-Request-Id";
    private static final String TRACE_ID_HEADER = "X-Trace-Id";
    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{7,127}");

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String requestId = acceptedOrGenerated(request.getHeader(REQUEST_ID_HEADER));
        String traceId = acceptedOrGenerated(request.getHeader(TRACE_ID_HEADER));
        response.setHeader(REQUEST_ID_HEADER, requestId);
        response.setHeader(TRACE_ID_HEADER, traceId);
        MDC.put("requestId", requestId);
        MDC.put("traceId", traceId);
        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove("requestId");
            MDC.remove("traceId");
        }
    }

    private String acceptedOrGenerated(String supplied) {
        String value = supplied == null ? "" : supplied.trim();
        return SAFE_ID.matcher(value).matches() ? value : UUID.randomUUID().toString();
    }
}
