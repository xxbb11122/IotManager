package com.iot.manager.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Transport boundary for the production edge-agent WebSocket endpoint. */
@ConfigurationProperties(prefix = "iot.edge-agent")
public class EdgeAgentSecurityProperties {

    private boolean requireSecureTransport;

    public boolean isRequireSecureTransport() {
        return requireSecureTransport;
    }

    public void setRequireSecureTransport(boolean requireSecureTransport) {
        this.requireSecureTransport = requireSecureTransport;
    }
}
