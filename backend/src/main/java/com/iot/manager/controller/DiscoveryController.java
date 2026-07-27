package com.iot.manager.controller;

import com.iot.manager.dto.ClaimLanDeviceRequest;
import com.iot.manager.dto.DeviceView;
import com.iot.manager.dto.LanCandidateView;
import com.iot.manager.service.LanDiscoveryService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/discovery")
@RequiredArgsConstructor
public class DiscoveryController {

    private final LanDiscoveryService lanDiscoveryService;

    @GetMapping("/lan")
    public List<LanCandidateView> listLanCandidates(@RequestParam(required = false) String siteCode) {
        return lanDiscoveryService.listCandidates(siteCode);
    }

    @PostMapping("/lan/{candidateId}/claim")
    public ResponseEntity<DeviceView> claimLanCandidate(
            @PathVariable String candidateId,
            @Valid @RequestBody ClaimLanDeviceRequest request
    ) {
        return ResponseEntity.ok(lanDiscoveryService.claim(candidateId, request));
    }
}
