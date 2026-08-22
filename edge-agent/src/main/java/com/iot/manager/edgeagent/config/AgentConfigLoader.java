package com.iot.manager.edgeagent.config;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;
import java.util.stream.Collectors;

/** Loads one explicit edge-agent properties file. */
public final class AgentConfigLoader {
    private AgentConfigLoader() {
    }

    public static AgentConfig load(Path configFile) throws IOException {
        Path absoluteConfig = configFile.toAbsolutePath().normalize();
        if (!Files.isRegularFile(absoluteConfig)) {
            throw new IOException("Edge agent configuration was not found: " + absoluteConfig);
        }

        Properties properties = new Properties();
        try (InputStream input = Files.newInputStream(absoluteConfig)) {
            properties.load(input);
        }

        Path configDirectory = absoluteConfig.getParent();
        return new AgentConfig(
                required(properties, "agent.name"),
                required(properties, "agent.site-code"),
                resolvePath(configDirectory, required(properties, "agent.identity-file")),
                URI.create(required(properties, "backend.websocket.url")),
                seconds(properties, "heartbeat.interval.seconds", 30),
                seconds(properties, "discovery.interval.seconds", 60),
                seconds(properties, "reconnect.delay.seconds", 5),
                seconds(properties, "request.timeout.seconds", 5),
                uris(properties.getProperty("shelly.endpoints", "")),
                properties.getProperty("backend.websocket.access-token"),
                properties.getProperty("backend.websocket.credential-id"),
                properties.getProperty("backend.websocket.credential-token")
        );
    }

    private static String required(Properties properties, String key) {
        String value = properties.getProperty(key);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Missing required edge agent setting: " + key);
        }
        return value.trim();
    }

    private static Duration seconds(Properties properties, String key, long defaultValue) {
        String raw = properties.getProperty(key, Long.toString(defaultValue)).trim();
        try {
            long seconds = Long.parseLong(raw);
            return Duration.ofSeconds(seconds);
        } catch (NumberFormatException exception) {
            throw new IllegalArgumentException("Edge agent setting " + key + " must be an integer number of seconds", exception);
        }
    }

    private static Path resolvePath(Path directory, String rawPath) {
        Path path = Path.of(rawPath);
        return path.isAbsolute() ? path : directory.resolve(path).normalize();
    }

    private static List<URI> uris(String value) {
        if (value == null || value.isBlank()) {
            return List.of();
        }
        return Arrays.stream(value.split(","))
                .map(String::trim)
                .filter(part -> !part.isBlank())
                .map(URI::create)
                .collect(Collectors.toUnmodifiableList());
    }
}
