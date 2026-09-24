package com.iot.manager.service;

import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.TreePathScanner;
import org.junit.jupiter.api.Test;

import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * AST-based guard against direct host-local wall-clock calls. Parsing Java
 * syntax avoids false positives from Javadoc, comments, strings, and text
 * blocks while keeping the check dependency-free.
 */
class TimeAuthorityStaticRuleTest {

    private static final Path PRODUCTION_SOURCE_ROOT = Path.of("src", "main", "java", "com", "iot", "manager");
    private static final Path ALLOWED_CLOCK_CONFIGURATION = PRODUCTION_SOURCE_ROOT.resolve("config/TimeConfiguration.java");
    private static final Pattern FORBIDDEN_CALL = Pattern.compile(
            "(?:^|\\.)(?:LocalDateTime\\.now|Instant\\.now|System\\.currentTimeMillis|Clock\\.systemUTC|Clock\\.systemDefaultZone|Clock\\.system)$"
    );

    @Test
    void productionCodeUsesTheInjectedUtcClockOutsideItsConfigurationBoundary() throws IOException {
        try (Stream<Path> paths = Files.walk(PRODUCTION_SOURCE_ROOT)) {
            for (Path source : paths.filter(path -> path.toString().endsWith(".java"))
                    .filter(path -> !path.equals(ALLOWED_CLOCK_CONFIGURATION)).toList()) {
                List<String> violations = forbiddenCalls(Files.readString(source));
                assertThat(violations).as("direct system clock calls in %s", source).isEmpty();
            }
        }

        List<String> configurationCalls = forbiddenCalls(Files.readString(ALLOWED_CLOCK_CONFIGURATION));
        assertThat(configurationCalls).containsExactly("Clock.systemUTC");
    }

    @Test
    void commentsStringsAndTextBlocksDoNotTriggerTheRule() throws IOException {
        String source = """
                class Fixture {
                    // Instant.now() must only appear in this comment.
                    String example = "LocalDateTime.now() and System.currentTimeMillis()";
                }
                """;

        assertThat(forbiddenCalls(source)).isEmpty();
        assertThat(forbiddenCalls("class Fixture { String documentation = \"\"\"\nClock.systemUTC()\n\"\"\"; }"))
                .isEmpty();
    }

    @Test
    void actualForbiddenInvocationsAreDetectedIncludingFullyQualifiedCalls() throws IOException {
        String source = """
                class Fixture {
                    java.time.Instant now() { return java.time.Instant.now(); }
                    long milliseconds() { return java.lang.System.currentTimeMillis(); }
                    java.time.Clock clock() { return java.time.Clock.systemDefaultZone(); }
                }
                """;

        assertThat(forbiddenCalls(source)).containsExactly(
                "Instant.now", "System.currentTimeMillis", "Clock.systemDefaultZone"
        );
    }

    private List<String> forbiddenCalls(String source) throws IOException {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        assertThat(compiler).as("a JDK compiler is required for the AST clock rule").isNotNull();
        JavaFileObject input = new SimpleJavaFileObject(URI.create("string:///ClockRuleFixture.java"), JavaFileObject.Kind.SOURCE) {
            @Override
            public CharSequence getCharContent(boolean ignoreEncodingErrors) {
                return source;
            }
        };

        List<String> violations = new ArrayList<>();
        try (StandardJavaFileManager fileManager = compiler.getStandardFileManager(null, null, null)) {
            JavacTask task = (JavacTask) compiler.getTask(null, fileManager, null, List.of("-proc:none"), null, List.of(input));
            for (CompilationUnitTree unit : task.parse()) {
                Set<String> staticImports = unit.getImports().stream()
                        .filter(importTree -> importTree.isStatic())
                        .map(importTree -> importTree.getQualifiedIdentifier().toString())
                        .collect(java.util.stream.Collectors.toSet());
                new TreePathScanner<Void, Void>() {
                    @Override
                    public Void visitMethodInvocation(MethodInvocationTree invocation, Void unused) {
                        String select = invocation.getMethodSelect().toString().replaceAll("\\s+", "");
                        if (FORBIDDEN_CALL.matcher(select).find()) {
                            violations.add(shortMethodName(select));
                        } else if (isStaticallyImportedForbiddenCall(select, staticImports)) {
                            violations.add(select);
                        }
                        return super.visitMethodInvocation(invocation, unused);
                    }
                }.scan(unit, null);
            }
        }
        return violations;
    }

    private boolean isStaticallyImportedForbiddenCall(String select, Set<String> staticImports) {
        String owner = switch (select) {
            case "now" -> "java.time.Instant";
            case "currentTimeMillis" -> "java.lang.System";
            case "system", "systemUTC", "systemDefaultZone" -> "java.time.Clock";
            default -> null;
        };
        if (owner == null) return false;
        if (select.equals("now")) {
            return staticImports.contains("java.time.Instant.*")
                    || staticImports.contains("java.time.LocalDateTime.*")
                    || staticImports.contains("java.time.Instant.now")
                    || staticImports.contains("java.time.LocalDateTime.now");
        }
        return staticImports.contains(owner + ".*") || staticImports.contains(owner + "." + select);
    }

    private String shortMethodName(String select) {
        String[] parts = select.split("\\.");
        return parts[parts.length - 2] + "." + parts[parts.length - 1];
    }
}
