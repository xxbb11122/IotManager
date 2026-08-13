package com.iot.manager.dto;

import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public record ApiProblem(
        Instant timestamp,
        int status,
        String error,
        String message,
        Map<String, String> fieldErrors
) {

    public ApiProblem {
        fieldErrors = fieldErrors == null || fieldErrors.isEmpty()
                ? Map.of()
                : Collections.unmodifiableMap(new LinkedHashMap<>(fieldErrors));
    }
}
