package com.iot.manager.ai;

import org.springframework.http.HttpStatus;

public class AiException extends RuntimeException {
    private final HttpStatus status;
    private final long retryAfterSeconds;
    private final String code;

    public AiException(HttpStatus status, String message) {
        this(status, message, 0);
    }

    public AiException(HttpStatus status, String message, long retryAfterSeconds) {
        this(status, "AI_ERROR", message, retryAfterSeconds);
    }

    public AiException(HttpStatus status, String code, String message, long retryAfterSeconds) {
        super(message);
        this.status = status;
        this.retryAfterSeconds = retryAfterSeconds;
        this.code = code;
    }

    public HttpStatus getStatus() { return status; }
    public long getRetryAfterSeconds() { return retryAfterSeconds; }
    public String getCode() { return code; }
}
