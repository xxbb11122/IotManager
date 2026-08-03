package com.iot.manager.edgeagent.driver.shelly;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.edgeagent.driver.DeviceDriverException;
import com.iot.manager.edgeagent.protocol.AgentProtocol;
import com.iot.manager.edgeagent.protocol.CommandStatus;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

/** Minimal client for Shelly Gen2 local HTTP RPC endpoints. */
public final class ShellyRpcClient {
    private static final Pattern RPC_METHOD = Pattern.compile("[A-Za-z0-9_.]+");

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    public ShellyRpcClient(HttpClient httpClient) {
        this(httpClient, AgentProtocol.newObjectMapper());
    }

    public ShellyRpcClient(HttpClient httpClient, ObjectMapper objectMapper) {
        this.httpClient = Objects.requireNonNull(httpClient, "httpClient");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
    }

    public JsonNode call(URI endpoint, String method, Map<String, String> parameters, Duration timeout)
            throws DeviceDriverException {
        URI rpcUri = rpcUri(endpoint, method, parameters);
        HttpRequest request = HttpRequest.newBuilder(rpcUri)
                .timeout(timeout)
                .header("Accept", "application/json")
                .GET()
                .build();
        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new DeviceDriverException(
                        CommandStatus.FAILED,
                        "SHELLY_HTTP_" + response.statusCode(),
                        "Shelly RPC returned HTTP " + response.statusCode()
                );
            }
            JsonNode body = objectMapper.readTree(response.body());
            if (body == null || body.isNull()) {
                throw new DeviceDriverException(CommandStatus.FAILED, "SHELLY_EMPTY_RESPONSE", "Shelly RPC returned no JSON body");
            }
            if (body.has("error")) {
                throw new DeviceDriverException(
                        CommandStatus.FAILED,
                        "SHELLY_RPC_ERROR",
                        "Shelly RPC reported an error: " + body.path("error").toString()
                );
            }
            return body;
        } catch (DeviceDriverException exception) {
            throw exception;
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw DeviceDriverException.failed("SHELLY_INTERRUPTED", "Shelly RPC request was interrupted", exception);
        } catch (IOException exception) {
            throw DeviceDriverException.failed("SHELLY_IO", "Could not call Shelly RPC at " + rpcUri, exception);
        }
    }

    public URI normalizeEndpoint(URI endpoint) {
        Objects.requireNonNull(endpoint, "endpoint");
        String scheme = endpoint.getScheme();
        if (("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                && endpoint.getHost() != null
                && endpoint.getUserInfo() == null
                && (endpoint.getPath() == null || endpoint.getPath().isBlank() || "/".equals(endpoint.getPath()))
                && endpoint.getQuery() == null
                && endpoint.getFragment() == null) {
            return URI.create(scheme.toLowerCase() + "://" + endpoint.getRawAuthority());
        }
        throw new IllegalArgumentException("Shelly endpoint must be a bare http(s) host URI: " + endpoint);
    }

    URI rpcUri(URI endpoint, String method, Map<String, String> parameters) {
        if (method == null || !RPC_METHOD.matcher(method).matches()) {
            throw new IllegalArgumentException("Invalid Shelly RPC method: " + method);
        }
        URI base = normalizeEndpoint(endpoint);
        String query = parameters.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(entry -> encode(entry.getKey()) + "=" + encode(entry.getValue()))
                .reduce((left, right) -> left + "&" + right)
                .orElse("");
        String raw = base + "/rpc/" + method;
        return URI.create(query.isEmpty() ? raw : raw + "?" + query);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
