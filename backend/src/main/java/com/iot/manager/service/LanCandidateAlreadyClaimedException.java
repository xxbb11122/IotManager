package com.iot.manager.service;

public class LanCandidateAlreadyClaimedException extends IllegalStateException {

    public LanCandidateAlreadyClaimedException(String candidateId) {
        super("LAN candidate already claimed: " + candidateId);
    }
}
