package com.iot.manager.service;

public class GroupVersionConflictException extends RuntimeException {
    public GroupVersionConflictException(String message) {
        super(message);
    }
}
