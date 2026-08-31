package com.iot.manager.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * An opaque, deployment-provided token used solely by the internal Prometheus
 * scraper. It is deliberately not a Keycloak role or a browser credential.
 */
@ConfigurationProperties(prefix = "iot.observability")
public class ObservabilityProperties {

    private String scrapeToken = "";

    public String getScrapeToken() {
        return scrapeToken;
    }

    public void setScrapeToken(String scrapeToken) {
        this.scrapeToken = scrapeToken == null ? "" : scrapeToken.trim();
    }

    public boolean hasScrapeToken() {
        return !scrapeToken.isBlank();
    }
}
