package com.iot.manager.edgeagent.protocol;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

final class ProtocolValue {
    private ProtocolValue() {
    }

    static void common(int protocolVersion, UUID messageId, Instant sentAt) {
        if (protocolVersion < 1) {
            throw new IllegalArgumentException("protocolVersion must be positive");
        }
        Objects.requireNonNull(messageId, "messageId");
        Objects.requireNonNull(sentAt, "sentAt");
    }

    static String text(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value.trim();
    }

    static <T> List<T> list(List<T> value, String field) {
        return List.copyOf(Objects.requireNonNull(value, field));
    }

    static <K, V> Map<K, V> map(Map<K, V> value, String field) {
        return Map.copyOf(Objects.requireNonNull(value, field));
    }
}
