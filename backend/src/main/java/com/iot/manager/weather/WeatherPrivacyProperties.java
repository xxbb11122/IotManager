package com.iot.manager.weather;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Secret used only to make persisted weather-configuration fingerprints non-reversible. */
@Component
@ConfigurationProperties(prefix = "iot.weather.privacy")
@Getter
@Setter
public class WeatherPrivacyProperties {

    private String fingerprintSecret = "local-development-weather-fingerprint-secret";
}
