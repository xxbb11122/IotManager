package com.iot.manager.websocket;

import com.iot.manager.service.WebSocketService;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class DeviceWebSocketHandlerTest {

    @Test
    void advertisesOnlyTheNonSecretBrowserSubprotocol() {
        DeviceWebSocketHandler handler = new DeviceWebSocketHandler(mock(WebSocketService.class));

        assertThat(handler.getSubProtocols())
                .containsExactly(DeviceWebSocketHandler.BROWSER_SUBPROTOCOL)
                .doesNotContain("iot-bearer.example-token");
    }
}
