package com.iot.manager.config;

import com.iot.manager.service.PlatformMetricsService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Single-node R1 protection for authenticated API users. R2 replaces this
 * local window with the approved Redis-based distributed limiter.
 */
public class ApiRateLimitFilter extends OncePerRequestFilter {

    private static final long WINDOW_MILLIS = Duration.ofMinutes(1).toMillis();

    private final ApiRateLimitProperties properties;
    private final PlatformMetricsService metrics;
    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    public ApiRateLimitFilter(ApiRateLimitProperties properties, PlatformMetricsService metrics) {
        this.properties = properties;
        this.metrics = metrics;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !properties.isEnabled()
                || "OPTIONS".equalsIgnoreCase(request.getMethod())
                || !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        Category category = category(request);
        String principal = principal(request);
        String siteCode = siteCode(request);
        if (principal != null) MDC.put("actor", principal);
        if (siteCode != null) MDC.put("siteCode", siteCode);
        try {
            if (category == null || allow(category, principal, System.currentTimeMillis())) {
                filterChain.doFilter(request, response);
                return;
            }
            metrics.rateLimited(category.name().toLowerCase());
            long retryAfter = retryAfterSeconds(category, principal, System.currentTimeMillis());
            response.setStatus(429);
            response.setContentType("application/json");
            response.setCharacterEncoding("UTF-8");
            response.setHeader("Retry-After", Long.toString(retryAfter));
            response.getWriter().write("{\"message\":\"Rate limit exceeded\",\"retryAfterSeconds\":" + retryAfter + "}");
        } finally {
            MDC.remove("actor");
            MDC.remove("siteCode");
        }
    }

    private boolean allow(Category category, String principal, long now) {
        int limit = limit(category);
        if (limit <= 0) return false;
        String key = category.name() + ':' + principal;
        AtomicBoolean allowed = new AtomicBoolean(false);
        windows.compute(key, (ignored, previous) -> {
            if (previous == null || now - previous.startedAtMillis() >= WINDOW_MILLIS) {
                allowed.set(true);
                return new Window(now, 1);
            }
            if (previous.count() < limit) {
                allowed.set(true);
                return new Window(previous.startedAtMillis(), previous.count() + 1);
            }
            return previous;
        });
        if (windows.size() > 10_000) {
            windows.entrySet().removeIf(entry -> now - entry.getValue().startedAtMillis() >= WINDOW_MILLIS);
        }
        return allowed.get();
    }

    private long retryAfterSeconds(Category category, String principal, long now) {
        Window window = windows.get(category.name() + ':' + principal);
        if (window == null) return 1;
        return Math.max(1, (WINDOW_MILLIS - Math.max(0, now - window.startedAtMillis()) + 999) / 1_000);
    }

    private Category category(HttpServletRequest request) {
        String method = request.getMethod();
        String path = request.getRequestURI();
        if ("GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method)) return Category.READ;
        if (path.contains("/commands") || path.startsWith("/api/command-batches")) return Category.COMMAND;
        return null;
    }

    private String principal(HttpServletRequest request) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated() && authentication.getName() != null
                && !authentication.getName().isBlank() && !"anonymousUser".equals(authentication.getName())) {
            return authentication.getName();
        }
        String address = request.getRemoteAddr();
        return "unauthenticated:" + (address == null || address.isBlank() ? "unknown" : address);
    }

    private String siteCode(HttpServletRequest request) {
        String parameter = request.getParameter("siteCode");
        if (parameter != null && !parameter.isBlank()) return parameter.trim();
        String[] parts = request.getRequestURI().split("/");
        for (int index = 0; index < parts.length - 2; index++) {
            if ("sites".equals(parts[index]) && !parts[index + 1].isBlank()) return parts[index + 1];
        }
        return null;
    }

    private int limit(Category category) {
        return category == Category.READ ? properties.getReadsPerMinute() : properties.getCommandsPerMinute();
    }

    private enum Category { READ, COMMAND }

    private record Window(long startedAtMillis, int count) { }
}
