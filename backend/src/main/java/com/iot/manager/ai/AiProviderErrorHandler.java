package com.iot.manager.ai;

import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.web.client.ResponseErrorHandler;

import java.io.IOException;
import java.net.URI;

final class AiProviderErrorHandler implements ResponseErrorHandler {
    @Override
    public boolean hasError(ClientHttpResponse response) throws IOException {
        return response.getStatusCode().isError();
    }

    @Override
    public void handleError(URI url, HttpMethod method, ClientHttpResponse response) throws IOException {
        int status = response.getStatusCode().value();
        if (status == 429) {
            throw new AiException(HttpStatus.SERVICE_UNAVAILABLE, "AI provider is temporarily rate limited", 30);
        }
        if (status == 503) {
            throw new AiException(HttpStatus.SERVICE_UNAVAILABLE, "AI provider is temporarily unavailable", 30);
        }
        throw new AiException(HttpStatus.BAD_GATEWAY, "AI provider request failed");
    }
}
