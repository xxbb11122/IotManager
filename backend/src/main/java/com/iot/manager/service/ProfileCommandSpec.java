package com.iot.manager.service;

public record ProfileCommandSpec(String type, String stateField, Object stateValue) {
}
