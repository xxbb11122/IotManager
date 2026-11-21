package com.iot.manager.service;

import com.iot.manager.ai.AiDeviceDiagnosis;
import com.iot.manager.entity.Device;
import com.iot.manager.repository.DeviceRepository;
import com.iot.manager.repository.OrganizationRepository;
import com.iot.manager.repository.SiteRepository;
import com.iot.manager.entity.Organization;
import com.iot.manager.entity.Site;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@AutoConfigureTestRestTemplate
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "iot.ai.enabled=false",
        "iot.device-assessment.reporting-interval-seconds.legacy-generic-v1.temperature=20"
})
@ActiveProfiles("test")
class DeviceStatusOverviewIntegrationTest {
    @Autowired DeviceStatusOverviewService overview;
    @Autowired DeviceRepository devices;
    @Autowired OrganizationRepository organizations;
    @Autowired SiteRepository sites;
    @Autowired JdbcTemplate jdbc;
    @Autowired TestRestTemplate rest;
    @Autowired TimeProvider time;

    @Test
    void paginatesAllActiveDevicesWithoutModelTruncationOrLeakage() {
        Site local = site("plant");
        Site foreign = site("outside");
        Device a = device(local, "同名设备", null);
        Device b = device(local, "同名设备", Instant.now().minusSeconds(10));
        Device c = device(local, "旧上报", Instant.now().minusSeconds(240));
        Device d = device(local, "第四台", null);
        Device archived = device(local, "存档", null);
        jdbc.update("UPDATE devices SET archived_at=CURRENT_TIMESTAMP WHERE id=?", archived.getId());
        Device other = device(foreign, "另一个站点", Instant.now());

        var first = overview.list(local.getId(), null, 2);
        assertThat(first.demo()).isFalse();
        assertThat(first.total()).isEqualTo(4);
        assertThat(first.links()).containsEntry("RECENT", 1L).containsEntry("NOT_SEEN", 1L).containsEntry("UNKNOWN", 2L);
        assertThat(first.items()).extracting(DeviceStatusOverviewService.DeviceEvidence::publicId)
                .containsExactly(a.getPublicId(), b.getPublicId());
        device(local, "翻页期间注册", null);
        var second = overview.list(local.getId(), first.nextCursor(), 2);
        assertThat(second.total()).isEqualTo(4);
        assertThat(second.items()).extracting(DeviceStatusOverviewService.DeviceEvidence::publicId)
                .containsExactly(c.getPublicId(), d.getPublicId());
        assertThat(second.nextCursor()).isNull();
        assertThatThrownBy(() -> overview.list(foreign.getId(), first.nextCursor(), 2)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> overview.detail(local.getId(), other.getPublicId(), null))
                .isInstanceOf(java.util.NoSuchElementException.class);
        assertThatThrownBy(() -> overview.detail(local.getId(), archived.getPublicId(), null))
                .isInstanceOf(java.util.NoSuchElementException.class);
        var response = rest.getForEntity("/api/v1/sites/" + local.getId() + "/device-status-overview", String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getHeaders().getCacheControl()).contains("no-store");
    }

    @Test
    void keepsAgentHeartbeatReportSampleAndDefaultZeroSeparate() {
        Site local = site("samples");
        Device device = device(local, "实际样本", Instant.now().minusSeconds(20));
        Instant now = Instant.now();
        String agent = UUID.randomUUID().toString();
        jdbc.update("""
                INSERT INTO edge_agents (agent_id, site_id, name, status, created_at, updated_at, last_received_at)
                VALUES (?, ?, 'Agent fixture', 'ONLINE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """, agent, local.getId());
        jdbc.update("""
                INSERT INTO device_connections (device_id, transport, status, agent_id, last_received_at, metadata_json)
                VALUES (?, 'LAN_AGENT', 'CONNECTED', ?, NULL, '{"notForAi":"private-fixture"}')
                """, device.getId(), agent);
        sample(device, now.minusSeconds(86), now.minusSeconds(89), "TRUSTED", "{\"temperature\":22}");
        sample(device, now.minusSeconds(12), now.minusSeconds(16), "TRUSTED", "{\"temperature\":0,\"humidity\":\"invalid\"}");
        var result = overview.detail(local.getId(), device.getPublicId(), null);
        assertThat(result.source()).isEqualTo("EDGE_AGENT");
        assertThat(result.links()).singleElement().satisfies(link -> {
            assertThat(link.agentStatus()).isEqualTo("ONLINE");
            assertThat(link.lastCommunicationAt()).isNull();
        });
        var temperature = field(result, "temperature");
        assertThat(temperature.validity()).isEqualTo("FRESH");
        assertThat(temperature.maxAgeSeconds()).isEqualTo(60);
        assertThat(temperature.samples()).extracting(DeviceStatusOverviewService.Sample::value).containsExactly(0.0, 22.0);
        assertThat(field(result, "humidity").validity()).isEqualTo("NO_SAMPLE");
        assertThat(field(result, "humidity").samples()).isEmpty();
        var localContext = new AiDeviceDiagnosis(1, AiDeviceDiagnosis.Source.PLATFORM, AiDeviceDiagnosis.Issue.EDGE_DELIVERY,
                device.getPublicId(), "temperature", null);
        assertThat(localContext.evidence(local.getId(), overview, time))
                .contains("received at:", "agent state (not device state): ONLINE")
                .doesNotContain(device.getPublicId(), "private-fixture", device.getName());
        jdbc.update("UPDATE devices SET last_received_at=NULL WHERE id=?", device.getId());
        assertThat(overview.detail(local.getId(), device.getPublicId(), null).linkState()).isEqualTo("UNKNOWN");
    }

    @Test
    void doesNotAcceptNewlyReceivedOldOrUntrustedMeasurementAsFresh() {
        Site local = site("replay");
        Device old = device(local, "回放设备", Instant.now());
        Device skewed = device(local, "时钟异常", Instant.now());
        Instant now = Instant.now();
        sample(old, now.minusSeconds(1), now.minusSeconds(120), "TRUSTED", "{\"temperature\":21}");
        sample(skewed, now.minusSeconds(1), now.minusSeconds(3), "SKEWED", "{\"temperature\":23,\"humidity\":55}");
        assertThat(field(overview.detail(local.getId(), old.getPublicId(), null), "temperature").validity()).isEqualTo("STALE");
        var result = overview.detail(local.getId(), skewed.getPublicId(), null);
        assertThat(field(result, "temperature").validity()).isEqualTo("AGE_UNVERIFIED");
        assertThat(field(result, "humidity").validity()).isEqualTo("AGE_UNVERIFIED");
    }

    @Test
    void reservedDemoSiteSeparatesUnverifiedRowsButAllowsRegisteredEdgeDevices() {
        Site sandbox = sites.findByOrganizationAndCode(organizations.findByCode("demo-org").orElseThrow(), "demo-site").orElseThrow();
        long before = overview.list(sandbox.getId(), null, 50).demoTotal();
        Device unverified = device(sandbox, "旧演示记录", null);
        Device registered = device(sandbox, "独立边缘设备", Instant.now().minusSeconds(2));
        String agent = UUID.randomUUID().toString();
        jdbc.update("""
                INSERT INTO edge_agents (agent_id, site_id, name, status, created_at, updated_at)
                VALUES (?, ?, 'Agent fixture', 'ONLINE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """, agent, sandbox.getId());
        jdbc.update("INSERT INTO device_connections (device_id, transport, agent_id) VALUES (?, 'LAN_AGENT', ?)",
                registered.getId(), agent);
        var page = overview.list(sandbox.getId(), null, 50);
        assertThat(page.demo()).isTrue();
        assertThat(page.demoTotal()).isEqualTo(before + 1);
        assertThat(page.links().get("RECENT")).isPositive();
        assertThat(overview.detail(sandbox.getId(), unverified.getPublicId(), null).demo()).isTrue();
        assertThat(overview.detail(sandbox.getId(), registered.getPublicId(), null).demo()).isFalse();
    }

    private Site site(String prefix) {
        String code = prefix + "-" + UUID.randomUUID().toString().substring(0, 7);
        Organization owner = organizations.save(Organization.builder().code(code).name(code).build());
        return sites.save(Site.builder().organization(owner).code(code).name(code).build());
    }

    private Device device(Site site, String name, Instant lastReceived) {
        String id = UUID.randomUUID().toString();
        return devices.saveAndFlush(Device.builder().name(name).publicId(id).deviceId(id).site(site)
                .organization(site.getOrganization()).status("ONLINE").profileId("legacy-generic-v1").profileVersion(1)
                .temperature(0.0).humidity(0.0).lastReceivedAt(lastReceived).build());
    }

    private void sample(Device device, Instant receipt, Instant observed, String trust, String payload) {
        Timestamp bucket = Timestamp.from(receipt.truncatedTo(ChronoUnit.MINUTES));
        jdbc.update("""
                INSERT INTO device_telemetry_samples (device_id, bucket_start, sampled_at, source, state_json,
                received_at, observed_at, observed_time_trust, bucket_start_utc)
                VALUES (?, ?, ?, 'EDGE_AGENT', ?, ?, ?, ?, ?)
                """, device.getId(), bucket, Timestamp.from(observed), payload, Timestamp.from(receipt), Timestamp.from(observed), trust, bucket);
    }

    private static DeviceStatusOverviewService.Field field(DeviceStatusOverviewService.DeviceEvidence value, String key) {
        return value.fields().stream().filter(field -> key.equals(field.key())).findFirst().orElseThrow();
    }
}
