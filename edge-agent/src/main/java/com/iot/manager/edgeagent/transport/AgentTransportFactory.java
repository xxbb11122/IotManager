package com.iot.manager.edgeagent.transport;

import java.net.URI;

@FunctionalInterface
public interface AgentTransportFactory {
    AgentTransport create(URI endpoint);
}
