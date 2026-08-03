package com.iot.manager.edgeagent.identity;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Persists identity atomically so a restarted installation keeps its server-side ownership. */
public final class AgentIdentityStore {
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public AgentIdentityStore(ObjectMapper objectMapper) {
        this(objectMapper, Clock.systemUTC());
    }

    AgentIdentityStore(ObjectMapper objectMapper, Clock clock) {
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    public AgentIdentity loadOrCreate(Path identityFile) throws IOException {
        Path target = identityFile.toAbsolutePath().normalize();
        if (Files.exists(target)) {
            return read(target);
        }

        Path parent = target.getParent();
        if (parent == null) {
            throw new IOException("Identity path must have a parent directory: " + target);
        }
        Files.createDirectories(parent);

        AgentIdentity created = new AgentIdentity(UUID.randomUUID(), Instant.now(clock));
        Path temporary = Files.createTempFile(parent, ".identity-", ".json");
        try {
            Files.writeString(temporary, objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(created));
            try {
                moveWithoutReplacing(temporary, target);
            } catch (FileAlreadyExistsException exception) {
                return read(target);
            }
            return created;
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static void moveWithoutReplacing(Path source, Path target) throws IOException {
        try {
            Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException exception) {
            Files.move(source, target);
        }
    }

    private AgentIdentity read(Path target) throws IOException {
        AgentIdentity identity = objectMapper.readValue(Files.readString(target), AgentIdentity.class);
        if (identity.agentId() == null || identity.createdAt() == null) {
            throw new IOException("Identity file is missing agentId or createdAt: " + target);
        }
        return identity;
    }
}
