package com.iot.manager.edgeagent.transport;

import com.iot.manager.edgeagent.protocol.AgentMessage;

import java.util.concurrent.CompletionStage;

/** Transport boundary so protocol/runtime tests never require a live WebSocket server. */
public interface AgentTransport extends AutoCloseable {
    CompletionStage<Void> connect(AgentTransportListener listener);

    CompletionStage<Void> send(AgentMessage message);

    boolean isConnected();

    @Override
    void close();
}
