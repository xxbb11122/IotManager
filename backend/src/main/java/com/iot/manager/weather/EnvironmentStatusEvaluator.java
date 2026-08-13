package com.iot.manager.weather;

import com.iot.manager.dto.EnvironmentIndicatorsView;
import org.springframework.stereotype.Component;

@Component
public class EnvironmentStatusEvaluator {

    private final DewPointCalculator dewPointCalculator;
    private final WeatherEnvironmentRules rules;

    public EnvironmentStatusEvaluator(DewPointCalculator dewPointCalculator, WeatherEnvironmentRules rules) {
        this.dewPointCalculator = dewPointCalculator;
        this.rules = rules;
    }

    public EnvironmentIndicatorsView evaluate(
            Double temperatureC,
            Integer humidityPct,
            Double pressureHpa,
            Double surfaceTemperatureC,
            boolean condensationConfigured
    ) {
        return new EnvironmentIndicatorsView(
                temperature(temperatureC),
                humidity(humidityPct),
                pressure(pressureHpa),
                esd(humidityPct),
                condensation(temperatureC, humidityPct, surfaceTemperatureC, condensationConfigured)
        );
    }

    private EnvironmentIndicator temperature(Double value) {
        if (value == null) return EnvironmentIndicator.unavailable("不可用", "未取得温度数据");
        if (value >= rules.getTemperatureRiskHigh()) return risk("温度风险", "温度不低于 " + rules.getTemperatureRiskHigh() + "°C");
        if (value < rules.getTemperatureNormalMin() || value > rules.getTemperatureNormalMax()) {
            return observe("观察", value < rules.getTemperatureNormalMin()
                    ? "温度低于 " + rules.getTemperatureNormalMin() + "°C"
                    : "温度高于 " + rules.getTemperatureNormalMax() + "°C");
        }
        return suitable(value >= rules.getTemperatureIdealMin() && value <= rules.getTemperatureIdealMax(), value >= rules.getTemperatureIdealMin() && value <= rules.getTemperatureIdealMax()
                ? "20–25°C 为理想范围" : "18–28°C 为正常范围");
    }

    private EnvironmentIndicator humidity(Integer value) {
        if (value == null) return EnvironmentIndicator.unavailable("不可用", "未取得湿度数据");
        if (value < rules.getHumidityRiskLow() || value > rules.getHumidityRiskHigh()) return risk("湿度风险", value < rules.getHumidityRiskLow() ? "湿度低于 " + rules.getHumidityRiskLow() + "%" : "湿度高于 " + rules.getHumidityRiskHigh() + "%");
        if (value < rules.getHumidityNormalMin() || value > rules.getHumidityNormalMax()) return observe("观察", value < rules.getHumidityNormalMin() ? "湿度低于 " + rules.getHumidityNormalMin() + "%" : "湿度高于 " + rules.getHumidityNormalMax() + "%");
        return suitable(value >= rules.getHumidityIdealMin() && value <= rules.getHumidityIdealMax(), value >= rules.getHumidityIdealMin() && value <= rules.getHumidityIdealMax()
                ? "40–60% 为理想范围" : "30–70% 为正常范围");
    }

    private EnvironmentIndicator pressure(Double hpa) {
        if (hpa == null) return EnvironmentIndicator.unavailable("不可用", "未取得气压数据");
        double kpa = hpa / 10.0;
        if (kpa < rules.getPressureRiskLowKpa()) return risk("气压偏低", "气压低于 " + rules.getPressureRiskLowKpa() + " kPa");
        if (kpa < rules.getPressureNormalMinKpa() || kpa > rules.getPressureNormalMaxKpa()) return observe("观察", kpa < rules.getPressureNormalMinKpa() ? "气压低于 " + rules.getPressureNormalMinKpa() + " kPa" : "气压高于 " + rules.getPressureNormalMaxKpa() + " kPa");
        return suitable(kpa >= rules.getPressureIdealMinKpa() && kpa <= rules.getPressureIdealMaxKpa(), kpa >= rules.getPressureIdealMinKpa() && kpa <= rules.getPressureIdealMaxKpa()
                ? "95–105 kPa 为理想范围" : "90–110 kPa 为正常范围");
    }

    private EnvironmentIndicator esd(Integer humidityPct) {
        if (humidityPct == null) return EnvironmentIndicator.unavailable("不可用", "未取得湿度数据，无法评估 ESD");
        if (humidityPct < rules.getEsdRiskHumidityPct()) return risk("高", "相对湿度低于 " + rules.getEsdRiskHumidityPct() + "%，ESD 风险很高");
        if (humidityPct < rules.getEsdObserveHumidityPct()) return observe("增加", "相对湿度低于 " + rules.getEsdObserveHumidityPct() + "%，ESD 风险开始增加");
        return suitable(false, "相对湿度不低于 " + rules.getEsdObserveHumidityPct() + "%，ESD 风险低");
    }

    private EnvironmentIndicator condensation(
            Double temperatureC, Integer humidityPct, Double surfaceTemperatureC, boolean configured
    ) {
        if (!configured) return EnvironmentIndicator.notConfigured("未配置站点温度遥测来源");
        Double dewPoint = dewPointCalculator.dewPointC(temperatureC, humidityPct);
        if (dewPoint == null || surfaceTemperatureC == null) {
            return EnvironmentIndicator.unavailable("不可用", "无法取得结露计算所需温湿度");
        }
        double margin = surfaceTemperatureC - dewPoint;
        if (margin <= rules.getCondensationRiskMarginC()) return risk("高", String.format("表面温度距露点 %.1f°C", margin));
        if (margin <= rules.getCondensationObserveMarginC() || humidityPct > rules.getHumidityNormalMax()) {
            return observe("注意", margin <= rules.getCondensationObserveMarginC()
                    ? String.format("表面温度距露点 %.1f°C", margin)
                    : "湿度高于 70%，结露风险增加");
        }
        return suitable(false, String.format("表面温度距露点 %.1f°C", margin));
    }

    private EnvironmentIndicator suitable(boolean ideal, String reason) {
        return new EnvironmentIndicator("SUITABLE", "适宜", ideal, reason);
    }

    private EnvironmentIndicator observe(String label, String reason) {
        return new EnvironmentIndicator("OBSERVE", label, false, reason);
    }

    private EnvironmentIndicator risk(String label, String reason) {
        return new EnvironmentIndicator("RISK", label, false, reason);
    }
}
