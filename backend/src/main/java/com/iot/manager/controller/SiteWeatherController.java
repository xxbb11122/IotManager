package com.iot.manager.controller;

import com.iot.manager.dto.SiteWeatherForecastView;
import com.iot.manager.dto.SiteWeatherLocationRequest;
import com.iot.manager.dto.SiteWeatherSettingsRequest;
import com.iot.manager.dto.SiteWeatherSettingsView;
import com.iot.manager.dto.SiteWeatherView;
import com.iot.manager.weather.SiteWeatherService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/sites/{siteCode}")
@RequiredArgsConstructor
@Validated
public class SiteWeatherController {

    private final SiteWeatherService siteWeatherService;

    @GetMapping("/weather")
    public SiteWeatherView current(@PathVariable String siteCode) {
        return siteWeatherService.current(siteCode);
    }

    @GetMapping("/weather/forecast")
    public SiteWeatherForecastView forecast(
            @PathVariable String siteCode,
            @RequestParam(defaultValue = "24") @Min(0) @Max(24) int hours,
            @RequestParam(defaultValue = "7") @Min(0) @Max(7) int days
    ) {
        return siteWeatherService.forecast(siteCode, hours, days);
    }

    @GetMapping("/weather-settings")
    public SiteWeatherSettingsView settings(@PathVariable String siteCode) {
        return siteWeatherService.settings(siteCode);
    }

    @PutMapping("/weather-settings")
    public SiteWeatherSettingsView updateSettings(
            @PathVariable String siteCode, @Valid @RequestBody SiteWeatherSettingsRequest request
    ) {
        return siteWeatherService.updateSettings(siteCode, request);
    }

    @PostMapping("/weather/refresh")
    public ResponseEntity<SiteWeatherView> refresh(@PathVariable String siteCode) {
        return ResponseEntity.ok(siteWeatherService.refresh(siteCode));
    }

    @PostMapping("/weather/location")
    public ResponseEntity<SiteWeatherView> updateLocation(
            @PathVariable String siteCode, @Valid @RequestBody SiteWeatherLocationRequest request
    ) {
        return ResponseEntity.ok(siteWeatherService.updateLocationAndRefresh(siteCode, request));
    }
}
