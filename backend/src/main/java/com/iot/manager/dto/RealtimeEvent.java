package com.iot.manager.dto;

public record RealtimeEvent(
        String type,
        Object payload,
        long timestamp,
        int version
) {

    public static final int VERSION = 1;

}
