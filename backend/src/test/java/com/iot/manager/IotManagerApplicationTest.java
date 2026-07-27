package com.iot.manager;

import com.iot.manager.repository.AlertRepository;
import com.iot.manager.repository.DeviceRepository;
import com.iot.manager.service.DeviceSimulator;
import com.iot.manager.service.WebSocketService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

@SpringBootTest
@ActiveProfiles("test")
class IotManagerApplicationTest {

    private final ApplicationContextRunner simulatorContext = new ApplicationContextRunner()
            .withBean(DeviceRepository.class, () -> mock(DeviceRepository.class))
            .withBean(AlertRepository.class, () -> mock(AlertRepository.class))
            .withBean(WebSocketService.class, () -> mock(WebSocketService.class))
            .withUserConfiguration(SimulatorConfiguration.class);

    @Autowired
    private ApplicationContext applicationContext;

    @Test
    void contextLoadsWithTestProfile() {
        assertThat(applicationContext.getBeansOfType(DeviceSimulator.class)).isEmpty();
    }

    @Test
    void simulatorIsAbsentWhenDisabled() {
        simulatorContext.withPropertyValues("iot.simulator.enabled=false")
                .run(context -> assertThat(context).doesNotHaveBean(DeviceSimulator.class));
    }

    @Test
    void simulatorRequiresExplicitOptIn() {
        simulatorContext.run(context -> assertThat(context).doesNotHaveBean(DeviceSimulator.class));
    }

    @TestConfiguration(proxyBeanMethods = false)
    @Import(DeviceSimulator.class)
    static class SimulatorConfiguration {
    }
}
