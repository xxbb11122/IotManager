package com.iot.manager.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "iot.rate-limit")
public class ApiRateLimitProperties {

    private boolean enabled;
    private int readsPerMinute = 120;
    private int commandsPerMinute = 30;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public int getReadsPerMinute() {
        return readsPerMinute;
    }

    public void setReadsPerMinute(int readsPerMinute) {
        this.readsPerMinute = readsPerMinute;
    }

    public int getCommandsPerMinute() {
        return commandsPerMinute;
    }

    public void setCommandsPerMinute(int commandsPerMinute) {
        this.commandsPerMinute = commandsPerMinute;
    }
}
