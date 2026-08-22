package com.iot.manager.controller;

import com.iot.manager.dto.ClaimLanDeviceRequest;
import com.iot.manager.dto.DeviceView;
import com.iot.manager.dto.LanCandidateView;
import com.iot.manager.service.EdgeDiscoveryService;
import com.iot.manager.service.LanDiscoveryService;
import com.iot.manager.service.SiteAccessService;
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
@RequestMapping({"/api/discovery", "/api/v1/discovery"})
@RequiredArgsConstructor
public class DiscoveryController {

    private final LanDiscoveryService lanDiscoveryService;
    private final EdgeDiscoveryService edgeDiscoveryService;
    private final SiteAccessService siteAccessService;

    @GetMapping("/lan")
    public List<LanCandidateView> listLanCandidates(@RequestParam(required = false) String siteCode) {
        if (siteCode != null && !siteCode.isBlank()) {
            siteAccessService.requireSiteAccess(siteCode);
            if (edgeDiscoveryService.hasConnectedAgent(siteCode)) {
                return edgeDiscoveryService.listCandidates(siteCode);
            }
            return lanDiscoveryService.listCandidates(siteCode);
        }
        if (!siteAccessService.isScopeEnforced()) {
            return lanDiscoveryService.listCandidates("demo-site");
        }
        return siteAccessService.accessibleSiteCodes().stream()
                .flatMap(code -> {
                    if (edgeDiscoveryService.hasConnectedAgent(code)) {
                        return edgeDiscoveryService.listCandidates(code).stream();
                    }
                    return lanDiscoveryService.listCandidates(code).stream();
                })
                .toList();
    }

    @PostMapping("/lan/{candidateId}/claim")
    public ResponseEntity<DeviceView> claimLanCandidate(
            @PathVariable String candidateId,
            @Valid @RequestBody ClaimLanDeviceRequest request
    ) {
        siteAccessService.requireSiteAccess(request.siteCode());
        if (edgeDiscoveryService.ownsCandidate(candidateId)) {
            siteAccessService.requireCandidateAccess(candidateId);
        }
        if (edgeDiscoveryService.ownsCandidate(candidateId)) {
            return ResponseEntity.ok(edgeDiscoveryService.claim(candidateId, request));
        }
        return ResponseEntity.ok(lanDiscoveryService.claim(candidateId, request));
    }
}
