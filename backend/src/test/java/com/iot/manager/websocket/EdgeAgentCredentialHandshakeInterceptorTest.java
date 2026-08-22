package com.iot.manager.websocket;

import com.iot.manager.config.IotSecurityProperties;
import com.iot.manager.config.EdgeAgentSecurityProperties;
import com.iot.manager.service.AgentCredentialService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.http.server.ServletServerHttpResponse;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.socket.WebSocketHandler;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class EdgeAgentCredentialHandshakeInterceptorTest {

    @Mock
    private IotSecurityProperties securityProperties;

    @Mock
    private EdgeAgentSecurityProperties transportProperties;

    @Mock
    private AgentCredentialService credentialService;

    @Mock
    private WebSocketHandler handler;

    @Test
    void developmentModeKeepsLegacyUnscopedHandshake() {
        when(securityProperties.isEnabled()).thenReturn(false);
        Map<String, Object> attributes = new HashMap<>();

        boolean accepted = interceptor().beforeHandshake(
                request("", ""), response(), handler, attributes
        );

        assertThat(accepted).isTrue();
        assertThat(attributes).containsEntry(EdgeAgentCredentialHandshakeInterceptor.CREDENTIAL_ENFORCED_ATTRIBUTE, false);
    }

    @Test
    void secureModeRequiresHeadersAndCopiesOnlyNonSecretContext() {
        when(securityProperties.isEnabled()).thenReturn(true);
        when(transportProperties.isRequireSecureTransport()).thenReturn(false);
        when(credentialService.authenticate("cred-1", "secret-1"))
                .thenReturn(new AgentCredentialService.AuthenticatedAgent(7L, "edge-7", 11L, "site-11", "cred-1"));
        Map<String, Object> attributes = new HashMap<>();

        boolean accepted = interceptor().beforeHandshake(
                request("cred-1", "secret-1"), response(), handler, attributes
        );

        assertThat(accepted).isTrue();
        assertThat(attributes)
                .containsEntry(EdgeAgentCredentialHandshakeInterceptor.AGENT_DATABASE_ID_ATTRIBUTE, 7L)
                .containsEntry(EdgeAgentCredentialHandshakeInterceptor.AGENT_ID_ATTRIBUTE, "edge-7")
                .containsEntry(EdgeAgentCredentialHandshakeInterceptor.SITE_ID_ATTRIBUTE, 11L)
                .containsEntry(EdgeAgentCredentialHandshakeInterceptor.SITE_CODE_ATTRIBUTE, "site-11")
                .containsEntry(EdgeAgentCredentialHandshakeInterceptor.CREDENTIAL_ID_ATTRIBUTE, "cred-1")
                .doesNotContainValue("secret-1");
    }

    @Test
    void secureModeFailsClosedWhenCredentialServiceRejects() {
        when(securityProperties.isEnabled()).thenReturn(true);
        when(transportProperties.isRequireSecureTransport()).thenReturn(false);
        when(credentialService.authenticate("cred-1", "bad-secret"))
                .thenThrow(new org.springframework.security.access.AccessDeniedException("invalid"));

        boolean accepted = interceptor().beforeHandshake(
                request("cred-1", "bad-secret"), response(), handler, new HashMap<>()
        );

        assertThat(accepted).isFalse();
    }

    @Test
    void productionTransportRejectsCleartextButAcceptsForwardedHttps() {
        when(securityProperties.isEnabled()).thenReturn(true);
        when(transportProperties.isRequireSecureTransport()).thenReturn(true);
        boolean cleartext = interceptor().beforeHandshake(
                request("cred-1", "secret-1"), response(), handler, new HashMap<>()
        );
        assertThat(cleartext).isFalse();

        when(credentialService.authenticate("cred-1", "secret-1"))
                .thenReturn(new AgentCredentialService.AuthenticatedAgent(7L, "edge-7", 11L, "site-11", "cred-1"));
        boolean forwardedHttps = interceptor().beforeHandshake(
                request("cred-1", "secret-1", "https"), response(), handler, new HashMap<>()
        );
        assertThat(forwardedHttps).isTrue();
    }

    private EdgeAgentCredentialHandshakeInterceptor interceptor() {
        return new EdgeAgentCredentialHandshakeInterceptor(securityProperties, transportProperties, credentialService);
    }

    private ServerHttpRequest request(String credentialId, String token) {
        return request(credentialId, token, null);
    }

    private ServerHttpRequest request(String credentialId, String token, String forwardedProto) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/ws/edge/v1");
        request.addHeader(EdgeAgentCredentialHandshakeInterceptor.CREDENTIAL_HEADER, credentialId);
        request.addHeader(EdgeAgentCredentialHandshakeInterceptor.TOKEN_HEADER, token);
        if (forwardedProto != null) {
            request.addHeader("X-Forwarded-Proto", forwardedProto);
        }
        return new ServletServerHttpRequest(request);
    }

    private ServerHttpResponse response() {
        return new ServletServerHttpResponse(new MockHttpServletResponse());
    }
}
