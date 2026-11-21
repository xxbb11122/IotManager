package com.iot.manager.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.Map;

/** Optional, deployment-specific sampling contracts, not guessed from a device name. */
@Component
@ConfigurationProperties(prefix = "iot.device-assessment")
public class DeviceAssessmentProperties {
    private int linkMaxAgeSeconds = 180;
    private Map<String, Map<String, Integer>> reportingIntervalSeconds = Map.of();

    public int getLinkMaxAgeSeconds() { return linkMaxAgeSeconds; }
    public void setLinkMaxAgeSeconds(int value) {
        if (value < 1 || value > 86_400) throw new IllegalArgumentException("Invalid assessment link age");
        linkMaxAgeSeconds = value;
    }

    public Map<String, Map<String, Integer>> getReportingIntervalSeconds() { return reportingIntervalSeconds; }
    public void setReportingIntervalSeconds(Map<String, Map<String, Integer>> value) {
        value.values().forEach(fields -> fields.values().forEach(seconds -> {
            if (seconds == null || seconds < 1 || seconds > 86_400)
                throw new IllegalArgumentException("Invalid assessment reporting interval");
        }));
        reportingIntervalSeconds = value;
    }

    public Integer maxAgeSeconds(String profileId, String field) {
        if (profileId == null) return null;
        Integer interval = reportingIntervalSeconds.getOrDefault(profileId, Map.of()).get(field);
        return interval == null ? null : 3 * interval;
    }
}
