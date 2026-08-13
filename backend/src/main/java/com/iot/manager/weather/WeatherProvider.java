package com.iot.manager.weather;

import com.iot.manager.entity.SiteWeatherSettings;

public interface WeatherProvider {

    boolean supports(String providerCode);

    WeatherPayload fetch(SiteWeatherSettings settings);
}
