package com.iot.manager.service;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A deliberately small equivalent to an ArchUnit rule.  It protects the
 * time-sensitive production paths from silently reintroducing a host-local
 * wall-clock call while allowing the Clock configuration/provider themselves
 * to remain the sole authority boundary.
 */
class TimeAuthorityStaticRuleTest {

    private static final Pattern DIRECT_SYSTEM_CLOCK = Pattern.compile(
            "\\b(?:LocalDateTime|Instant)\\.now\\s*\\(|\\bSystem\\.currentTimeMillis\\s*\\(|\\bClock\\.system(?:UTC|Default|\\s*\\()"
    );

    private static final Path PRODUCTION_SOURCE_ROOT = Path.of("src", "main", "java", "com", "iot", "manager");
    private static final Path ALLOWED_CLOCK_CONFIGURATION = source("config/TimeConfiguration.java");

    @Test
    void productionCodeUsesTheInjectedUtcClockOutsideItsConfigurationBoundary() throws IOException {
        try (Stream<Path> paths = Files.walk(PRODUCTION_SOURCE_ROOT)) {
            for (Path source : paths.filter(path -> path.toString().endsWith(".java"))
                    .filter(path -> !path.equals(ALLOWED_CLOCK_CONFIGURATION)).toList()) {
                String contents = Files.readString(source);
                assertThat(DIRECT_SYSTEM_CLOCK.matcher(contents).find())
                        .as("direct system clock call in %s", source)
                        .isFalse();
            }
        }
    }

    private static Path source(String relativePath) {
        return Path.of("src", "main", "java", "com", "iot", "manager").resolve(relativePath);
    }
}
