package com.iot.manager.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;

class RestrictedWebSocketBearerTokenResolverTest {

    private final RestrictedWebSocketBearerTokenResolver resolver = new RestrictedWebSocketBearerTokenResolver();

    @Test
    void acceptsQueryTokenOnlyForSecureWebSocketUpgrades() {
        MockHttpServletRequest secureWebSocket = request("/ws/devices", true);
        secureWebSocket.setParameter("access_token", " browser-token ");

        MockHttpServletRequest insecureWebSocket = request("/ws/devices", false);
        insecureWebSocket.setParameter("access_token", "browser-token");

        MockHttpServletRequest secureApi = request("/api/devices", true);
        secureApi.setParameter("access_token", "browser-token");

        assertThat(resolver.resolve(secureWebSocket)).isEqualTo("browser-token");
        assertThat(resolver.resolve(insecureWebSocket)).isNull();
        assertThat(resolver.resolve(secureApi)).isNull();
    }

    @Test
    void preservesAuthorizationHeaderForNativeWebSocketClients() {
        MockHttpServletRequest request = request("/ws/edge/v1", false);
        request.addHeader("Authorization", "Bearer native-token");

        assertThat(resolver.resolve(request)).isEqualTo("native-token");
    }

    @Test
    void prefersTheTokenInTheWebSocketSubprotocolWithoutRequiringTlsAtResolverLevel() {
        MockHttpServletRequest request = request("/ws/devices", false);
        request.addHeader("Sec-WebSocket-Protocol", "chat, iot-bearer.browser-token-2");

        assertThat(resolver.resolve(request)).isEqualTo("browser-token-2");
    }

    private MockHttpServletRequest request(String uri, boolean secure) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", uri);
        request.setSecure(secure);
        return request;
    }
}
