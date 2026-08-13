package com.iot.manager.controller;

import com.iot.manager.dto.DeviceProfileView;
import com.iot.manager.service.DeviceProfileService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/device-profiles")
@RequiredArgsConstructor
public class DeviceProfileController {

    private final DeviceProfileService profileService;

    @GetMapping
    public List<DeviceProfileView> list() {
        return profileService.listEnabled();
    }

    @GetMapping("/{profileId}")
    public DeviceProfileView get(
            @PathVariable String profileId,
            @RequestParam(defaultValue = "1") Integer version
    ) {
        return profileService.get(profileId, version);
    }
}
