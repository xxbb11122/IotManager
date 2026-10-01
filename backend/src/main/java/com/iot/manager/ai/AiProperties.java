package com.iot.manager.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

@ConfigurationProperties(prefix = "iot.ai")
public class AiProperties {
    private boolean enabled;
    private boolean knowledgeEnabled;
    private List<String> allowedHosts = List.of();
    private int embeddingDimension = 1536;
    private long maxFileBytes = 5_242_880;
    private long maxSiteBytes = 52_428_800;
    private int maxQuestionChars = 2_000;
    private int maxAnswerChars = 8_000;
    private int maxInputChars = 16_000;
    private int requestTimeoutSeconds = 120;
    private int maxConcurrentChats = 3;
    private double minSimilarity = 0.65;
    private int conversationRetentionDays = 30;
    private int maxSiteChatsPerDay = 200;
    private int maxSiteUploadsPerDay = 20;

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public boolean isKnowledgeEnabled() { return knowledgeEnabled; }
    public void setKnowledgeEnabled(boolean knowledgeEnabled) { this.knowledgeEnabled = knowledgeEnabled; }
    public List<String> getAllowedHosts() { return allowedHosts; }
    public void setAllowedHosts(List<String> allowedHosts) { this.allowedHosts = allowedHosts; }
    public int getEmbeddingDimension() { return embeddingDimension; }
    public void setEmbeddingDimension(int embeddingDimension) { this.embeddingDimension = embeddingDimension; }
    public long getMaxFileBytes() { return maxFileBytes; }
    public void setMaxFileBytes(long maxFileBytes) { this.maxFileBytes = maxFileBytes; }
    public long getMaxSiteBytes() { return maxSiteBytes; }
    public void setMaxSiteBytes(long maxSiteBytes) { this.maxSiteBytes = maxSiteBytes; }
    public int getMaxQuestionChars() { return maxQuestionChars; }
    public void setMaxQuestionChars(int maxQuestionChars) { this.maxQuestionChars = maxQuestionChars; }
    public int getMaxAnswerChars() { return maxAnswerChars; }
    public void setMaxAnswerChars(int maxAnswerChars) { this.maxAnswerChars = maxAnswerChars; }
    public int getMaxInputChars() { return maxInputChars; }
    public void setMaxInputChars(int value) { maxInputChars = value; }
    public int getRequestTimeoutSeconds() { return requestTimeoutSeconds; }
    public void setRequestTimeoutSeconds(int value) { requestTimeoutSeconds = value; }
    public int getMaxConcurrentChats() { return maxConcurrentChats; }
    public void setMaxConcurrentChats(int maxConcurrentChats) { this.maxConcurrentChats = maxConcurrentChats; }
    public double getMinSimilarity() { return minSimilarity; }
    public void setMinSimilarity(double minSimilarity) { this.minSimilarity = minSimilarity; }
    public int getConversationRetentionDays() { return conversationRetentionDays; }
    public void setConversationRetentionDays(int conversationRetentionDays) { this.conversationRetentionDays = conversationRetentionDays; }
    public int getMaxSiteChatsPerDay() { return maxSiteChatsPerDay; }
    public void setMaxSiteChatsPerDay(int maxSiteChatsPerDay) { this.maxSiteChatsPerDay = maxSiteChatsPerDay; }
    public int getMaxSiteUploadsPerDay() { return maxSiteUploadsPerDay; }
    public void setMaxSiteUploadsPerDay(int maxSiteUploadsPerDay) { this.maxSiteUploadsPerDay = maxSiteUploadsPerDay; }
}
