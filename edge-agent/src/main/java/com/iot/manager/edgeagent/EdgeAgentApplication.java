package com.iot.manager.edgeagent;

import com.iot.manager.edgeagent.config.AgentConfig;
import com.iot.manager.edgeagent.config.AgentConfigLoader;
import com.iot.manager.edgeagent.driver.DriverRegistry;
import com.iot.manager.edgeagent.driver.shelly.ShellyPlusPlugSDriver;
import com.iot.manager.edgeagent.driver.shelly.ShellyRpcClient;
import com.iot.manager.edgeagent.identity.AgentIdentity;
import com.iot.manager.edgeagent.identity.AgentIdentityStore;
import com.iot.manager.edgeagent.protocol.AgentProtocolCodec;
import com.iot.manager.edgeagent.runtime.AgentRuntime;
import com.iot.manager.edgeagent.transport.JdkWebSocketAgentTransport;

import java.net.http.HttpClient;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.logging.Logger;

/** Entry point for a site-installed edge agent. */
public final class EdgeAgentApplication {
    private static final Logger LOGGER = Logger.getLogger(EdgeAgentApplication.class.getName());

    private EdgeAgentApplication() {
    }

    public static void main(String[] args) throws Exception {
        AgentConfig config = AgentConfigLoader.load(configurationPath(args));
        AgentProtocolCodec codec = new AgentProtocolCodec();
        AgentIdentity identity = new AgentIdentityStore(codec.objectMapper()).loadOrCreate(config.identityFile());
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(config.requestTimeout())
                .build();
        DriverRegistry registry = new DriverRegistry(java.util.List.of(
                new ShellyPlusPlugSDriver(new ShellyRpcClient(httpClient), config.requestTimeout())
        ));
        AgentRuntime runtime = new AgentRuntime(
                config,
                identity,
                registry,
                endpoint -> new JdkWebSocketAgentTransport(httpClient, endpoint, codec)
        );
        CountDownLatch stopped = new CountDownLatch(1);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            runtime.close();
            stopped.countDown();
        }, "iot-edge-agent-shutdown"));

        LOGGER.info(() -> "Starting IoT edge agent " + identity.agentId() + " for site " + config.siteCode());
        runtime.start();
        stopped.await();
    }

    private static Path configurationPath(String[] args) {
        if (args.length == 2 && "--config".equals(args[0])) {
            return Path.of(args[1]);
        }
        if (args.length == 0) {
            String configured = System.getProperty("edge.agent.config");
            if (configured == null || configured.isBlank()) {
                configured = System.getenv("EDGE_AGENT_CONFIG");
            }
            return Path.of(configured == null || configured.isBlank() ? "edge-agent.properties" : configured);
        }
        throw new IllegalArgumentException("Usage: java -jar iot-edge-agent.jar --config <edge-agent.properties>");
    }
}
