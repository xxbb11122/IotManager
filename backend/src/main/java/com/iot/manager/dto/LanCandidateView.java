package com.iot.manager.dto;

public record LanCandidateView(
        String candidateId,
        String name,
        String model,
        String ipAddress,
        String transport,
        String profileId,
        int signal
) {
}
