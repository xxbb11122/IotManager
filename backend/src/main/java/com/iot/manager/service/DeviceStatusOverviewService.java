package com.iot.manager.service;

import com.iot.manager.config.DeviceAssessmentProperties;
import com.iot.manager.entity.Site;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Set;

/** Read-only projection for the mobile status and repair workspace. Never dispatches commands or reads devices directly. */
@Service
@RequiredArgsConstructor
public class DeviceStatusOverviewService {
    public record Overview(long siteId, Instant asOf, boolean demo, long total, long demoTotal,
                           Map<String, Long> links, List<DeviceEvidence> items, String nextCursor) { }
    public record DeviceEvidence(String publicId, String name, String source, boolean demo, Instant asOf,
                                 String profileId, Integer profileVersion, String firmwareVersion, String linkState,
                                 Instant lastCommunicationAt, List<Link> links, List<Field> fields, Command command) { }
    public record Link(String transport, String reportedStatus, Instant lastCommunicationAt, String agentStatus) { }
    public record Field(String key, String unit, String validity, Integer maxAgeSeconds, List<Sample> samples) { }
    public record Sample(Object value, Instant receivedAt, Instant observedAt, String timeTrust, Instant bucketStart, String source) { }
    public record Command(String id, String type, String state, String failureCode, Instant requestedAt,
                          Instant completedAt, Boolean requestedPower) { }

    private static final Set<String> LINK_STATES = Set.of("RECENT", "NOT_SEEN", "UNKNOWN");
    private static final Set<String> COMMAND_STATES = Set.of("PENDING", "SENT", "ACKNOWLEDGED", "UNCONFIRMED", "FAILED", "REJECTED");
    private static final Set<String> TRANSPORTS = Set.of("LAN_AGENT", "BLE_DIRECT", "API", "MQTT", "HTTP", "COAP", "MODBUS");
    private static final Set<String> CONNECTION_STATES = Set.of("CONNECTED", "DISCONNECTED", "ONLINE", "OFFLINE", "PENDING", "FAILED", "REVOKED");
    private static final Set<String> SAMPLE_SOURCES = Set.of("EDGE_AGENT", "API", "DEVICE", "SIMULATOR");
    private static final int RECENT_BUCKETS = 12;
    private static final String DEVICE_PROJECTION = """
            SELECT d.id, d.public_id, d.name, d.profile_id, d.profile_version, d.firmware_version,
                   d.last_received_at, p.definition_json,
                   CASE WHEN :demoSite = TRUE AND NOT EXISTS (
                     SELECT 1 FROM device_connections route
                     JOIN edge_agents agent ON agent.agent_id = route.agent_id AND agent.site_id = :site
                     WHERE route.device_id = d.id AND route.transport = 'LAN_AGENT'
                   ) THEN TRUE ELSE FALSE END AS demo_record,
                   CASE
                     WHEN d.last_received_at IS NULL OR d.last_received_at > :at THEN 'UNKNOWN'
                     WHEN d.last_received_at < :cutoff THEN 'NOT_SEEN'
                     WHEN UPPER(d.status) = 'ONLINE' THEN 'RECENT'
                     ELSE 'UNKNOWN'
                   END AS link_state
            FROM devices d
            LEFT JOIN device_profiles p ON p.profile_id = d.profile_id AND p.profile_version = d.profile_version
            WHERE d.site_id = :site AND d.archived_at IS NULL
            """;

    private final NamedParameterJdbcTemplate jdbc;
    private final SiteAccessService access;
    private final TimeProvider time;
    private final ObjectMapper json;
    private final DeviceAssessmentProperties policy;

    @Transactional(readOnly = true)
    public Overview list(long siteId, String cursor, int limit) {
        Site site = access.requireSiteAccess(siteId);
        if (limit < 1 || limit > 100) throw new IllegalArgumentException("Page limit must be 1 to 100");
        Instant at = time.now();
        Map<String, Object> args = args(siteId, at);
        boolean demoSite = isDemoSite(site);
        args.put("demoSite", demoSite);
        Cursor page = cursor == null ? new Cursor(0, maxVisibleId(args)) : decodeCursor(siteId, cursor);
        args.put("upper", page.upper());
        args.put("after", page.after());
        args.put("limit", limit + 1);
        var counts = new LinkedHashMap<String, Long>();
        long[] demoTotal = {0L};
        LINK_STATES.stream().sorted().forEach(state -> counts.put(state, 0L));
        jdbc.query("SELECT demo_record, link_state, COUNT(*) AS quantity FROM (" + DEVICE_PROJECTION
                + " AND d.id <= :upper) counted GROUP BY demo_record, link_state", args, rs -> {
            if (rs.getBoolean("demo_record")) demoTotal[0] += rs.getLong("quantity");
            else counts.put(rs.getString("link_state"), rs.getLong("quantity"));
        });
        var rows = jdbc.query(DEVICE_PROJECTION
                + " AND d.id > :after AND d.id <= :upper ORDER BY d.id LIMIT :limit", args, this::mapBase);
        boolean more = rows.size() > limit;
        var visible = more ? rows.subList(0, limit) : rows;
        return new Overview(siteId, at, demoSite, demoTotal[0] + counts.values().stream().mapToLong(Long::longValue).sum(),
                demoTotal[0], counts, enrich(siteId, at, visible, null),
                more ? siteId + ":" + page.upper() + ":" + visible.get(visible.size() - 1).id() : null);
    }

    @Transactional(readOnly = true)
    public DeviceEvidence detail(long siteId, String publicId, String commandId) {
        Site site = access.requireSiteAccess(siteId);
        validateId(publicId);
        if (commandId != null) validateId(commandId);
        Instant at = time.now();
        var args = args(siteId, at);
        args.put("demoSite", isDemoSite(site));
        args.put("publicId", publicId);
        var rows = jdbc.query(DEVICE_PROJECTION + " AND d.public_id = :publicId", args, this::mapBase);
        if (rows.isEmpty()) throw new NoSuchElementException("Device not found in the current site");
        return enrich(siteId, at, rows, commandId).get(0);
    }

    private List<DeviceEvidence> enrich(long siteId, Instant at, List<Base> rows, String selectedCommand) {
        if (rows.isEmpty()) return List.of();
        Map<String, Object> args = args(siteId, at);
        args.put("ids", rows.stream().map(Base::id).toList());
        args.put("buckets", RECENT_BUCKETS);
        var links = new LinkedHashMap<Long, List<Link>>();
        jdbc.query("""
                SELECT c.device_id, c.transport, c.status, c.last_received_at, a.status AS agent_status
                FROM device_connections c
                LEFT JOIN edge_agents a ON a.agent_id = c.agent_id AND a.site_id = :site
                WHERE c.device_id IN (:ids)
                ORDER BY c.id
                """, args, rs -> {
            links.computeIfAbsent(rs.getLong("device_id"), ignored -> new ArrayList<>()).add(new Link(
                    known(rs.getString("transport"), TRANSPORTS), known(rs.getString("status"), CONNECTION_STATES),
                    instant(rs, "last_received_at"), known(rs.getString("agent_status"), CONNECTION_STATES)));
        });
        var samples = new LinkedHashMap<Long, List<RawSample>>();
        jdbc.query("""
                SELECT * FROM (
                  SELECT device_id, received_at, observed_at, observed_time_trust, bucket_start_utc, source, state_json,
                         ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY received_at DESC, id DESC) AS evidence_rank
                  FROM device_telemetry_samples
                  WHERE device_id IN (:ids) AND received_at <= :at
                ) ranked WHERE evidence_rank <= :buckets ORDER BY device_id, evidence_rank
                """, args, rs -> {
            samples.computeIfAbsent(rs.getLong("device_id"), ignored -> new ArrayList<>()).add(new RawSample(
                    instant(rs, "received_at"), instant(rs, "observed_at"), rs.getString("observed_time_trust"),
                    instant(rs, "bucket_start_utc"), known(rs.getString("source"), SAMPLE_SOURCES), parse(rs.getString("state_json"))));
        });
        var commands = new LinkedHashMap<Long, Command>();
        String byCommand = selectedCommand == null ? "" : " AND command_id = :command";
        if (selectedCommand != null) args.put("command", selectedCommand);
        jdbc.query("""
                SELECT * FROM (
                  SELECT device_id, command_id, type, status, failure_code, requested_at_utc, completed_at_utc, parameters_json,
                         ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY id DESC) AS request_rank
                  FROM device_commands WHERE device_id IN (:ids)
                """ + byCommand + ") ranked WHERE request_rank = 1", args, rs -> {
            String type = rs.getString("type");
            JsonNode on = "set_power".equals(type) ? parse(rs.getString("parameters_json")).path("on") : json.missingNode();
            commands.put(rs.getLong("device_id"), new Command(rs.getString("command_id"), type,
                    known(rs.getString("status"), COMMAND_STATES), safeCode(rs.getString("failure_code")),
                    instant(rs, "requested_at_utc"), instant(rs, "completed_at_utc"), on.isBoolean() ? on.booleanValue() : null));
        });
        return rows.stream().map(row -> {
            List<Link> routes = links.getOrDefault(row.id(), List.of());
            return new DeviceEvidence(row.publicId(), row.name(),
                    routes.stream().anyMatch(link -> "LAN_AGENT".equals(link.transport())) ? "EDGE_AGENT" : "PLATFORM",
                    row.demo(), at, row.profileId(), row.profileVersion(), row.firmwareVersion(), row.linkState(),
                    row.lastCommunicationAt(), routes, fields(row, samples.getOrDefault(row.id(), List.of()), at), commands.get(row.id()));
        }).toList();
    }

    private List<Field> fields(Base row, List<RawSample> samples, Instant at) {
        var fields = new LinkedHashMap<String, Specification>();
        for (JsonNode node : parse(row.profile()).path("telemetry")) {
            String key = node.path("id").asString("");
            String type = node.path("type").asString("");
            if (fields.size() < 24 && key.matches("[A-Za-z][A-Za-z0-9_]{0,47}") && Set.of("number", "boolean").contains(type)) {
                fields.put(key, new Specification(type, node.path("unit").asString(null)));
            }
        }
        // A sample, not DeviceView's initialized default columns, is the evidence for a measurement.
        return fields.entrySet().stream().map(entry -> {
            String key = entry.getKey();
            Specification spec = entry.getValue();
            Integer maxAge = policy.maxAgeSeconds(row.profileId(), key);
            List<Sample> readings = samples.stream()
                    .filter(raw -> row.demo() || !"SIMULATOR".equals(raw.source()))
                    .map(raw -> reading(raw, key, spec.type()))
                    .filter(java.util.Objects::nonNull).limit(2).toList();
            String validity = validity(readings, maxAge, at);
            return new Field(key, spec.unit(), validity, maxAge, readings);
        }).toList();
    }

    private static String validity(List<Sample> readings, Integer maxAge, Instant at) {
        if (readings.isEmpty()) return "NO_SAMPLE";
        Sample newest = readings.get(0);
        if (maxAge != null && newest.receivedAt().isBefore(at.minusSeconds(maxAge))) return "STALE";
        if (maxAge == null || !"TRUSTED".equals(newest.timeTrust()) || newest.observedAt() == null
                || newest.observedAt().isAfter(at)) return "AGE_UNVERIFIED";
        return newest.observedAt().isBefore(at.minusSeconds(maxAge)) ? "STALE" : "FRESH";
    }

    private static Sample reading(RawSample raw, String field, String type) {
        JsonNode value = raw.state().path(field);
        Object scalar;
        if ("boolean".equals(type) && value.isBoolean()) scalar = value.booleanValue();
        else if ("number".equals(type) && value.isNumber() && Double.isFinite(value.doubleValue())) scalar = value.doubleValue();
        else return null;
        return new Sample(scalar, raw.receivedAt(), raw.observedAt(),
                known(raw.trust(), Set.of("TRUSTED", "SKEWED", "UNKNOWN", "LEGACY_UNKNOWN")), raw.bucketStart(), raw.source());
    }

    private Map<String, Object> args(long site, Instant at) {
        return new LinkedHashMap<>(Map.of("site", site, "at", Timestamp.from(at),
                "cutoff", Timestamp.from(at.minusSeconds(policy.getLinkMaxAgeSeconds()))));
    }

    private long maxVisibleId(Map<String, Object> args) {
        return jdbc.queryForObject("SELECT COALESCE(MAX(id),0) FROM devices WHERE site_id = :site AND archived_at IS NULL",
                args, Long.class);
    }

    private Base mapBase(ResultSet rs, int position) throws SQLException {
        return new Base(rs.getLong("id"), rs.getString("public_id"), rs.getString("name"), rs.getString("profile_id"),
                rs.getObject("profile_version", Integer.class), rs.getString("firmware_version"),
                instant(rs, "last_received_at"), rs.getString("link_state"), rs.getString("definition_json"), rs.getBoolean("demo_record"));
    }

    private JsonNode parse(String value) {
        if (value != null && value.length() <= 50_000) {
            try { return json.readTree(value); }
            catch (JacksonException ignored) { /* Malformed historical payload is not evidence. */ }
        }
        return json.missingNode();
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static String known(String value, Set<String> allowlist) {
        return value != null && allowlist.contains(value) ? value : "UNKNOWN";
    }

    private static String safeCode(String value) {
        return value != null && value.matches("[A-Z][A-Z0-9_]{0,63}") ? value : null;
    }

    private static boolean isDemoSite(Site site) {
        return "demo-site".equals(site.getCode()) && "demo-org".equals(site.getOrganization().getCode());
    }

    private static void validateId(String value) {
        if (value == null || !value.matches("[A-Za-z0-9_-]{1,100}"))
            throw new IllegalArgumentException("Invalid assessment target");
    }

    private static Cursor decodeCursor(long siteId, String value) {
        if (!value.matches("[0-9]{1,19}:[0-9]{1,19}:[0-9]{1,19}"))
            throw new IllegalArgumentException("Invalid device cursor");
        String[] parts = value.split(":");
        long upper = Long.parseLong(parts[1]);
        long after = Long.parseLong(parts[2]);
        if (Long.parseLong(parts[0]) != siteId || after < 1 || after >= upper)
            throw new IllegalArgumentException("Invalid device cursor for this site");
        return new Cursor(after, upper);
    }

    private record Cursor(long after, long upper) { }
    private record Base(long id, String publicId, String name, String profileId, Integer profileVersion,
                        String firmwareVersion, Instant lastCommunicationAt, String linkState, String profile, boolean demo) { }
    private record Specification(String type, String unit) { }
    private record RawSample(Instant receivedAt, Instant observedAt, String trust, Instant bucketStart, String source, JsonNode state) { }
}
