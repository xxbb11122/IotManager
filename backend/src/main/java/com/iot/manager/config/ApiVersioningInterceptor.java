package com.iot.manager.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Marks the unversioned API as a compatibility alias without changing its
 * response body.  New and migrated clients should use {@code /api/v1/**};
 * the alias remains available until the documented R2 sunset.
 */
public class ApiVersioningInterceptor implements HandlerInterceptor {

    static final String DEPRECATION_HEADER = "Deprecation";
    static final String SUNSET_VERSION_HEADER = "Sunset-Version";
    static final String SUNSET_VERSION = "R2.0";

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String path = request.getRequestURI();
        if (path != null && path.startsWith("/api/") && !path.startsWith("/api/v1/")) {
            response.setHeader(DEPRECATION_HEADER, "true");
            response.setHeader(SUNSET_VERSION_HEADER, SUNSET_VERSION);
        }
        return true;
    }
}
