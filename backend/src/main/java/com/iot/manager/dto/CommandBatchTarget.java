package com.iot.manager.dto;

import java.util.List;

public record CommandBatchTarget(
        String groupId,
        List<Long> deviceIds
) {
}
