package com.iot.manager.entity;

/**
 * Trust level for a source-supplied event timestamp.  It intentionally says
 * nothing about transport availability; online/offline decisions use the
 * platform receive time instead.
 */
public enum ObservedTimeTrust {
    TRUSTED,
    SKEWED,
    UNKNOWN,
    LEGACY_UNKNOWN
}
