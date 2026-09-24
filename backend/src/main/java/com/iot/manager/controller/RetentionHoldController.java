package com.iot.manager.controller;

import com.iot.manager.dto.RetentionHoldRequest;
import com.iot.manager.dto.RetentionHoldView;
import com.iot.manager.service.RetentionHoldService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** Holds affect irreversible deletion and are intentionally owner/admin-only. */
@RestController
@RequestMapping("/api/v1/retention/holds")
@RequiredArgsConstructor
@PreAuthorize("hasAnyRole('OWNER', 'ADMIN')")
public class RetentionHoldController {

    private final RetentionHoldService retentionHoldService;

    @GetMapping
    public List<RetentionHoldView> list(@RequestParam(defaultValue = "true") boolean activeOnly) {
        return retentionHoldService.list(activeOnly);
    }

    @PostMapping
    public ResponseEntity<RetentionHoldView> create(@Valid @RequestBody RetentionHoldRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(retentionHoldService.create(request));
    }

    @PostMapping("/{id}/release")
    public RetentionHoldView release(@PathVariable Long id, @RequestBody(required = false) Map<String, String> body) {
        return retentionHoldService.release(id, body == null ? null : body.get("reason"));
    }
}
