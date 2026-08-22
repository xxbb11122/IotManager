package com.iot.manager.edgeagent.transport;

import com.iot.manager.edgeagent.protocol.AgentMessage;
import com.iot.manager.edgeagent.protocol.AgentProtocolCodec;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;

/** Java 17 WebSocket implementation. Reconnection policy belongs to AgentRuntime. */
public final class JdkWebSocketAgentTransport implements AgentTransport {
    private final HttpClient httpClient;
    private final URI endpoint;
    private final AgentProtocolCodec codec;
    private final String accessToken;
    private final String credentialId;
    private final String credentialToken;
    private volatile AgentTransportListener listener;
    private volatile WebSocket webSocket;

    public JdkWebSocketAgentTransport(HttpClient httpClient, URI endpoint, AgentProtocolCodec codec) {
        this(httpClient, endpoint, codec, null);
    }

    public JdkWebSocketAgentTransport(
            HttpClient httpClient, URI endpoint, AgentProtocolCodec codec, String accessToken
    ) {
        this(httpClient, endpoint, codec, accessToken, null, null);
    }

    public JdkWebSocketAgentTransport(
            HttpClient httpClient,
            URI endpoint,
            AgentProtocolCodec codec,
            String accessToken,
            String credentialId,
            String credentialToken
    ) {
        this.httpClient = Objects.requireNonNull(httpClient, "httpClient");
        this.endpoint = Objects.requireNonNull(endpoint, "endpoint");
        this.codec = Objects.requireNonNull(codec, "codec");
        this.accessToken = accessToken == null || accessToken.isBlank() ? null : accessToken.trim();
        this.credentialId = credentialId == null || credentialId.isBlank() ? null : credentialId.trim();
        this.credentialToken = credentialToken == null || credentialToken.isBlank() ? null : credentialToken.trim();
        if ((this.credentialId == null) != (this.credentialToken == null)) {
            throw new IllegalArgumentException("credentialId and credentialToken must be provided together");
        }
    }

    @Override
    public CompletionStage<Void> connect(AgentTransportListener listener) {
        if (this.listener != null || webSocket != null) {
            return CompletableFuture.failedFuture(new IllegalStateException("WebSocket transport is already connecting or connected"));
        }
        this.listener = Objects.requireNonNull(listener, "listener");
        WebSocket.Builder builder = httpClient.newWebSocketBuilder();
        if (accessToken != null) {
            builder.header("Authorization", "Bearer " + accessToken);
        }
        if (credentialId != null) {
            builder.header("X-Iot-Agent-Credential", credentialId);
            builder.header("X-Iot-Agent-Token", credentialToken);
        }
        return builder
                .buildAsync(endpoint, new Listener())
                .thenApply(ignored -> null);
    }

    @Override
    public CompletionStage<Void> send(AgentMessage message) {
        WebSocket active = webSocket;
        if (active == null || active.isOutputClosed()) {
            return CompletableFuture.failedFuture(new IllegalStateException("WebSocket transport is not connected"));
        }
        return active.sendText(codec.encode(message), true).thenApply(ignored -> null);
    }

    @Override
    public boolean isConnected() {
        WebSocket active = webSocket;
        return active != null && !active.isInputClosed() && !active.isOutputClosed();
    }

    @Override
    public void close() {
        WebSocket active = webSocket;
        webSocket = null;
        if (active != null) {
            active.abort();
        }
    }

    private final class Listener implements WebSocket.Listener {
        private final StringBuilder textBuffer = new StringBuilder();

        @Override
        public void onOpen(WebSocket socket) {
            webSocket = socket;
            safely(() -> listener.onConnected());
            socket.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket socket, CharSequence data, boolean last) {
            textBuffer.append(data);
            if (last) {
                String message = textBuffer.toString();
                textBuffer.setLength(0);
                try {
                    safely(() -> listener.onMessage(codec.decode(message)));
                } catch (RuntimeException ignored) {
                    // safely has already reported the exception to the runtime listener.
                }
            }
            socket.request(1);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletionStage<?> onBinary(WebSocket socket, ByteBuffer data, boolean last) {
            safely(() -> listener.onError(new IllegalArgumentException("Edge protocol accepts text WebSocket frames only")));
            socket.request(1);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletionStage<?> onClose(WebSocket socket, int statusCode, String reason) {
            if (webSocket == socket) {
                webSocket = null;
            }
            safely(() -> listener.onClosed(statusCode, reason));
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public void onError(WebSocket socket, Throwable error) {
            if (webSocket == socket) {
                webSocket = null;
            }
            safely(() -> listener.onError(error));
        }

        private void safely(Runnable callback) {
            try {
                callback.run();
            } catch (RuntimeException callbackFailure) {
                AgentTransportListener activeListener = listener;
                if (activeListener != null) {
                    activeListener.onError(callbackFailure);
                }
            }
        }
    }
}
