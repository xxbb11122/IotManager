package com.iot.manager.weather;

/** Raised when a user-triggered weather refresh would repeat within one minute. */
public class WeatherRefreshRateLimitedException extends RuntimeException {

    public WeatherRefreshRateLimitedException(long remainingSeconds) {
        super("天气刚刚已刷新，请 " + Math.max(1, remainingSeconds) + " 秒后再试。");
    }
}
