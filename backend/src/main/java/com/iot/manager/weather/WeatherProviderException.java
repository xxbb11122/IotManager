package com.iot.manager.weather;

/** Signals that an upstream weather response was unavailable or failed validation. */
public class WeatherProviderException extends RuntimeException {

    public WeatherProviderException(String message) {
        super(message);
    }

    public WeatherProviderException(String message, Throwable cause) {
        super(message, cause);
    }
}
