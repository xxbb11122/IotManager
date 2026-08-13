package com.iot.manager.edgeagent.runtime;

import com.iot.manager.edgeagent.config.AgentConfig;
import com.iot.manager.edgeagent.driver.DeviceCommand;
import com.iot.manager.edgeagent.driver.DeviceDriver;
import com.iot.manager.edgeagent.driver.DeviceDriverException;
import com.iot.manager.edgeagent.driver.DiscoveryContext;
import com.iot.manager.edgeagent.driver.DriverCommandResult;
import com.iot.manager.edgeagent.driver.DriverRegistry;
import com.iot.manager.edgeagent.identity.AgentIdentity;
import com.iot.manager.edgeagent.protocol.AgentMessage;
import com.iot.manager.edgeagent.protocol.AgentProtocol;
import com.iot.manager.edgeagent.protocol.CommandRequest;
import com.iot.manager.edgeagent.protocol.CommandResult;
import com.iot.manager.edgeagent.protocol.DiscoveredDevice;
import com.iot.manager.edgeagent.transport.AgentTransport;
import com.iot.manager.edgeagent.transport.AgentTransportListener;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentRuntimeTest {
    @TempDir
    Path temporaryDirectory;

    @Test
    void executesOnePhysicalCommandForDuplicateCommandIds() throws Exception {
        CountingDriver driver = new CountingDriver();
        FakeTransport transport = new FakeTransport();
        AgentRuntime runtime = new AgentRuntime(
                config(),
                new AgentIdentity(UUID.randomUUID(), Instant.parse("2026-08-03T10:00:00Z")),
                new DriverRegistry(List.of(driver)),
                ignored -> transport
        );
        CommandRequest request = new CommandRequest(
                AgentProtocol.CURRENT_VERSION,
                UUID.randomUUID(),
                Instant.now(),
                "same-command", "fake:one", "fake-driver", URI.create("http://127.0.0.1"), "set_power", Map.of("on", true), null
        );

        try {
            runtime.start();
            runtime.onMessage(request);
            runtime.onMessage(request);

            assertTrue(driver.executed.await(2, TimeUnit.SECONDS));
            assertTrue(transport.commandResult.await(2, TimeUnit.SECONDS));
            assertEquals(1, driver.executeCount.get());
        } finally {
            runtime.close();
        }
    }

    private AgentConfig config() {
        return new AgentConfig(
                "test-agent", "demo-site", temporaryDirectory.resolve("identity.json"), URI.create("ws://localhost:8080/ws/edge/v1"),
                Duration.ofSeconds(30), Duration.ofSeconds(30), Duration.ofMillis(10), Duration.ofSeconds(1), List.of()
        );
    }

    private static final class CountingDriver implements DeviceDriver {
        private final AtomicInteger executeCount = new AtomicInteger();
        private final CountDownLatch executed = new CountDownLatch(1);

        @Override
        public String driverId() {
            return "fake-driver";
        }

        @Override
        public String driverVersion() {
            return "test";
        }

        @Override
        public Set<String> supportedProfileIds() {
            return Set.of("fake-v1");
        }

        @Override
        public List<DiscoveredDevice> discover(DiscoveryContext context) {
            return List.of();
        }

        @Override
        public DriverCommandResult execute(DeviceCommand command) throws DeviceDriverException {
            executeCount.incrementAndGet();
            executed.countDown();
            return DriverCommandResult.acknowledged(Map.of("power", true));
        }
    }

    private static final class FakeTransport implements AgentTransport {
        private final List<AgentMessage> sent = new CopyOnWriteArrayList<>();
        private final CountDownLatch commandResult = new CountDownLatch(1);
        private volatile boolean connected;

        @Override
        public CompletionStage<Void> connect(AgentTransportListener listener) {
            connected = true;
            listener.onConnected();
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletionStage<Void> send(AgentMessage message) {
            sent.add(message);
            if (message instanceof CommandResult) {
                commandResult.countDown();
            }
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public boolean isConnected() {
            return connected;
        }

        @Override
        public void close() {
            connected = false;
        }
    }
}
