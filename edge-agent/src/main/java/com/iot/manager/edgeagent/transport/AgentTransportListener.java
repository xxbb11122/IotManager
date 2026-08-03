package com.iot.manager.edgeagent.transport;

import com.iot.manager.edgeagent.protocol.AgentMessage;

public interface AgentTransportListener {
    void onConnected();

    void onMessage(AgentMessage message);

    void onClosed(int statusCode, String reason);

    void onError(Throwable error);
}
