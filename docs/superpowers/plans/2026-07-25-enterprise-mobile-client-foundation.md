# Enterprise Mobile Client Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the initial enterprise IoT platform slice: a mobile/PDA client with a real BLE connection shell, simulated LAN discovery and commands, command acknowledgements, activity/alert events, and enterprise-ready organization/location seams.

**Architecture:** Keep the existing Spring Boot application as a modular monolith. New domain modules expose DTO-based REST and versioned WebSocket events; the client renders one device model through replaceable BLE and LAN adapters. H2 remains the development simulator database, while Flyway, profiles, DTOs, test coverage, and API configuration make the framework repeatable and ready for later PostgreSQL, Edge Agent, and security work.

**Tech Stack:** Java 17, Spring Boot 3.2, Spring Data JPA, Flyway, H2, Spring WebSocket, Maven, Vite 5, vanilla ES modules, Node built-in test runner, Lucide icons.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `.gitignore` | Excludes local H2 data, build output, IDE state, and dependencies from future version control. |
| `README.md` | One-command-per-service development, test, build, HTTPS/BLE constraints, and project topology. |
| `backend/src/main/resources/application*.yml` | Default, development, and test profile configuration. |
| `backend/src/main/resources/db/migration/V1__core_schema.sql` | Repeatable baseline schema for existing and new framework tables. |
| `backend/src/main/java/.../entity/*` | Persistent organization, location, device-connection, command, activity, alert, and device state data. |
| `backend/src/main/java/.../dto/*` | Stable REST/WebSocket public shapes; no controller returns a JPA entity. |
| `backend/src/main/java/.../service/*` | Bootstrap, discovery, command, activity, mapping, and simulator logic. |
| `backend/src/main/java/.../controller/*` | DTO-only device, discovery, command, alert, and bootstrap APIs. |
| `backend/src/test/java/...` | JPA/service/controller tests for the vertical device lifecycle. |
| `client/src/js/adapters/*` | Transport-neutral client connection boundary. |
| `client/src/js/*` | Store, API client, command state helpers, UI renderer, and application orchestration. |
| `client/test/*` | Hardware-free Node tests for client state and adapter behavior. |
| `client/src/css/style.css` | Mobile-first field-operator UI with responsive desktop behavior. |

The workspace is not currently a Git repository. Do not invent commits during implementation; create `.gitignore`, document the limitation in `README.md`, and report the changed-file list after each task instead.

### Task 1: Make Development Repeatable

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Modify: `backend/pom.xml`
- Modify: `backend/src/main/resources/application.yml`
- Create: `backend/src/main/resources/application-dev.yml`
- Create: `backend/src/main/resources/application-test.yml`
- Modify: `client/package.json`
- Create: `client/package-lock.json` via `npm install`

- [ ] **Step 1: Add a test profile smoke test**

Create `backend/src/test/java/com/iot/manager/IotManagerApplicationTest.java`:

```java
@SpringBootTest
@ActiveProfiles("test")
class IotManagerApplicationTest {
    @Test
    void contextLoadsWithTestProfile() {}
}
```

- [ ] **Step 2: Run the test before profile configuration exists**

Run: `mvn -q -Dtest=IotManagerApplicationTest test`

Expected: fail because the test profile and schema migration configuration do not yet provide a clean database.

- [ ] **Step 3: Add Flyway, profiles, and client test/build scripts**

Add `org.flywaydb:flyway-core` to `backend/pom.xml`. Spring Boot 3.2 manages Flyway 9.x, whose core artifact already includes H2 support; do not add the nonexistent `flyway-database-h2` artifact. Move the H2 datasource and simulator configuration to `application-dev.yml`; make `application.yml` select `dev` by default, enable Flyway, and set Hibernate to `validate`. Set `application-test.yml` to a unique in-memory H2 URL with the simulator disabled.

Set the client scripts to:

```json
{
  "dev": "vite --port 5175",
  "build": "vite build",
  "preview": "vite preview --port 5175",
  "test": "node --test"
}
```

Add `lucide` as a production dependency and run `npm install` in `client` to create a lockfile.

- [ ] **Step 4: Add environment/configuration documentation**

Add `.gitignore` entries for `**/node_modules/`, `**/dist/`, `backend/data/`, `backend/target/`, `.idea/`, and `.superpowers/`. Write `README.md` with exact backend/client/frontend/console dev commands, ports, test commands, H2 dev-only note, `VITE_API_BASE_URL`/`VITE_WS_URL`, and the HTTPS requirement for BLE on a PDA.

- [ ] **Step 5: Run repeatability checks**

Run:

```powershell
cd backend; mvn -q -Dtest=IotManagerApplicationTest test
cd ..\client; npm test; npm run build
```

Expected: the Spring context starts using in-memory H2, Node finds no test failures, and Vite produces `dist/`.

### Task 2: Establish Core Context and Migration-Safe Data

**Files:**
- Create: `backend/src/main/resources/db/migration/V2__add_device_platform_core.sql`
- Create: `backend/src/main/java/com/iot/manager/entity/Organization.java`
- Create: `backend/src/main/java/com/iot/manager/entity/Site.java`
- Create: `backend/src/main/java/com/iot/manager/entity/Space.java`
- Create: `backend/src/main/java/com/iot/manager/entity/DeviceConnection.java`
- Create: `backend/src/main/java/com/iot/manager/entity/DeviceCommand.java`
- Create: `backend/src/main/java/com/iot/manager/entity/ActivityEvent.java`
- Modify: `backend/src/main/java/com/iot/manager/entity/Device.java`
- Create: matching repositories under `backend/src/main/java/com/iot/manager/repository/`
- Create: `backend/src/main/java/com/iot/manager/service/BootstrapService.java`
- Test: `backend/src/test/java/com/iot/manager/service/BootstrapServiceTest.java`

- [ ] **Step 1: Write the failing bootstrap test**

```java
@SpringBootTest
@ActiveProfiles("test")
class BootstrapServiceTest {
    @Autowired OrganizationRepository organizations;
    @Autowired SiteRepository sites;
    @Autowired SpaceRepository spaces;
    @Autowired BootstrapService bootstrap;

    @Test
    void seedsOneDemoOrganizationSiteAndSpaceTree() {
        bootstrap.ensureDemoContext();
        assertThat(organizations.findByCode("demo-org")).isPresent();
        assertThat(sites.findByCode("demo-site")).isPresent();
        assertThat(spaces.findByPath("/operations")).isPresent();
    }
}
```

- [ ] **Step 2: Run the failing bootstrap test**

Run: `mvn -q -Dtest=BootstrapServiceTest test`

Expected: compilation failure because context entities and bootstrap service are absent.

- [ ] **Step 3: Add the data model and migration**

Use these persistent concepts:

```java
Organization { Long id; String code; String name; }
Site { Long id; Organization organization; String code; String name; }
Space { Long id; Site site; Space parent; String name; String path; }
DeviceConnection { Long id; Device device; String transport; String profileId; String externalId; String status; String metadataJson; }
DeviceCommand { Long id; String commandId; Device device; String type; String parametersJson; String idempotencyKey; String status; String errorMessage; LocalDateTime requestedAt; LocalDateTime acknowledgedAt; }
ActivityEvent { Long id; Device device; String eventType; String detail; String payloadJson; LocalDateTime occurredAt; }
```

Extend `Device` with `publicId`, `Organization organization`, `Site site`, `Space space`, `reportedStateJson`, `desiredStateJson`, and safe defaults in `@PrePersist` for all numeric telemetry fields. Keep existing fields for compatibility.

Task 1 already created the immutable V1 baseline for `devices` and `alerts`. `V2__add_device_platform_core.sql` must use H2-compatible `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements so existing demo databases gain the new columns without destroying old devices. It must create indexes for organization/site scoped device lookups, command idempotency keys, and activity/device history. Do not edit V1 after it has been executed.

`BootstrapService.ensureDemoContext()` must create `demo-org`, `demo-site`, `/operations`, and `/operations/field` idempotently, then return the field space.

- [ ] **Step 4: Run the bootstrap test again**

Run: `mvn -q -Dtest=BootstrapServiceTest test`

Expected: PASS with exactly one seed context after repeated invocations.

### Task 3: Replace Entity-Shaped APIs with a Stable Device View Model

**Files:**
- Create: `backend/src/main/java/com/iot/manager/dto/DeviceView.java`
- Create: `backend/src/main/java/com/iot/manager/dto/ConnectionView.java`
- Create: `backend/src/main/java/com/iot/manager/dto/ActivityView.java`
- Create: `backend/src/main/java/com/iot/manager/dto/ApiProblem.java`
- Create: `backend/src/main/java/com/iot/manager/service/DeviceMapper.java`
- Create: `backend/src/main/java/com/iot/manager/controller/ApiExceptionHandler.java`
- Modify: `backend/src/main/java/com/iot/manager/controller/DeviceController.java`
- Modify: `backend/src/main/java/com/iot/manager/service/DeviceService.java`
- Test: `backend/src/test/java/com/iot/manager/controller/DeviceControllerTest.java`

- [ ] **Step 1: Write DTO contract tests**

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class DeviceControllerTest {
    @Autowired TestRestTemplate http;

    @Test
    void listReturnsStableDeviceViewNotJpaEntity() {
        ResponseEntity<DeviceView[]> response = http.getForEntity("/api/devices", DeviceView[].class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()[0].publicId()).startsWith("device-");
    }
}
```

- [ ] **Step 2: Run the contract test before DTO migration**

Run: `mvn -q -Dtest=DeviceControllerTest test`

Expected: compilation failure because `DeviceView` does not exist.

- [ ] **Step 3: Implement DTOs, mapping, and consistent errors**

`DeviceView` must expose `id`, `publicId`, `deviceId`, `name`, `type`, `status`, `location`, `organizationCode`, `siteCode`, `spacePath`, `reportedState`, `desiredState`, `connections`, `lastSeen`, and `updatedAt`.

Keep old query parameters and paths, but return DTOs from list/get/create/update. Add `@Valid` request records for create/update, map `NoSuchElementException` to a `404 ApiProblem`, and map validation failures to a field-aware `400 ApiProblem`.

- [ ] **Step 4: Run controller and existing backend tests**

Run: `mvn -q -Dtest=DeviceControllerTest,BootstrapServiceTest test`

Expected: both tests pass and no response exposes Hibernate lazy fields.

### Task 4: Repair Simulator Defaults and Make Alerts Real

**Files:**
- Modify: `backend/src/main/java/com/iot/manager/service/DeviceService.java`
- Modify: `backend/src/main/java/com/iot/manager/service/DeviceSimulator.java`
- Modify: `backend/src/main/java/com/iot/manager/service/WebSocketService.java`
- Modify: `backend/src/main/java/com/iot/manager/entity/Alert.java`
- Create: `backend/src/main/java/com/iot/manager/dto/RealtimeEvent.java`
- Test: `backend/src/test/java/com/iot/manager/service/DeviceSimulatorTest.java`

- [ ] **Step 1: Write simulator regression tests**

```java
@SpringBootTest
@ActiveProfiles("test")
class DeviceSimulatorTest {
    @Autowired DeviceService devices;
    @Autowired DeviceSimulator simulator;
    @Autowired AlertRepository alerts;

    @Test
    void createdDeviceHasSafeTelemetryForSimulation() {
        Device device = devices.create(new Device());
        assertThat(device.getTemperature()).isNotNull();
        assertThatCode(simulator::simulateTelemetry).doesNotThrowAnyException();
    }

    @Test
    void warningTransitionCreatesAnUnresolvedAlert() {
        // Use a deterministic simulator event seam rather than random probability.
        Device warning = simulator.applyStatusEventForTest("WARNING");
        assertThat(alerts.findByResolvedFalseOrderByCreatedAtDesc())
            .anyMatch(alert -> alert.getDevice().getId().equals(warning.getId()));
    }
}
```

- [ ] **Step 2: Run tests and verify red state**

Run: `mvn -q -Dtest=DeviceSimulatorTest test`

Expected: failures because defaults and deterministic event seam do not exist.

- [ ] **Step 3: Implement safe defaults and alert/activity emission**

`DeviceService.create` must assign public ID, device ID, demo context, offline status, numeric telemetry defaults, empty desired/reported state JSON, and a registration activity event. `DeviceSimulator` must use `Duration` or configured interval for uptime increments, clamp temperature/humidity/CPU/signal values, create a de-duplicated alert when a device becomes `WARNING` or `OFFLINE`, and emit `alert_update`, `telemetry_update`, and `device_update` through one `RealtimeEvent` envelope.

Add `WebSocketService.broadcastEvent(String type, Object payload)` and have older helper methods delegate to it. Do not send a different shape for batched versus singular events.

- [ ] **Step 4: Run regression tests**

Run: `mvn -q -Dtest=DeviceSimulatorTest,DeviceControllerTest test`

Expected: safe newly-created devices, visible alerts, and stable event DTOs.

### Task 5: Implement Simulated LAN Discovery and Claiming

**Files:**
- Create: `backend/src/main/java/com/iot/manager/dto/LanCandidateView.java`
- Create: `backend/src/main/java/com/iot/manager/dto/ClaimLanDeviceRequest.java`
- Create: `backend/src/main/java/com/iot/manager/service/LanDiscoveryService.java`
- Create: `backend/src/main/java/com/iot/manager/controller/DiscoveryController.java`
- Modify: `backend/src/main/java/com/iot/manager/repository/DeviceRepository.java`
- Test: `backend/src/test/java/com/iot/manager/service/LanDiscoveryServiceTest.java`
- Test: `backend/src/test/java/com/iot/manager/controller/DiscoveryControllerTest.java`

- [ ] **Step 1: Write discovery lifecycle tests**

```java
@SpringBootTest
@ActiveProfiles("test")
class LanDiscoveryServiceTest {
    @Autowired LanDiscoveryService discovery;

    @Test
    void listsDemoCandidatesAndClaimsOneExactlyOnce() {
        LanCandidateView candidate = discovery.listCandidates("demo-site").getFirst();
        DeviceView claimed = discovery.claim(candidate.candidateId(), new ClaimLanDeviceRequest("demo-site", "/operations/field", "Pump A"));
        assertThat(claimed.name()).isEqualTo("Pump A");
        assertThatThrownBy(() -> discovery.claim(candidate.candidateId(), new ClaimLanDeviceRequest("demo-site", "/operations/field", "Again")))
            .isInstanceOf(IllegalStateException.class);
    }
}
```

- [ ] **Step 2: Run the failing test**

Run: `mvn -q -Dtest=LanDiscoveryServiceTest test`

Expected: compilation failure because discovery service and DTOs do not exist.

- [ ] **Step 3: Implement deterministic candidates and claim**

Use a small immutable in-memory catalog with fields `candidateId`, `name`, `model`, `ipAddress`, `transport`, `profileId`, and `signal`. `listCandidates(siteCode)` returns only unclaimed candidates. `claim` resolves the demo context, creates a `Device` with a `LAN_AGENT` connection, stores a `device_claimed` activity, marks the candidate claimed, and broadcasts `connection_update` and `activity_update`.

Expose:

```text
GET  /api/discovery/lan?siteCode=demo-site
POST /api/discovery/lan/{candidateId}/claim
```

Reject a missing site/space with `404 ApiProblem`; reject an already claimed candidate with `409 ApiProblem`.

- [ ] **Step 4: Run service and HTTP tests**

Run: `mvn -q -Dtest=LanDiscoveryServiceTest,DiscoveryControllerTest test`

Expected: candidates list, successful claim, and duplicate claim conflict all pass.

### Task 6: Implement Commands, Acknowledgements, and Activity Events

**Files:**
- Create: `backend/src/main/java/com/iot/manager/dto/DeviceCommandRequest.java`
- Create: `backend/src/main/java/com/iot/manager/dto/DeviceCommandView.java`
- Create: `backend/src/main/java/com/iot/manager/service/CommandService.java`
- Create: `backend/src/main/java/com/iot/manager/service/ActivityService.java`
- Create: `backend/src/main/java/com/iot/manager/controller/CommandController.java`
- Modify: `backend/src/main/java/com/iot/manager/controller/DeviceController.java`
- Test: `backend/src/test/java/com/iot/manager/service/CommandServiceTest.java`
- Test: `backend/src/test/java/com/iot/manager/controller/CommandControllerTest.java`

- [ ] **Step 1: Write command lifecycle tests**

```java
@SpringBootTest
@ActiveProfiles("test")
class CommandServiceTest {
    @Autowired CommandService commands;
    @Autowired LanDiscoveryService discovery;

    @Test
    void commandIsIdempotentAndAcknowledgesReportedState() {
        DeviceView device = claimOneLanDevice(discovery);
        DeviceCommandView first = commands.submit(device.id(), new DeviceCommandRequest("set_power", Map.of("on", true), "same-key"));
        DeviceCommandView same = commands.submit(device.id(), new DeviceCommandRequest("set_power", Map.of("on", true), "same-key"));
        assertThat(same.commandId()).isEqualTo(first.commandId());
        DeviceCommandView acknowledged = commands.processPending(first.commandId());
        assertThat(acknowledged.status()).isEqualTo("ACKNOWLEDGED");
        assertThat(acknowledged.reportedState()).containsEntry("power", true);
    }
}
```

- [ ] **Step 2: Run the failing test**

Run: `mvn -q -Dtest=CommandServiceTest test`

Expected: compilation failure because command service and command DTOs do not exist.

- [ ] **Step 3: Implement the persisted command flow**

`submit` creates or returns an existing command by `(device, idempotencyKey)`, stores `PENDING`, updates desired state only, and broadcasts `command_update`. A scheduled or explicitly invoked simulator execution changes it to `SENT`, then `ACKNOWLEDGED` or deterministic `FAILED`; only acknowledgement writes reported state. Every transition creates an `ActivityEvent` and broadcasts `activity_update`.

Expose:

```text
POST /api/devices/{id}/commands
GET  /api/commands/{commandId}
GET  /api/devices/{id}/activity
```

- [ ] **Step 4: Run command service and controller tests**

Run: `mvn -q -Dtest=CommandServiceTest,CommandControllerTest test`

Expected: idempotent submit, ACK, failure, activity history, and DTO endpoint contracts pass.

### Task 7: Build the Client Core and Connection Adapters

**Files:**
- Create: `client/src/js/api.js`
- Create: `client/src/js/command-state.js`
- Create: `client/src/js/adapters/connection-adapter.js`
- Create: `client/src/js/adapters/ble-profile-registry.js`
- Create: `client/src/js/adapters/ble-adapter.js`
- Create: `client/src/js/adapters/lan-mock-adapter.js`
- Modify: `client/src/js/store.js`
- Modify: `client/src/js/ble.js` or replace it with the adapter implementation
- Create: `client/test/command-state.test.js`
- Create: `client/test/ble-profile-registry.test.js`
- Create: `client/test/store.test.js`

- [ ] **Step 1: Write pure client tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionCommand } from '../src/js/command-state.js';

test('acknowledgement replaces desired state with reported state', () => {
  const next = transitionCommand({ desiredState: { power: true }, reportedState: { power: false } }, { status: 'ACKNOWLEDGED', reportedState: { power: true } });
  assert.deepEqual(next.reportedState, { power: true });
  assert.equal(next.commandStatus, 'ACKNOWLEDGED');
});
```

- [ ] **Step 2: Run the failing Node tests**

Run: `npm test`

Expected: module-not-found failure for `command-state.js`.

- [ ] **Step 3: Implement adapter contracts and normalized state**

Implement the exact contract:

```js
export class ConnectionAdapter {
  availability() {}
  requestCandidate() {}
  connect(candidate) {}
  getCapabilities() {}
  sendCommand(command) {}
  subscribe(listener) {}
  disconnect() {}
}
```

`BleAdapter` must call real `navigator.bluetooth.requestDevice()` only from a user click, connect through GATT, read generic Device Information or Battery services when present, subscribe to disconnect, and return no controls for an unknown profile. `BleProfileRegistry` maps known `profileId` values to service/characteristic identifiers and command encoders. `LanMockAdapter` calls the discovery, claim, command, and activity APIs and consumes normalized WebSocket events.

The store holds `devices`, `activeDeviceId`, `activeConnection`, `commandsById`, `activitiesByDeviceId`, and `connectionHealth`; it exposes immutable update helpers used by UI code.

- [ ] **Step 4: Run client core tests**

Run: `npm test`

Expected: command lifecycle, unknown profile, and store mutation tests pass without hardware or DOM.

### Task 8: Implement the Mobile/PDA Client Experience

**Files:**
- Create: `client/src/js/ui.js`
- Modify: `client/src/main.js`
- Modify: `client/src/css/style.css`
- Modify: `client/index.html`
- Modify: `client/vite.config.js`
- Modify: `client/package.json`
- Test: `client/test/ui-state.test.js`

- [ ] **Step 1: Write a UI-state test before rendering code**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceScreenState } from '../src/js/ui.js';

test('unknown BLE profile has metadata but no command controls', () => {
  const screen = deviceScreenState({ connection: { transport: 'BLE_DIRECT', profileId: null }, capabilities: [] });
  assert.equal(screen.showControls, false);
  assert.match(screen.notice, /暂无可用控制能力/);
});
```

- [ ] **Step 2: Run the failing UI-state test**

Run: `npm test`

Expected: module-not-found failure for `ui.js`.

- [ ] **Step 3: Implement screens and interaction flow**

Implement these screens in `ui.js`, keeping DOM creation and event binding localized:

1. Device list with organization/site context, empty state, connection status, and Add Device command.
2. Add Device choice with BLE and LAN routes.
3. BLE flow with supported-browser message, picker cancellation handling, connection result, generic metadata, and safe unknown-profile state.
4. LAN discovery list, claim form, and claim conflict state.
5. Device detail with capability-driven controls, desired/reported state, command chip, activity timeline, and retry action.
6. Connection diagnostic and offline/stale event states.

Use Lucide icons for navigation, add, scan, connect, activity, retry, and error controls. Do not place untrusted device names into `innerHTML`; create text nodes or escape every external field. Keep controls at fixed dimensions and make the viewport usable at 360 px wide and desktop widths.

`main.js` owns adapter creation, API bootstrap, store subscriptions, and event wiring. It must remove the nonexistent old import assumptions, avoid global inline `onclick`, and render through `ui.js` exports. `vite.config.js` reads `VITE_API_BASE_URL` and `VITE_WS_URL` with local proxy defaults.

- [ ] **Step 4: Run client tests and build**

Run:

```powershell
npm test
npm run build
```

Expected: all Node tests pass and Vite resolves every client module.

### Task 9: Connect Client and Backend End-to-End

**Files:**
- Modify: `backend/src/main/java/com/iot/manager/websocket/DeviceWebSocketHandler.java`
- Modify: `backend/src/main/java/com/iot/manager/websocket/WebSocketConfig.java`
- Modify: `client/src/js/adapters/lan-mock-adapter.js`
- Modify: `client/src/main.js`
- Create: `backend/src/test/java/com/iot/manager/DeviceLifecycleIntegrationTest.java`
- Create: `client/test/lan-event-reducer.test.js`

- [ ] **Step 1: Write an HTTP lifecycle integration test**

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class DeviceLifecycleIntegrationTest {
    @Autowired TestRestTemplate http;

    @Test
    void discoversClaimsCommandsAndReadsActivity() {
        LanCandidateView candidate = getFirstCandidate();
        DeviceView device = claim(candidate);
        DeviceCommandView command = submitPowerCommand(device.id());
        awaitAcknowledged(command.commandId());
        assertThat(readActivity(device.id())).extracting(ActivityView::eventType)
            .contains("device_claimed", "command_acknowledged");
    }
}
```

- [ ] **Step 2: Run the failing integration test before event wiring is complete**

Run: `mvn -q -Dtest=DeviceLifecycleIntegrationTest test`

Expected: failure at the first missing discovery/command/event behavior.

- [ ] **Step 3: Finish event envelope and client resynchronization**

Use a single envelope shape:

```json
{ "type": "command_update", "payload": {}, "timestamp": "2026-07-25T00:00:00Z", "version": 1 }
```

On WebSocket reconnect, the client must fetch devices and active-device activity before clearing the stale indicator. The handler continues to support `ping`/`pong`, but all outbound events go through `RealtimeEvent`. The LAN reducer must apply `device_update`, `connection_update`, `command_update`, `activity_update`, `alert_update`, and `telemetry_update` without full-page reloads.

- [ ] **Step 4: Run full lifecycle verification**

Run:

```powershell
cd backend; mvn test
cd ..\client; npm test; npm run build
```

Expected: backend lifecycle test and all existing/focused tests pass; client build succeeds.

### Task 10: Validate the Rendered Client and Existing Apps

**Files:**
- Modify: `README.md`
- Test: manual and browser validation only; do not add temporary artifacts to source directories

- [ ] **Step 1: Start the backend in the development profile**

Run: `mvn spring-boot:run -Dspring-boot.run.profiles=dev` from `backend`.

Expected: H2/Flyway startup succeeds, demo organization/context exists, and the simulator begins emitting events.

- [ ] **Step 2: Start the client and validate the target flow**

Run: `npm run dev` from `client`.

Target flow: app loads -> empty or seeded device list renders -> LAN discovery opens -> candidate is claimed -> device detail opens -> power command moves from pending to acknowledged -> activity timeline updates.

Use the frontend testing/debugging workflow to verify page identity, nonblank render, console health, a screenshot, and the target interaction at mobile and desktop dimensions. Do not claim a real BLE command works without a known physical GATT profile.

- [ ] **Step 3: Build regression surfaces**

Run:

```powershell
cd frontend; npm run build
cd ..\console; npm run build
cd ..\backend; mvn test
```

Expected: monitoring app, console app, and backend all build/test successfully after API changes.

- [ ] **Step 4: Update the runbook with verified commands and limitations**

Document exact verified commands, ports, data reset behavior, H2 development-only scope, BLE supported browser matrix, local HTTPS requirement for PDA BLE, simulated LAN limitations, and the known-profile requirement for real BLE controls.

## Plan Self-Review

- Spec coverage: Tasks 1-10 cover the approved mobile client, BLE shell, LAN simulation, command lifecycle, organization/location seams, simulator alerts, DTOs/events, migrations/profiles, testing, and operational documentation.
- Scope discipline: real LAN scanning, Edge Agent, full security, arbitrary BLE profiles, PostgreSQL, time-series storage, automation, and consumer UI remain deferred exactly as specified. HTTPS for non-local PDA BLE remains only as a browser compatibility prerequisite, while the broader TLS/WSS rollout stays deferred.
- Type consistency: `DeviceView`, `LanCandidateView`, `ClaimLanDeviceRequest`, `DeviceCommandRequest`, `DeviceCommandView`, `ActivityView`, `ConnectionAdapter`, and `RealtimeEvent` are introduced before their consumers.
- No Git commit steps are included because `git status` currently reports that the workspace is not a repository.
