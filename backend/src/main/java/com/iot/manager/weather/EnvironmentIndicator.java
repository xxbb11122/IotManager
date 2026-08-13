package com.iot.manager.weather;

public record EnvironmentIndicator(
        String level,
        String label,
        boolean ideal,
        String reason
) {
    public static EnvironmentIndicator unavailable(String label, String reason) {
        return new EnvironmentIndicator("UNAVAILABLE", label, false, reason);
    }

    public static EnvironmentIndicator notConfigured(String reason) {
        return new EnvironmentIndicator("NOT_CONFIGURED", "待接入", false, reason);
    }
}
