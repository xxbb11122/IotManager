package com.iot.manager.weather;

import org.springframework.stereotype.Component;

@Component
public class WeatherCodeMapper {

    public WeatherCondition map(Integer weatherCode) {
        if (weatherCode == null) {
            return new WeatherCondition("UNKNOWN", "未知", "cloud");
        }
        return switch (weatherCode) {
            case 0 -> new WeatherCondition("CLEAR", "晴", "sun");
            case 1 -> new WeatherCondition("MAINLY_CLEAR", "晴间多云", "sun-cloud");
            case 2 -> new WeatherCondition("PARTLY_CLOUDY", "多云", "sun-cloud");
            case 3 -> new WeatherCondition("OVERCAST", "阴", "cloud");
            case 45, 48 -> new WeatherCondition("FOG", "雾", "fog");
            case 51, 53, 55, 56, 57 -> new WeatherCondition("DRIZZLE", "毛毛雨", "drizzle");
            case 61, 63, 65, 66, 67, 80, 81, 82 -> new WeatherCondition("RAIN", "雨", "rain");
            case 71, 73, 75, 77, 85, 86 -> new WeatherCondition("SNOW", "雪", "snow");
            case 95, 96, 99 -> new WeatherCondition("THUNDERSTORM", "雷暴", "thunderstorm");
            default -> new WeatherCondition("UNKNOWN", "未知", "cloud");
        };
    }
}
