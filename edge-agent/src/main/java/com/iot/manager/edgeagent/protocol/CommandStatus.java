package com.iot.manager.edgeagent.protocol;

/** Terminal states returned by the agent after a local device command attempt. */
public enum CommandStatus {
    ACKNOWLEDGED,
    FAILED,
    UNCONFIRMED,
    REJECTED
}
