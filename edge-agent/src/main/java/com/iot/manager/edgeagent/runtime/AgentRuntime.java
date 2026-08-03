package com.iot.manager.edgeagent.runtime;

import com.iot.manager.edgeagent.config.AgentConfig;
import com.iot.manager.edgeagent.driver.DeviceCommand;
import com.iot.manager.edgeagent.driver.DeviceDriver;
import com.iot.manager.edgeagent.driver.DeviceDriverException;
import com.iot.manager.edgeagent.driver.DiscoveryContext;
import com.iot.manager.edgeagent.driver.DriverCommandResult;
import com.iot.manager.edgeagent.driver.DriverRegistry;
import com.iot.manager.edgeagent.driver.shelly.ShellyPlusPlugSDriver;
import com.iot.manager.edgeagent.identity.AgentIdentity;
import com.iot.manager.edgeagent.protocol.AgentDescriptor;
import com.iot.manager.edgeagent.protocol.AgentHeartbeat;
import com.iot.manager.edgeagent.protocol.AgentHello;
import com.iot.manager.edgeagent.protocol.AgentMessage;
import com.iot.manager.edgeagent.protocol.AgentProtocol;
import com.iot.manager.edgeagent.protocol.CommandRequest;
import com.iot.manager.edgeagent.protocol.CommandResult;
import com.iot.manager.edgeagent.protocol.CommandStatus;
import com.iot.manager.edgeagent.protocol.DiscoveredDevice;
import com.iot.manager.edgeagent.protocol.DiscoverySnapshot;
import com.iot.manager.edgeagent.transport.AgentTransport;
import com.iot.manager.edgeagent.transport.AgentTransportFactory;
import com.iot.manager.edgeagent.transport.AgentTransportListener;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Coordinates drivers and an outbound WebSocket. It deliberately never retries
 * an already issued physical command while its bounded local result cache retains the ID.
 */
public final class AgentRuntime implements AgentTransportListener, AutoCloseable {
    private static final Logger LOGGER = Logger.getLogger(AgentRuntime.class.getName());
    private static final int COMMAND_RESULT_CACHE_LIMIT = 10_000;
    private static final String SOFTWARE_VERSION = AgentRuntime.class.getPackage().getImplementationVersion() == null
            ? "0.1.0-SNAPSHOT"
            : AgentRuntime.class.getPackage().getImplementationVersion();

    private final AgentConfig config;
    private final AgentIdentity identity;
    private final DriverRegistry drivers;
    private final AgentTransportFactory transportFactory;
    private final Clock clock;
    private final ScheduledExecutorService scheduler;
    private final AtomicBoolean closed = new AtomicBoolean();
    private final AtomicBoolean reconnectScheduled = new AtomicBoolean();
    private final Map<String, CommandResult> completedCommands = new ConcurrentHashMap<>();
    private final Set<String> inFlightCommands = ConcurrentHashMap.newKeySet();
    private final ConcurrentLinkedDeque<String> completedCommandOrder = new ConcurrentLinkedDeque<>();
    private volatile AgentTransport transport;

    public AgentRuntime(AgentConfig config, AgentIdentity identity, DriverRegistry drivers, AgentTransportFactory transportFactory) {
        this(config, identity, drivers, transportFactory, Clock.systemUTC());
    }

    AgentRuntime(AgentConfig config, AgentIdentity identity, DriverRegistry drivers, AgentTransportFactory transportFactory, Clock clock) {
        this.config = config;
        this.identity = identity;
        this.drivers = drivers;
        this.transportFactory = transportFactory;
        this.clock = clock;
        this.scheduler = Executors.newScheduledThreadPool(2, runnable -> {
            Thread thread = new Thread(runnable, "iot-edge-agent");
            thread.setDaemon(true);
            return thread;
        });
    }

    public void start() {
        if (closed.get()) {
            throw new IllegalStateException("Agent runtime is closed");
        }
        connect();
        scheduler.scheduleAtFixedRate(this::publishHeartbeatSafely,
                config.heartbeatInterval().toSeconds(), config.heartbeatInterval().toSeconds(), TimeUnit.SECONDS);
        scheduler.scheduleAtFixedRate(this::publishDiscoverySafely,
                0, config.discoveryInterval().toSeconds(), TimeUnit.SECONDS);
    }

    @Override
    public void onConnected() {
        reconnectScheduled.set(false);
        send(new AgentHello(
                AgentProtocol.CURRENT_VERSION,
                UUID.randomUUID(),
                now(),
                new AgentDescriptor(identity.agentId(), config.agentName(), config.siteCode(), SOFTWARE_VERSION),
                drivers.descriptors()
        ));
        scheduler.execute(this::publishDiscoverySafely);
    }

    @Override
    public void onMessage(AgentMessage message) {
        if (message instanceof CommandRequest request) {
            scheduler.execute(() -> executeCommand(request));
        } else {
            LOGGER.fine(() -> "Ignoring unexpected server edge message " + message.type());
        }
    }

    @Override
    public void onClosed(int statusCode, String reason) {
        LOGGER.info(() -> "Edge WebSocket closed " + statusCode + ": " + reason);
        scheduleReconnect();
    }

    @Override
    public void onError(Throwable error) {
        LOGGER.log(Level.WARNING, "Edge WebSocket error", error);
        scheduleReconnect();
    }

    private void connect() {
        if (closed.get()) {
            return;
        }
        AgentTransport active = transport;
        if (active != null && active.isConnected()) {
            return;
        }
        AgentTransport next = transportFactory.create(config.backendWebSocketUri());
        transport = next;
        next.connect(this).whenComplete((ignored, error) -> {
            if (error != null) {
                LOGGER.log(Level.WARNING, "Could not connect edge agent to " + config.backendWebSocketUri(), error);
                scheduleReconnect();
            }
        });
    }

    private void scheduleReconnect() {
        if (!closed.get() && reconnectScheduled.compareAndSet(false, true)) {
            scheduler.schedule(() -> {
                reconnectScheduled.set(false);
                connect();
            }, config.reconnectDelay().toMillis(), TimeUnit.MILLISECONDS);
        }
    }

    private void publishHeartbeatSafely() {
        try {
            send(new AgentHeartbeat(
                    AgentProtocol.CURRENT_VERSION,
                    UUID.randomUUID(),
                    now(),
                    "ONLINE",
                    Map.of("knownCommandResults", completedCommands.size(), "driverCount", drivers.all().size())
            ));
        } catch (RuntimeException exception) {
            LOGGER.log(Level.FINE, "Could not publish edge heartbeat", exception);
        }
    }

    private void publishDiscoverySafely() {
        try {
            List<DiscoveredDevice> devices = new ArrayList<>();
            DiscoveryContext context = new DiscoveryContext(
                    config.siteCode(),
                    Map.of(ShellyPlusPlugSDriver.DRIVER_ID, config.shellyEndpoints()),
                    config.requestTimeout()
            );
            for (DeviceDriver driver : drivers.all()) {
                devices.addAll(driver.discover(context));
            }
            send(new DiscoverySnapshot(AgentProtocol.CURRENT_VERSION, UUID.randomUUID(), now(), config.siteCode(), devices));
        } catch (RuntimeException exception) {
            LOGGER.log(Level.WARNING, "Could not publish edge discovery snapshot", exception);
        }
    }

    private void executeCommand(CommandRequest request) {
        CommandResult cached = completedCommands.get(request.commandId());
        if (cached != null) {
            send(cached);
            return;
        }
        if (!inFlightCommands.add(request.commandId())) {
            return;
        }

        try {
            // A command may have completed in the small window before this worker acquired the in-flight key.
            cached = completedCommands.get(request.commandId());
            if (cached != null) {
                send(cached);
                return;
            }
            CommandResult result;
            if (request.expiresAt() != null && request.expiresAt().isBefore(now())) {
                result = rejected(request, "COMMAND_EXPIRED", "The platform command expired before the agent received it");
            } else {
                try {
                    DeviceDriver driver = drivers.require(request.driverId());
                    DriverCommandResult outcome = driver.execute(new DeviceCommand(
                            request.commandId(), request.deviceKey(), request.endpoint(), request.command(), request.parameters()
                    ));
                    result = new CommandResult(
                            AgentProtocol.CURRENT_VERSION, UUID.randomUUID(), now(), request.commandId(), request.deviceKey(),
                            outcome.status(), outcome.reportedState(), outcome.errorCode(), outcome.errorMessage(), now()
                    );
                } catch (DeviceDriverException exception) {
                    result = new CommandResult(
                            AgentProtocol.CURRENT_VERSION, UUID.randomUUID(), now(), request.commandId(), request.deviceKey(),
                            exception.status(), Map.of(), exception.errorCode(), exception.getMessage(), now()
                    );
                } catch (RuntimeException exception) {
                    LOGGER.log(Level.WARNING, "Unexpected driver failure for command " + request.commandId(), exception);
                    result = new CommandResult(
                            AgentProtocol.CURRENT_VERSION, UUID.randomUUID(), now(), request.commandId(), request.deviceKey(),
                            CommandStatus.FAILED, Map.of(), "AGENT_UNEXPECTED_ERROR", exception.getMessage(), now()
                    );
                }
            }
            CommandResult firstResult = completedCommands.putIfAbsent(request.commandId(), result);
            CommandResult resultToSend = firstResult == null ? result : firstResult;
            if (firstResult == null) {
                rememberCompletedCommand(request.commandId());
            }
            send(resultToSend);
        } finally {
            inFlightCommands.remove(request.commandId());
        }
    }

    private void rememberCompletedCommand(String commandId) {
        completedCommandOrder.addLast(commandId);
        while (completedCommandOrder.size() > COMMAND_RESULT_CACHE_LIMIT) {
            String oldest = completedCommandOrder.pollFirst();
            if (oldest != null) {
                completedCommands.remove(oldest);
            }
        }
    }

    private CommandResult rejected(CommandRequest request, String code, String message) {
        return new CommandResult(
                AgentProtocol.CURRENT_VERSION, UUID.randomUUID(), now(), request.commandId(), request.deviceKey(),
                CommandStatus.REJECTED, Map.of(), code, message, now()
        );
    }

    private void send(AgentMessage message) {
        AgentTransport active = transport;
        if (active == null || !active.isConnected()) {
            return;
        }
        active.send(message).whenComplete((ignored, error) -> {
            if (error != null) {
                LOGGER.log(Level.FINE, "Could not send edge message " + message.type(), error);
                scheduleReconnect();
            }
        });
    }

    private Instant now() {
        return Instant.now(clock);
    }

    @Override
    public void close() {
        if (closed.compareAndSet(false, true)) {
            AgentTransport active = transport;
            if (active != null) {
                active.close();
            }
            scheduler.shutdownNow();
        }
    }
}
