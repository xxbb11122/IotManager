package com.iot.manager.controller;

import com.iot.manager.dto.DeviceGroupCreateRequest;
import com.iot.manager.dto.DeviceGroupMembersRequest;
import com.iot.manager.dto.DeviceGroupUpdateRequest;
import com.iot.manager.dto.DeviceGroupView;
import com.iot.manager.service.DeviceGroupService;
import com.iot.manager.service.SiteAccessService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping({"/api/device-groups", "/api/v1/device-groups"})
@RequiredArgsConstructor
public class DeviceGroupController {

    private final DeviceGroupService groupService;
    private final SiteAccessService siteAccessService;

    @GetMapping
    public List<DeviceGroupView> list(@RequestParam(required = false) String siteCode) {
        if (siteCode != null && !siteCode.isBlank()) {
            siteAccessService.requireSiteAccess(siteCode);
            return groupService.list(siteCode);
        }
        if (!siteAccessService.isScopeEnforced()) {
            return groupService.list(null);
        }
        return siteAccessService.accessibleSiteCodes().stream()
                .flatMap(code -> groupService.list(code).stream())
                .toList();
    }

    @GetMapping("/{groupId}")
    public DeviceGroupView get(@PathVariable String groupId) {
        siteAccessService.requireGroupAccess(groupId);
        return groupService.get(groupId);
    }

    @PostMapping
    public DeviceGroupView create(@Valid @RequestBody DeviceGroupCreateRequest request) {
        siteAccessService.requireSiteAccess(request.siteCode());
        return groupService.create(request);
    }

    @PatchMapping("/{groupId}")
    public DeviceGroupView update(
            @PathVariable String groupId,
            @Valid @RequestBody DeviceGroupUpdateRequest request
    ) {
        siteAccessService.requireGroupAccess(groupId);
        return groupService.update(groupId, request);
    }

    @PatchMapping("/{groupId}/members")
    public DeviceGroupView changeMembers(
            @PathVariable String groupId,
            @Valid @RequestBody DeviceGroupMembersRequest request
    ) {
        siteAccessService.requireGroupAccess(groupId);
        return groupService.changeMembers(groupId, request);
    }

    @PostMapping("/{groupId}/archive")
    public DeviceGroupView archive(@PathVariable String groupId) {
        siteAccessService.requireGroupAccess(groupId);
        return groupService.archive(groupId);
    }
}
