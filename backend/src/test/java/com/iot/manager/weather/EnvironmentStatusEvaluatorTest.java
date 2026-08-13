package com.iot.manager.weather;

import com.iot.manager.dto.EnvironmentIndicatorsView;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class EnvironmentStatusEvaluatorTest {

    private final EnvironmentStatusEvaluator evaluator = new EnvironmentStatusEvaluator(
            new DewPointCalculator(), new WeatherEnvironmentRules()
    );

    @Test
    void classifiesIdealValuesAsSuitableGreen() {
        EnvironmentIndicatorsView indicators = evaluator.evaluate(23D, 65, 1013D, null, false);

        assertThat(indicators.temperature().level()).isEqualTo("SUITABLE");
        assertThat(indicators.temperature().ideal()).isTrue();
        assertThat(indicators.humidity().level()).isEqualTo("SUITABLE");
        assertThat(indicators.pressure().level()).isEqualTo("SUITABLE");
        assertThat(indicators.pressure().ideal()).isTrue();
        assertThat(indicators.esdRisk().level()).isEqualTo("SUITABLE");
        assertThat(indicators.condensationRisk().level()).isEqualTo("NOT_CONFIGURED");
    }

    @Test
    void classifiesObserveAndRiskThresholdsFromTheConfirmedTable() {
        EnvironmentIndicatorsView observe = evaluator.evaluate(31D, 78, 850D, null, false);
        EnvironmentIndicatorsView risk = evaluator.evaluate(36D, 85, 790D, null, false);
        EnvironmentIndicatorsView dryRisk = evaluator.evaluate(23D, 19, 1013D, null, false);

        assertThat(observe.temperature().level()).isEqualTo("OBSERVE");
        assertThat(observe.humidity().level()).isEqualTo("OBSERVE");
        assertThat(observe.pressure().level()).isEqualTo("OBSERVE");
        assertThat(risk.temperature().level()).isEqualTo("RISK");
        assertThat(risk.humidity().level()).isEqualTo("RISK");
        assertThat(risk.pressure().level()).isEqualTo("RISK");
        assertThat(dryRisk.esdRisk().level()).isEqualTo("RISK");
    }

    @Test
    void calculatesCondensationFromConfiguredSurfaceTemperatureOnly() {
        EnvironmentIndicatorsView safe = evaluator.evaluate(24D, 60, 1013D, 32D, true);
        EnvironmentIndicatorsView risk = evaluator.evaluate(24D, 90, 1013D, 22D, true);

        assertThat(safe.condensationRisk().level()).isEqualTo("SUITABLE");
        assertThat(risk.condensationRisk().level()).isEqualTo("RISK");
    }
}
