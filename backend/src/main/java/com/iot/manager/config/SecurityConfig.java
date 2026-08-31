package com.iot.manager.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.core.convert.converter.Converter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * R0 keeps the existing local demo flow available.  In the production profile
 * the same application becomes a stateless Keycloak/OIDC resource server: all
 * API and WebSocket handshakes require a verified bearer token and write APIs
 * reject VIEWER users before they reach a controller.
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@EnableConfigurationProperties({
        IotSecurityProperties.class,
        WebAccessProperties.class,
        EdgeAgentSecurityProperties.class,
        BootstrapOwnerProperties.class,
        ApiRateLimitProperties.class,
        ObservabilityProperties.class
})
public class SecurityConfig {

    private static final Set<String> PLATFORM_ROLES = Set.of("OWNER", "ADMIN", "OPERATOR", "VIEWER");

    private final IotSecurityProperties securityProperties;
    private final WebAccessProperties webAccessProperties;

    public SecurityConfig(IotSecurityProperties securityProperties, WebAccessProperties webAccessProperties) {
        this.securityProperties = securityProperties;
        this.webAccessProperties = webAccessProperties;
    }

    /**
     * Spring Security handles an OPTIONS request before MVC reaches the
     * WebMvcConfigurer mapping.  Keep an explicit source here so production
     * CORS behavior cannot depend on MVC handler-mapping discovery order.
     */
    @Bean
    CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(webAccessProperties.getAllowedOrigins());
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("*"));
        configuration.setExposedHeaders(List.of("X-Request-Id", "X-Trace-Id", "Retry-After"));

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", configuration);
        return source;
    }

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            KeycloakJwtAuthenticationConverter keycloakJwtAuthenticationConverter,
            ApiRateLimitProperties apiRateLimitProperties,
            com.iot.manager.service.PlatformMetricsService platformMetricsService,
            ObservabilityProperties observabilityProperties,
            CorsConfigurationSource corsConfigurationSource
    ) throws Exception {
        RequestCorrelationFilter requestCorrelationFilter = new RequestCorrelationFilter();
        ApiRateLimitFilter apiRateLimitFilter = new ApiRateLimitFilter(apiRateLimitProperties, platformMetricsService);
        http.csrf(csrf -> csrf.disable())
                .formLogin(formLogin -> formLogin.disable())
                .httpBasic(httpBasic -> httpBasic.disable())
                .logout(logout -> logout.disable())
                .requestCache(requestCache -> requestCache.disable());
        // Use the concrete allow-list filter here instead of relying on MVC's
        // HandlerMappingIntrospector fallback.  That fallback may not resolve
        // a versioned API route during an unauthenticated preflight request.
        http.addFilterBefore(new CorsFilter(corsConfigurationSource), SecurityContextHolderFilter.class);
        http.addFilterBefore(requestCorrelationFilter, SecurityContextHolderFilter.class);
        http.addFilterBefore(new MetricsScrapeAuthenticationFilter(observabilityProperties), BearerTokenAuthenticationFilter.class);

        if (!securityProperties.isEnabled()) {
            // H2 remains a development-only diagnostic tool and still needs
            // same-origin frames when the local dev profile is active.
            http.headers(headers -> headers.frameOptions(frameOptions -> frameOptions.sameOrigin()))
                    .authorizeHttpRequests(authorize -> authorize.anyRequest().permitAll());
            return http.build();
        }

        validateProductionOrigins();
        http.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .addFilterAfter(apiRateLimitFilter, BearerTokenAuthenticationFilter.class)
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/actuator/health/liveness", "/actuator/health/readiness", "/error").permitAll()
                        // The scrape endpoint is not an operations API. No
                        // Keycloak realm role grants it; only the preceding
                        // Docker-secret filter can establish ROLE_METRICS.
                        .requestMatchers(MetricsScrapeAuthenticationFilter.METRICS_PATH).hasRole("METRICS")
                        .requestMatchers("/actuator/**").hasAnyRole("OWNER", "ADMIN")
                        // Edge agents use the independently managed
                        // X-Iot-Agent-Credential/X-Iot-Agent-Token pair. The
                        // handshake interceptor performs the credential
                        // check before the WebSocket is upgraded.
                        .requestMatchers("/ws/edge/v1").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/**").hasAnyRole("OWNER", "ADMIN", "OPERATOR", "VIEWER")
                        .requestMatchers(HttpMethod.POST, "/api/**").hasAnyRole("OWNER", "ADMIN", "OPERATOR")
                        .requestMatchers(HttpMethod.PUT, "/api/**").hasAnyRole("OWNER", "ADMIN", "OPERATOR")
                        .requestMatchers(HttpMethod.PATCH, "/api/**").hasAnyRole("OWNER", "ADMIN", "OPERATOR")
                        .requestMatchers(HttpMethod.DELETE, "/api/**").hasAnyRole("OWNER", "ADMIN")
                        .requestMatchers("/ws/**").authenticated()
                        .anyRequest().denyAll())
                .oauth2ResourceServer(oauth2 -> oauth2
                        // Native WebSocket clients can send Authorization headers;
                        // browser WebSocket APIs cannot.  Restrict the query
                        // fallback to /ws/** and require TLS in production.
                        .bearerTokenResolver(webSocketAwareBearerTokenResolver())
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(keycloakJwtAuthenticationConverter)));

        return http.build();
    }

    @Bean
    KeycloakJwtAuthenticationConverter keycloakJwtAuthenticationConverter() {
        return new KeycloakJwtAuthenticationConverter();
    }

    private static final class KeycloakJwtAuthenticationConverter implements Converter<Jwt, JwtAuthenticationToken> {

        private final JwtGrantedAuthoritiesConverter scopeConverter = new JwtGrantedAuthoritiesConverter();

        @Override
        public JwtAuthenticationToken convert(Jwt jwt) {
            Collection<GrantedAuthority> authorities = new LinkedHashSet<>(scopeConverter.convert(jwt));
            addRealmRoles(jwt, authorities);
            String principalName = jwt.getClaimAsString("preferred_username");
            if (principalName == null || principalName.isBlank()) {
                principalName = jwt.getSubject();
            }
            return new JwtAuthenticationToken(jwt, authorities, principalName);
        }

        private void addRealmRoles(Jwt jwt, Collection<GrantedAuthority> authorities) {
            Object realmAccessClaim = jwt.getClaim("realm_access");
            if (!(realmAccessClaim instanceof Map<?, ?> realmAccess)) {
                return;
            }
            Object rolesClaim = realmAccess.get("roles");
            if (!(rolesClaim instanceof Collection<?> roles)) {
                return;
            }
            roles.stream()
                    .filter(String.class::isInstance)
                    .map(String.class::cast)
                    .map(String::trim)
                    .map(String::toUpperCase)
                    .filter(PLATFORM_ROLES::contains)
                    .map(role -> new SimpleGrantedAuthority("ROLE_" + role))
                    .forEach(authorities::add);
        }
    }

    private void validateProductionOrigins() {
        if (webAccessProperties.getAllowedOrigins().isEmpty() || webAccessProperties.allowsWildcard()) {
            throw new IllegalStateException(
                    "Production security requires iot.web.allowed-origins to contain explicit HTTPS frontend origins"
            );
        }
    }

    private RestrictedWebSocketBearerTokenResolver webSocketAwareBearerTokenResolver() {
        return new RestrictedWebSocketBearerTokenResolver();
    }
}
