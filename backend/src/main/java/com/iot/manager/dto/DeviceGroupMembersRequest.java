package com.iot.manager.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

public record DeviceGroupMembersRequest(
        @NotNull Long expectedVersion,
        List<Long> addDeviceIds,
        List<Long> removeDeviceIds
) {
}
