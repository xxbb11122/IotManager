package com.iot.manager.edgeagent.driver.shelly;

import com.iot.manager.edgeagent.driver.DeviceCommand;
import com.iot.manager.edgeagent.driver.DiscoveryContext;
import com.iot.manager.edgeagent.driver.DriverCommandResult;
import com.iot.manager.edgeagent.protocol.CommandStatus;
import com.iot.manager.edgeagent.protocol.DiscoveredDevice;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ShellyPlusPlugSDriverTest {
    private final AtomicBoolean power = new AtomicBoolean(false);
    private HttpServer server;
    private URI endpoint;

    @BeforeEach
    void startShellyRpcServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/rpc/Shelly.GetDeviceInfo", exchange -> respond(exchange, 200,
                "{\"id\":\"shellyplusplugs-aabbccddeeff\",\"mac\":\"AA:BB:CC:DD:EE:FF\",\"model\":\"SPSW-104PE16EU\",\"gen\":2,\"app\":\"PlusPlugS\"}"));
        server.createContext("/rpc/Switch.Set", exchange -> {
            power.set(Boolean.parseBoolean(query(exchange).get("on")));
            respond(exchange, 200, "{\"was_on\":false}");
        });
        server.createContext("/rpc/Switch.GetStatus", exchange -> respond(exchange, 200,
                "{\"id\":0,\"output\":" + power.get() + ",\"voltage\":230.4,\"current\":0.2,\"apower\":42.1,\"aenergy\":{\"total\":123.5}}"));
        server.start();
        endpoint = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    void discoversAndControlsAPlusPlugSWithReadBackConfirmation() throws Exception {
        ShellyPlusPlugSDriver driver = new ShellyPlusPlugSDriver(
                new ShellyRpcClient(HttpClient.newHttpClient()), Duration.ofSeconds(2)
        );
        List<DiscoveredDevice> devices = driver.discover(new DiscoveryContext(
                "demo-site",
                Map.of(ShellyPlusPlugSDriver.DRIVER_ID, List.of(endpoint)),
                Duration.ofSeconds(2)
        ));

        assertEquals(1, devices.size());
        DiscoveredDevice device = devices.get(0);
        assertEquals("shelly-plus-plug-s-rpc-v1", device.driverId());
        assertEquals("shelly-plus-plug-s-v1", device.profileId());
        assertEquals("shelly:AABBCCDDEEFF", device.deviceKey());
        assertEquals(false, device.reportedState().get("power"));

        DriverCommandResult result = driver.execute(new DeviceCommand(
                "command-1", device.deviceKey(), endpoint, "set_power", Map.of("on", true)
        ));

        assertEquals(CommandStatus.ACKNOWLEDGED, result.status());
        assertEquals(true, result.reportedState().get("power"));
        assertEquals(42.1, ((Number) result.reportedState().get("powerWatts")).doubleValue());
    }

    @Test
    void skipsAReachableNonShellyPlusPlugSeed() throws Exception {
        server.removeContext("/rpc/Shelly.GetDeviceInfo");
        server.createContext("/rpc/Shelly.GetDeviceInfo", exchange -> respond(exchange, 200,
                "{\"mac\":\"AA:BB:CC:DD:EE:FF\",\"model\":\"SHSW-1\",\"gen\":1}"));
        ShellyPlusPlugSDriver driver = new ShellyPlusPlugSDriver(new ShellyRpcClient(HttpClient.newHttpClient()));

        List<DiscoveredDevice> devices = driver.discover(new DiscoveryContext(
                "demo-site", Map.of(ShellyPlusPlugSDriver.DRIVER_ID, List.of(endpoint)), Duration.ofSeconds(2)
        ));

        assertTrue(devices.isEmpty());
    }

    private static Map<String, String> query(HttpExchange exchange) {
        Map<String, String> values = new LinkedHashMap<>();
        String raw = exchange.getRequestURI().getRawQuery();
        if (raw == null || raw.isBlank()) {
            return values;
        }
        for (String pair : raw.split("&")) {
            String[] parts = pair.split("=", 2);
            values.put(
                    URLDecoder.decode(parts[0], StandardCharsets.UTF_8),
                    parts.length == 2 ? URLDecoder.decode(parts[1], StandardCharsets.UTF_8) : ""
            );
        }
        return values;
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }
}
