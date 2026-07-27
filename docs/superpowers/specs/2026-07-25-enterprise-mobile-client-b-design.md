# Enterprise Mobile Client B Design

## Status

Approved design direction. This document defines the scope before implementation.

## Goal

Deliver a mobile/PDA-first enterprise device client that lets a field operator:

1. Browse an initially empty or simulated device inventory.
2. Add a nearby Bluetooth Low Energy (BLE) device through a real browser device-selection and GATT connection flow.
3. Discover, claim, and control simulated LAN devices through the platform API.
4. Inspect connection health, device capabilities, command outcomes, and recent activity.
5. Use one client information model that can later serve personal users without creating a separate device product.

The first delivery is a usable and demonstrable client surface. It does not promise control of arbitrary real BLE hardware or direct browser LAN scanning.

## Product Positioning

- Primary user: enterprise field operator using a phone or PDA.
- Primary form factor: mobile portrait first, with responsive desktop support for review and light operations.
- Existing `console` remains the administrative CRUD surface. The new client is the operational device-use surface.
- Future personal users reuse the same organization, site, space, device, connection, and command concepts.

## Framework Assessment

### Why the current project is a valid starting point

- The three existing frontend roles are useful boundaries: monitoring (`frontend`), administration (`console`), and field operation (`client`). They can remain independent Vite applications during the first framework phase.
- Spring Boot, JPA, WebSocket, H2, and the simulator are sufficient to build a complete hardware-free development loop before real devices or a gateway exist.
- A modular monolith is the correct next step. It keeps discovery, device, connection, command, telemetry, alert, and activity workflows transactional and easy to test. Microservices, a message broker, and a time-series platform are not justified yet.
- The approved B route is practical: browser BLE covers a real nearby-device path, while LAN simulation gives a controllable end-to-end workflow before an Edge Agent is available.

### Why the current project is not yet a practical device platform

- `client` cannot build because its entry point imports a missing `ui.js` module.
- The backend has inventory CRUD and random telemetry, but no device discovery, claim, connection record, command resource, acknowledgement, capability model, or activity event.
- The simulator can change a status but does not create alerts, so the alert UI has no authentic source of events.
- A newly created device can have null telemetry fields even though the simulator performs numeric updates on them; the simulated development loop is therefore not reliable.
- Current API entities are also database entities and UI contracts. The platform needs DTOs and event envelopes before multiple clients depend on the same shape.
- There is no automated test suite, migration mechanism, root-level runbook, API/WS production base URL configuration, or repeatable environment profile.

## Required Foundation Scope

The following capabilities are necessary for the project to become a usable framework with basic functions. They are part of the first construction phase, not later polish.

### 1. Device lifecycle

```text
discover -> claim -> register -> connect -> operate -> report -> alert -> retire
```

- Discovery candidates are separate from registered devices.
- Claiming assigns organization, site, space, display name, and connection route.
- Retirement or archival replaces blind hard deletion so commands, alerts, and activity history remain meaningful.

### 2. Connection and capability model

- Add `DeviceConnection` rather than using a single `Device.protocol` string as the only transport model.
- Add a capability view such as `power`, `level`, `mode`, `read_only_telemetry`, and `generic_information` so controls are rendered from known support, not device type guesses.
- Keep the page layer transport-neutral through `BleAdapter`, `LanMockAdapter`, and future `EdgeAgentAdapter` boundaries.

### 3. Command, activity, and state model

- Persist `DeviceCommand` with idempotency key, source, timestamps, state, failure reason, and result payload.
- Separate `desiredState` from `reportedState`.
- Record `ActivityEvent` for discovery, claim, connect, disconnect, command, acknowledgement, telemetry threshold, and alert resolution.
- Normalize real-time messages into one versioned event envelope instead of mixing full entities and partial updates.

### 4. Telemetry and alert loop

- Keep a current telemetry snapshot on the device for fast lists and details.
- Store a bounded low-frequency telemetry history for charts and diagnosis; a dedicated time-series database is deferred until volume requires it.
- Make the simulator produce deterministic alert conditions, create alert records, broadcast alert events, and support resolution.

### 5. Organization and location seams

- Seed one `Demo Organization`, `Demo Site`, and a small `Space` tree in development.
- Add organization, site, and space context to view models and discovery requests even while authentication is deferred.
- Future personal users map to a single-member organization and a home/room space tree.

### 6. Delivery foundation

- Use DTOs, request validation, consistent problem responses, API versioning, and WebSocket event schemas for all new endpoints.
- Add a development profile with H2 and simulator data, plus a production-shaped profile that makes PostgreSQL migration possible later.
- Introduce database migrations before new domain tables are added; do not rely on `ddl-auto:update` for repeatable environments.
- Provide root-level setup/run/build/test instructions, package lockfiles, `.gitignore`, and a version-control repository before broad parallel development.
- Configure API and WebSocket base URLs through client environment variables rather than Vite development proxy only.

## Explicitly Deferred

- Authentication, RBAC enforcement, secret storage, TLS/WSS rollout, audit-security policy, rate limits, and production key management. These are not first-delivery acceptance criteria; their data and API boundaries are reserved now so the later security milestone does not require a new device model.
- True LAN discovery and protocol adapters. These move to an Edge Agent or native application after the simulated LAN workflow is proven.
- Broad vendor BLE support. A known BLE profile can be added once Service UUIDs, Characteristic UUIDs, and command encoding are available.
- PostgreSQL, a time-series database, high availability, multi-site gateway fleet management, offline synchronization, notifications, automation rules, work orders, and batch control.
- A consumer-specific UI. The personal product will reuse the organization/site/space/device model after the enterprise operational loop is stable.

## First Delivery Scope

### Client views

| View | Purpose | Initial data behavior |
| --- | --- | --- |
| My devices | Show assigned or site-scoped devices, connection status, and empty state | Starts empty when no devices exist; supports simulated LAN devices after discovery |
| Add device | Select BLE or LAN connection path | BLE opens real browser selection; LAN lists simulated candidates |
| BLE claim | Identify and name an already-connected GATT device | Reads available generic metadata; unknown profiles remain connectable but not controllable |
| Device detail | Show reported state, desired state, capabilities, connection state, and activity | Capability-driven controls; no control is shown for unknown profiles |
| Control action | Submit power, level, mode, or profile-defined command | Displays `PENDING`, `SENT`, `ACKNOWLEDGED`, or `FAILED` |
| Activity | Show connection events, commands, acknowledgements, and failures | Uses local events plus simulated backend events |

### BLE path: real connection shell

1. The operator taps the BLE add action.
2. `BleAdapter.requestCandidate()` calls `navigator.bluetooth.requestDevice()` from that direct user gesture.
3. `BleAdapter.connect()` establishes a GATT session and listens for disconnection.
4. `BleProfileRegistry` matches a known Service UUID and builds a capability set.
5. The client shows generic device information when available.
6. Known Profiles may encode a command and wait for a GATT response or notification before acknowledging it.
7. Unknown Profiles show `Connected` with no unsafe generic controls.

The browser-provided `BluetoothDevice.id` is a local browser identifier, not a durable platform hardware ID. Durable identity must later come from a vendor serial number, certificate, or a scanned claim token.

### LAN path: platform simulation

1. The operator selects the active site and opens LAN discovery.
2. `LanMockAdapter` requests simulated discovery candidates from the backend.
3. The operator claims a candidate into a site/space and gives it a display name.
4. Device controls submit a command to the backend.
5. The backend emits an asynchronous acknowledgement, reported-state update, or failure event.
6. The client updates status only from the acknowledgement and reported state.

The browser must not attempt UDP broadcast, mDNS, SSDP, port scans, or direct Modbus discovery. A later on-site Edge Agent or native client will own those operations.

## Non-Goals

- No promise that arbitrary BLE devices can be controlled without a supplied GATT profile, Service UUIDs, Characteristic UUIDs, and command encoding.
- No direct LAN subnet discovery from the browser.
- No production multi-tenant security claim until the backend has authentication, organization scoping, RBAC, HTTPS, and WSS.
- No duplicate personal-user device model.
- No replacement of the existing admin console in this delivery.
- No microservice split, message broker, or time-series database before the modular-monolith workflow requires it.

## Architecture

```text
Mobile/PDA client
  |
  +-- Device screens, activity timeline, command state UI
  |
  +-- ConnectionAdapter
       |
       +-- BleAdapter ------------ GATT ------------ Nearby BLE device
       |
       +-- LanMockAdapter -------- REST / WS ------- Spring Boot simulator
                                                     |
                                                     +-- Later: Edge Agent
                                                               |
                                                               +-- MQTT / HTTP / Modbus / CoAP
```

The screen layer never directly invokes Web Bluetooth or a backend endpoint. It works through an adapter contract:

```js
ConnectionAdapter = {
  availability(),
  requestCandidate(),
  connect(candidate),
  getCapabilities(),
  sendCommand(command),
  subscribe(listener),
  disconnect()
};
```

### Responsibilities

| Module | Responsibility |
| --- | --- |
| `BleAdapter` | Browser availability, user-initiated device request, GATT connection, generic information reads, disconnect events |
| `BleProfileRegistry` | Known vendor profile lookup, capability discovery, GATT command encoding, acknowledgement/notification decoding |
| `LanMockAdapter` | LAN discovery and claim API calls, command submission, simulated event subscription |
| Client store | Unified device view model, active device, connection state, command state, activity log |
| UI renderer | Empty states, add flow, capability controls, status chips, errors, and responsive layout |
| Backend simulator | Simulated LAN candidates, claims, asynchronous command outcomes, and event stream |

## Command and State Semantics

Every user action produces a `DeviceCommand`; controls never modify a device's reported state directly.

```text
PENDING -> SENT -> ACKNOWLEDGED
               \-> FAILED
```

- `desiredState`: the requested outcome, shown while a command is pending.
- `reportedState`: the most recent confirmed device state.
- `commandStatus`: the lifecycle state and failure reason for a particular operation.
- A timed-out command becomes `FAILED` with a retry action; it does not silently become successful.

## Proposed Backend Contract

The current `/api/devices` CRUD API remains compatible during the transition. New simulated-LAN endpoints are versioned and scoped by site once organization support lands.

```text
GET  /api/discovery/lan?siteId={siteId}
POST /api/discovery/lan/{candidateId}/claim
POST /api/devices/{deviceId}/commands
GET  /api/commands/{commandId}
WS   connection_update | command_update | telemetry_update
```

Command request shape:

```json
{
  "type": "set_power",
  "parameters": { "on": true },
  "idempotencyKey": "client-generated-uuid",
  "source": "mobile_client"
}
```

Command update shape:

```json
{
  "commandId": "...",
  "deviceId": "...",
  "status": "ACKNOWLEDGED",
  "reportedState": { "power": true },
  "timestamp": "..."
}
```

## Domain Boundary for Enterprise and Personal Users

```text
Tenant
  -> Organization
      -> Site
          -> Space (tree)
              -> Device
                  -> DeviceConnection
                  -> Capability / reported state / desired state
                  -> DeviceCommand / Alert
```

- A device belongs to an organization, not directly to one user.
- `Site` and a parent-linked `Space` tree model a factory, shop, office, home, room, or zone without fixed hierarchy tables.
- `OrganizationMembership` owns user access. First enterprise roles are `ORG_ADMIN`, `SITE_MANAGER`, `TECHNICIAN`, `OPERATOR`, and `VIEWER`.
- A future personal account is a single-member organization. A home is a site, and rooms are spaces.
- `DeviceConnection` records a device route such as `BLE_DIRECT`, `LAN_AGENT`, `MQTT`, `HTTP`, `MODBUS`, or `COAP`; secrets never return to the client.

## Runtime Compatibility and Deferred Security

- Web Bluetooth production support is Chromium-only: Android Chrome and desktop Chrome/Edge are the target browsers. Safari/iOS and Firefox are not promised Web Bluetooth targets.
- Web Bluetooth requires a secure context. `localhost` is allowed for development; deployment to a PDA over a LAN IP must use HTTPS. This is a browser platform prerequisite for BLE, not a requirement to complete the broader TLS/WSS security rollout in this phase.
- BLE selection must always originate from a user interaction.
- The current backend's open CORS, open WebSocket, H2 console, and global event broadcast are intentional demonstration-only behavior. They must not be treated as a production deployment configuration.
- The first-delivery functional boundary remains: organization/site/space context, command source, activity history, and transport adapters are persisted or modeled, but no login, role check, tenant filter, secret exchange, or production certificate management is implemented yet.
- A dedicated security milestone becomes mandatory before any deployment beyond a controlled demonstration environment. That milestone must add server-side authentication, authorization, organization filtering, transport protection, secret handling, and deployment hardening together.
- Existing flat `Device` fields remain temporarily compatible, but the client uses an adapter view model rather than treating the current entity as the permanent public contract.

## Error Handling

| Situation | Client behavior |
| --- | --- |
| Web Bluetooth unavailable | Explain supported browser requirement and keep LAN path available |
| User cancels BLE picker | Return to add-device screen without an error toast |
| GATT connect fails | Preserve candidate metadata, show retry and diagnostic event |
| Unknown BLE profile | Show connected state and generic metadata; hide unsupported controls |
| LAN candidate claim conflict | Refresh candidates and explain the candidate is already claimed |
| Command times out | Mark command failed, retain reported state, provide retry |
| Backend event disconnects | Show stale state indicator and reconnect without falsely showing live control success |

## Acceptance Criteria

1. The client has a mobile-first responsive device list with a coherent empty state.
2. An operator can initiate a browser BLE picker and complete a GATT connection when the browser and hardware support it.
3. The UI distinguishes supported device capabilities from an unknown BLE profile.
4. A simulated LAN candidate can be discovered, claimed, and shown in the device list.
5. A LAN command visibly moves through the command state lifecycle and updates reported state only after acknowledgement.
6. Connection, command, and failure events appear in an activity view.
7. The client keeps transport-specific logic outside page-rendering code.
8. No client behavior assumes a device belongs to a single user; data boundaries allow organization, site, and space context.
9. The existing frontend and console remain buildable after the change.
10. A newly created or claimed device has safe telemetry defaults and cannot crash the simulator.
11. Simulated warning/offline conditions create alerts and activity events that can be resolved through the existing interfaces.
12. Every new endpoint uses a DTO, stable response/error shape, and documented event type.
13. A fresh development environment can seed demo data, build every runnable frontend, and execute focused backend/client tests from documented commands.
14. API and WebSocket URLs are configurable for local PDA testing; the BLE target documents the HTTPS requirement.

## Test Strategy

- Unit tests: client store, command state transitions, adapter capability mapping, GATT-profile encoding/decoding helpers, and LAN mock event handling.
- Component/browser tests: empty state, add-device choice, unknown-profile state, simulated LAN claim, command acknowledgement, failure/retry, and responsive mobile layout.
- Backend tests: discovery candidates, claim conflict, command idempotency, lifecycle events, alert generation, safe simulator defaults, DTO validation, and site/organization filtering when introduced.
- Manual hardware check: Chromium browser on a supported machine with a known BLE profile. A hardware-free test suite must still cover all simulation paths.
- Engineering checks: migrations apply to an empty database, all client package builds complete from a clean install, and profile-specific startup is documented.

## Delivery Sequence

1. Restore normal version-control hygiene, root documentation, package lockfile coverage, development profile, migrations, and a repeatable build/test entry point.
2. Repair the client entry point and establish the mobile UI/store architecture.
3. Repair current CRUD/simulator/alert inconsistencies so demo data is safe and alerting has a real source.
4. Add default organization, site, space, device lifecycle, DTO/event envelope, and adapter seams.
5. Implement simulated LAN discovery, claim, commands, acknowledgements, activity events, and client command lifecycle UI.
6. Implement the BLE connection shell, profile registry, and safe unknown-profile behavior.
7. Add bounded telemetry history, chart/query endpoints, and reconnect/resynchronization behavior.
8. Verify client, backend, existing frontend, and console builds plus focused unit, integration, and browser tests.
