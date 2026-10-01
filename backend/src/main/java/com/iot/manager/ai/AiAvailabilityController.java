package com.iot.manager.ai;

import com.iot.manager.service.SiteAccessService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/sites/{siteId}/ai")
public class AiAvailabilityController {
    public record Status(boolean enabled, boolean knowledgeEnabled, String state) { }
    public record Capabilities(int contractVersion, java.util.Map<String, Boolean> features,
                               java.util.Map<String, Integer> limits) { }

    private final SiteAccessService siteAccess;
    private final AiProperties properties;

    public AiAvailabilityController(SiteAccessService siteAccess, AiProperties properties) {
        this.siteAccess = siteAccess;
        this.properties = properties;
    }

    @GetMapping("/status")
    public Status status(@PathVariable long siteId) {
        siteAccess.requireSiteAccess(siteId);
        return new Status(properties.isEnabled(), properties.isEnabled() && properties.isKnowledgeEnabled(),
                properties.isEnabled() ? "CONFIGURED_REMOTE" : "DISABLED");
    }

    @GetMapping("/capabilities")
    public Capabilities capabilities(@PathVariable long siteId) {
        siteAccess.requireSiteAccess(siteId);
        boolean enabled = properties.isEnabled();
        return new Capabilities(1, java.util.Map.of("history", enabled, "pagedMessages", enabled,
                "requestRecovery", enabled, "idempotency", enabled, "personaActivationGuard", enabled),
                java.util.Map.of("maxQuestionChars", properties.getMaxQuestionChars(),
                        "maxAnswerChars", properties.getMaxAnswerChars(), "maxInputChars", properties.getMaxInputChars(),
                        "maxPersonaChars", 4000, "maxPersonaNameChars", 80, "maxPageSize", 100,
                        "recoveryWindowSeconds", 86400, "requestTimeoutSeconds", properties.getRequestTimeoutSeconds()));
    }
}
