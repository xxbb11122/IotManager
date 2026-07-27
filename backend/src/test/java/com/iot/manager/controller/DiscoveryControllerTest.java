package com.iot.manager.controller;

import com.iot.manager.dto.ApiProblem;
import com.iot.manager.dto.ClaimLanDeviceRequest;
import com.iot.manager.dto.DeviceView;
import com.iot.manager.dto.LanCandidateView;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class DiscoveryControllerTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @Test
    void listReturnsLanCandidatesForDemoSite() {
        ResponseEntity<LanCandidateView[]> response = restTemplate.getForEntity(
                "/api/discovery/lan?siteCode=demo-site",
                LanCandidateView[].class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody())
                .extracting(LanCandidateView::candidateId)
                .contains("lan-demo-sensor-05");
    }

    @Test
    void claimReturnsADeviceViewWithLanAgentConnection() {
        ResponseEntity<DeviceView> response = restTemplate.postForEntity(
                "/api/discovery/lan/lan-demo-sensor-01/claim",
                new ClaimLanDeviceRequest("demo-site", "/operations/field", "Controller claimed sensor"),
                DeviceView.class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().name()).isEqualTo("Controller claimed sensor");
        assertThat(response.getBody().spacePath()).isEqualTo("/operations/field");
        assertThat(response.getBody().connections())
                .singleElement()
                .satisfies(connection -> {
                    assertThat(connection.transport()).isEqualTo("LAN_AGENT");
                    assertThat(connection.status()).isEqualTo("CONNECTED");
                });
    }

    @Test
    void duplicateClaimReturnsAConflictApiProblem() {
        ClaimLanDeviceRequest request = new ClaimLanDeviceRequest(
                "demo-site",
                "/operations/field",
                "Duplicate controller claim"
        );

        ResponseEntity<DeviceView> first = restTemplate.postForEntity(
                "/api/discovery/lan/lan-demo-sensor-02/claim",
                request,
                DeviceView.class
        );
        ResponseEntity<ApiProblem> duplicate = restTemplate.postForEntity(
                "/api/discovery/lan/lan-demo-sensor-02/claim",
                request,
                ApiProblem.class
        );

        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(duplicate.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(duplicate.getBody()).isNotNull();
        assertThat(duplicate.getBody().status()).isEqualTo(HttpStatus.CONFLICT.value());
    }

    @Test
    void invalidSiteAndMissingSpaceReturnNotFoundApiProblems() {
        ResponseEntity<ApiProblem> missingSite = restTemplate.postForEntity(
                "/api/discovery/lan/lan-demo-sensor-03/claim",
                new ClaimLanDeviceRequest("unknown-site", "/operations/field", "Unknown site claim"),
                ApiProblem.class
        );
        ResponseEntity<ApiProblem> missingSpace = restTemplate.postForEntity(
                "/api/discovery/lan/lan-demo-sensor-03/claim",
                new ClaimLanDeviceRequest("demo-site", "/unknown", "Unknown space claim"),
                ApiProblem.class
        );

        assertThat(missingSite.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(missingSite.getBody()).isNotNull();
        assertThat(missingSite.getBody().status()).isEqualTo(HttpStatus.NOT_FOUND.value());
        assertThat(missingSpace.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(missingSpace.getBody()).isNotNull();
        assertThat(missingSpace.getBody().status()).isEqualTo(HttpStatus.NOT_FOUND.value());
    }

    @Test
    void blankClaimFieldReturnsAFieldAwareBadRequestApiProblem() {
        ResponseEntity<ApiProblem> response = restTemplate.postForEntity(
                "/api/discovery/lan/lan-demo-sensor-04/claim",
                new ClaimLanDeviceRequest("demo-site", "/operations/field", " "),
                ApiProblem.class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().fieldErrors()).containsKey("displayName");
    }
}
