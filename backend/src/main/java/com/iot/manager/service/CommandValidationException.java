package com.iot.manager.service;

import java.util.LinkedHashMap;
import java.util.Map;

public class CommandValidationException extends RuntimeException {

    private final Map<String, String> fieldErrors;

    public CommandValidationException(Map<String, String> fieldErrors) {
        super("Command validation failed");
        this.fieldErrors = Map.copyOf(new LinkedHashMap<>(fieldErrors));
    }

    public Map<String, String> getFieldErrors() {
        return fieldErrors;
    }
}
