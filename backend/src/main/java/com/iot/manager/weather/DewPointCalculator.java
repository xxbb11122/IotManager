package com.iot.manager.weather;

import org.springframework.stereotype.Component;

@Component
public class DewPointCalculator {

    /** Magnus approximation, adequate for operational risk classification. */
    public Double dewPointC(Double temperatureC, Integer relativeHumidityPct) {
        if (temperatureC == null || relativeHumidityPct == null
                || relativeHumidityPct <= 0 || relativeHumidityPct > 100) {
            return null;
        }
        double a = 17.62;
        double b = 243.12;
        double gamma = Math.log(relativeHumidityPct / 100.0) + (a * temperatureC) / (b + temperatureC);
        return (b * gamma) / (a - gamma);
    }
}
