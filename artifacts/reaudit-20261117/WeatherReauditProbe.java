import com.iot.manager.entity.*;
import com.iot.manager.repository.*;
import com.iot.manager.weather.*;
import tools.jackson.databind.ObjectMapper;
import org.mockito.MockitoAnnotations;
import java.lang.reflect.*;
import java.time.*;
import java.util.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Read-only diagnostic using the production service and existing test fixtures. */
public class WeatherReauditProbe {
    static Object fixture;
    static Class<?> fixtureClass;
    static Object call(String method, Class<?>[] types, Object... args) throws Exception {
        Method target = fixtureClass.getDeclaredMethod(method, types);
        target.setAccessible(true);
        return target.invoke(fixture, args);
    }
    static <T> T field(String name, Class<T> type) throws Exception {
        Field target = fixtureClass.getDeclaredField(name);
        target.setAccessible(true);
        return type.cast(target.get(fixture));
    }
    public static void main(String[] args) throws Exception {
        fixtureClass = Class.forName("com.iot.manager.weather.SiteWeatherServiceTest");
        Constructor<?> constructor = fixtureClass.getDeclaredConstructor();
        constructor.setAccessible(true);
        fixture = constructor.newInstance();
        try (AutoCloseable ignored = MockitoAnnotations.openMocks(fixture)) {
            Instant now = Instant.parse("2026-11-17T00:00:00Z");
            Site site = Site.builder().id(7L).code("site-a").build();
            Device device = (Device) call("temperatureDevice", new Class<?>[]{Site.class}, site);
            SiteWeatherSettings setting = (SiteWeatherSettings) call("settings",
                    new Class<?>[]{Site.class, double.class, double.class}, site, 22.5, 114.0);
            setting.setCondensationTemperatureDevice(device);
            DeviceProfile profile = (DeviceProfile) call("temperatureProfile", new Class<?>[]{});
            SiteWeatherSnapshot snapshot = SiteWeatherSnapshot.builder().providerCode("OPEN_METEO")
                    .fetchedAt(now).weatherCode(0).conditionText("Clear").temperatureC(24D)
                    .relativeHumidityPct(50).surfacePressureHpa(1000D).build();
            DeviceTelemetrySample sample = DeviceTelemetrySample.builder().device(device)
                    .receivedAt(now.minusSeconds(1)).observedAt(now.minusSeconds(1))
                    .observedTimeTrust(ObservedTimeTrust.TRUSTED).stateJson("{\"temperature\":24}").build();
            when(field("settingsRepository", SiteWeatherSettingsRepository.class).findBySiteId(7L)).thenReturn(Optional.of(setting));
            when(field("snapshotRepository", SiteWeatherSnapshotRepository.class)
                    .findTopBySiteIdAndConfigurationFingerprintOrderByFetchedAtDesc(eq(7L), anyString())).thenReturn(Optional.of(snapshot));
            when(field("deviceProfileRepository", DeviceProfileRepository.class)
                    .findByProfileIdAndProfileVersion("temperature-v1", 1)).thenReturn(Optional.of(profile));
            when(field("telemetrySampleRepository", DeviceTelemetrySampleRepository.class)
                    .findTopByDeviceIdAndReceivedAtIsNotNullOrderByReceivedAtDesc(8L)).thenReturn(Optional.of(sample));
            SiteWeatherService service = (SiteWeatherService) call("service", new Class<?>[]{List.class, Clock.class},
                    List.of(), Clock.fixed(now, ZoneOffset.UTC));
            Map<String, Object> findings = new LinkedHashMap<>();
            findings.put("fresh", service.current(site));
            snapshot.setFetchedAt(now.minusSeconds(7 * 60 * 60));
            findings.put("expiredWeather", service.current(site));
            setting.setEnabled(false);
            findings.put("disabledWeather", service.current(site));
            setting.setEnabled(true);
            snapshot.setFetchedAt(now);
            SiteWeatherService later = (SiteWeatherService) call("service", new Class<?>[]{List.class, Clock.class},
                    List.of(), Clock.fixed(now.plusSeconds(301), ZoneOffset.UTC));
            findings.put("sourceExpiredOnNextRead", later.current(site));
            System.out.println(new ObjectMapper().writeValueAsString(findings));
        }
    }
}
