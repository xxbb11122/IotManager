package com.iot.manager.migration;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Guards the intentional H2-only V19 compatibility migration. Flyway merges
 * the generic location with one database-specific location, so a duplicate
 * version in either pair makes a fresh database non-deterministic.
 */
class MigrationVersionAllocationTest {

    private static final Path RESOURCE_ROOT = Path.of("src", "main", "resources", "db");
    private static final Pattern MIGRATION_FILE = Pattern.compile("V(\\d+)__.+\\.sql");

    @Test
    void migrationVersionsAreUniqueForEverySupportedDatabaseAndV19RemainsH2Only() throws IOException {
        Map<Integer, String> generic = migrationVersions("migration");
        Map<Integer, String> h2 = migrationVersions("migration-h2");
        Map<Integer, String> postgresql = migrationVersions("migration-postgresql");

        assertNoDuplicateVersions(generic, h2, "H2");
        assertNoDuplicateVersions(generic, postgresql, "PostgreSQL");

        assertThat(h2).containsKey(19);
        assertThat(generic).doesNotContainKey(19);
        assertThat(postgresql).doesNotContainKey(19);
    }

    private Map<Integer, String> migrationVersions(String location) throws IOException {
        Path directory = RESOURCE_ROOT.resolve(location);
        assertThat(directory).as("migration location %s", location).isDirectory();

        Map<Integer, String> versions = new HashMap<>();
        try (var files = Files.list(directory)) {
            List<Path> migrationFiles = files
                    .filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().endsWith(".sql"))
                    .toList();
            for (Path migration : migrationFiles) {
                String filename = migration.getFileName().toString();
                Matcher matcher = MIGRATION_FILE.matcher(filename);
                assertThat(matcher.matches())
                        .as("Flyway migration filename %s", filename)
                        .isTrue();
                int version = Integer.parseInt(matcher.group(1));
                assertThat(versions.putIfAbsent(version, location + "/" + filename))
                        .as("duplicate version %s within %s", version, location)
                        .isNull();
            }
        }
        return versions;
    }

    private void assertNoDuplicateVersions(
            Map<Integer, String> generic,
            Map<Integer, String> databaseSpecific,
            String databaseName
    ) {
        databaseSpecific.forEach((version, filename) -> assertThat(generic)
                .as("V%s must not occur in both generic and %s Flyway locations (%s)", version, databaseName, filename)
                .doesNotContainKey(version));
    }
}
