package com.iot.manager.edgeagent.protocol;

/** Indicates invalid or unsupported data received on the edge WebSocket. */
public final class ProtocolException extends IllegalArgumentException {
    public ProtocolException(String message) {
        super(message);
    }

    public ProtocolException(String message, Throwable cause) {
        super(message, cause);
    }
}
