package com.iot.manager.dto;

import jakarta.validation.constraints.Size;

public record AgentCredentialRevokeRequest(@Size(max = 1000) String reason) {
}
