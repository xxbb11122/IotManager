package com.iot.manager.weather;

public class WeatherRefreshInProgressException extends RuntimeException {
    public WeatherRefreshInProgressException() {
        super("Weather refresh is already in progress for this site");
    }
}
