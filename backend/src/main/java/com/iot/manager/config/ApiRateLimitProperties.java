package com.iot.manager.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "iot.rate-limit")
public class ApiRateLimitProperties {

    private boolean enabled;
    private int readsPerMinute = 120;
    private int archiveReadsPerMinute = 5;
    private int commandsPerMinute = 30;
    private int aiChatsPerMinute = 10;
    private int aiWritesPerMinute = 6;

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

    public int getArchiveReadsPerMinute() { return archiveReadsPerMinute; }

    public void setArchiveReadsPerMinute(int archiveReadsPerMinute) {
        this.archiveReadsPerMinute = archiveReadsPerMinute;
    }

    public int getCommandsPerMinute() {
        return commandsPerMinute;
    }

    public void setCommandsPerMinute(int commandsPerMinute) {
        this.commandsPerMinute = commandsPerMinute;
    }

    public int getAiChatsPerMinute() { return aiChatsPerMinute; }
    public void setAiChatsPerMinute(int aiChatsPerMinute) { this.aiChatsPerMinute = aiChatsPerMinute; }
    public int getAiWritesPerMinute() { return aiWritesPerMinute; }
    public void setAiWritesPerMinute(int aiWritesPerMinute) { this.aiWritesPerMinute = aiWritesPerMinute; }
}
