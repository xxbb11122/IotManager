package com.iot.manager.controller;

import com.iot.manager.dto.CommandBatchRequest;
import com.iot.manager.dto.CommandBatchView;
import com.iot.manager.dto.DeviceCommandView;
import com.iot.manager.service.CommandBatchService;
import com.iot.manager.service.SiteAccessService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping({"/api/command-batches", "/api/v1/command-batches"})
@RequiredArgsConstructor
public class CommandBatchController {

    private final CommandBatchService batchService;
    private final SiteAccessService siteAccessService;

    @PostMapping
    public CommandBatchView create(@Valid @RequestBody CommandBatchRequest request) {
        siteAccessService.requireSiteAccess(request.siteCode());
        return batchService.create(request);
    }

    @GetMapping
    public List<CommandBatchView> list(@RequestParam(required = false) String siteCode) {
        if (siteCode != null && !siteCode.isBlank()) {
            siteAccessService.requireSiteAccess(siteCode);
            return batchService.list(siteCode);
        }
        if (!siteAccessService.isScopeEnforced()) {
            return batchService.list("demo-site");
        }
        return siteAccessService.accessibleSiteCodes().stream()
                .flatMap(code -> batchService.list(code).stream())
                .toList();
    }

    @GetMapping("/{batchId}")
    public CommandBatchView get(@PathVariable String batchId) {
        siteAccessService.requireBatchAccess(batchId);
        return batchService.get(batchId);
    }

    @GetMapping("/{batchId}/commands")
    public List<DeviceCommandView> commands(@PathVariable String batchId) {
        siteAccessService.requireBatchAccess(batchId);
        return batchService.commands(batchId);
    }
}
