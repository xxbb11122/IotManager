package com.iot.manager.controller;

import com.iot.manager.dto.AgentCredentialProvisionRequest;
import com.iot.manager.dto.AgentCredentialRevokeRequest;
import com.iot.manager.dto.AgentCredentialRotateRequest;
import com.iot.manager.dto.AgentCredentialView;
import com.iot.manager.dto.IssuedAgentCredentialView;
import com.iot.manager.service.AgentCredentialService;
import com.iot.manager.service.SiteAccessService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Administrative, one-time-secret provisioning API for edge agents. */
@RestController
@RequestMapping("/api/v1/edge-agents")
@RequiredArgsConstructor
@PreAuthorize("hasAnyRole('OWNER', 'ADMIN')")
public class AgentCredentialController {

    private final AgentCredentialService credentialService;
    private final SiteAccessService siteAccessService;

    @PostMapping("/credentials")
    public ResponseEntity<IssuedAgentCredentialView> provision(
            @Valid @RequestBody AgentCredentialProvisionRequest request,
            Authentication authentication
    ) {
        var site = siteAccessService.requireSiteAccess(request.siteCode());
        IssuedAgentCredentialView issued = credentialService.provision(
                site, request, actorSubject(authentication)
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(issued);
    }

    @GetMapping("/{agentId}/credentials")
    public List<AgentCredentialView> list(@PathVariable String agentId) {
        requireAgentSite(agentId);
        return credentialService.list(agentId);
    }

    @PostMapping("/{agentId}/credentials/rotate")
    public ResponseEntity<IssuedAgentCredentialView> rotate(
            @PathVariable String agentId,
            @Valid @RequestBody AgentCredentialRotateRequest request,
            Authentication authentication
    ) {
        requireAgentSite(agentId);
        IssuedAgentCredentialView issued = credentialService.rotate(
                agentId, request, actorSubject(authentication)
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(issued);
    }

    @PostMapping("/{agentId}/credentials/{credentialId}/revoke")
    public AgentCredentialView revoke(
            @PathVariable String agentId,
            @PathVariable String credentialId,
            @Valid @RequestBody AgentCredentialRevokeRequest request,
            Authentication authentication
    ) {
        requireAgentSite(agentId);
        return credentialService.revoke(
                agentId, credentialId, actorSubject(authentication), request.reason()
        );
    }

    private void requireAgentSite(String agentId) {
        AgentCredentialService.AgentContext context = credentialService.context(agentId);
        siteAccessService.requireSiteAccess(context.siteId());
    }

    private String actorSubject(Authentication authentication) {
        if (authentication instanceof JwtAuthenticationToken jwt) {
            return jwt.getToken().getSubject();
        }
        return authentication == null ? null : authentication.getName();
    }
}
