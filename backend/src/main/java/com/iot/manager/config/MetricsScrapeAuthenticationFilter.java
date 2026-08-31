package com.iot.manager.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

/**
 * Authenticates only the Docker-internal Prometheus scrape endpoint with a
 * constant-time comparison against a Docker secret. Browser and API requests
 * cannot obtain this authority, and Caddy never routes Actuator paths.
 */
final class MetricsScrapeAuthenticationFilter extends OncePerRequestFilter {

    static final String METRICS_PATH = "/actuator/prometheus";
    static final String TOKEN_HEADER = "X-Iot-Metrics-Token";

    private final ObservabilityProperties properties;

    MetricsScrapeAuthenticationFilter(ObservabilityProperties properties) {
        this.properties = properties;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !"GET".equalsIgnoreCase(request.getMethod())
                || !METRICS_PATH.equals(request.getRequestURI());
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String suppliedToken = request.getHeader(TOKEN_HEADER);
        if (properties.hasScrapeToken() && tokenMatches(suppliedToken, properties.getScrapeToken())) {
            SecurityContext context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(new UsernamePasswordAuthenticationToken(
                    "prometheus-internal-scraper",
                    "N/A",
                    List.of(new SimpleGrantedAuthority("ROLE_METRICS"))
            ));
            SecurityContextHolder.setContext(context);
        }
        filterChain.doFilter(request, response);
    }

    private boolean tokenMatches(String suppliedToken, String expectedToken) {
        if (suppliedToken == null) {
            return false;
        }
        return MessageDigest.isEqual(
                suppliedToken.getBytes(StandardCharsets.UTF_8),
                expectedToken.getBytes(StandardCharsets.UTF_8)
        );
    }
}
