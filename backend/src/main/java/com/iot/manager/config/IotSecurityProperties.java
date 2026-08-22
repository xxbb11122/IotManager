package com.iot.manager.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Security is deliberately disabled for the R0 development and test profiles.
 * The production profile enables this switch and uses Spring Security's JWT
 * resource-server support with the configured Keycloak issuer.
 */
@ConfigurationProperties(prefix = "iot.security")
public class IotSecurityProperties {

    private boolean enabled;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }
}
