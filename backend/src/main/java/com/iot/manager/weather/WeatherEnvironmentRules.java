package com.iot.manager.weather;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Versioned server-side thresholds. Clients receive evaluated levels only, so
 * Android, dashboard, and console cannot drift into different color rules.
 */
@Component
@ConfigurationProperties(prefix = "iot.weather.environment-rules")
@Getter
@Setter
public class WeatherEnvironmentRules {

    private double temperatureIdealMin = 20;
    private double temperatureIdealMax = 25;
    private double temperatureNormalMin = 18;
    private double temperatureNormalMax = 28;
    private double temperatureRiskHigh = 35;

    private int humidityIdealMin = 40;
    private int humidityIdealMax = 60;
    private int humidityNormalMin = 30;
    private int humidityNormalMax = 70;
    private int humidityRiskLow = 20;
    private int humidityRiskHigh = 80;

    private double pressureIdealMinKpa = 95;
    private double pressureIdealMaxKpa = 105;
    private double pressureNormalMinKpa = 90;
    private double pressureNormalMaxKpa = 110;
    private double pressureRiskLowKpa = 80;

    private int esdObserveHumidityPct = 30;
    private int esdRiskHumidityPct = 20;
    private double condensationObserveMarginC = 5;
    private double condensationRiskMarginC = 2;
}
