# Capacitor Android Enterprise Client Design

## Status

Approved design direction; written specification awaiting user review. This document incorporates the architecture, mobile-flow, offline-runtime, and self-review decisions approved on 2026-07-26. Implementation must not silently broaden the first-delivery scope.

## Goal

Extend the existing `client` Vite application into an installable Android application for enterprise phones and PDAs without creating a separate product codebase.

The first Android delivery must let an operator:

1. Browse assigned or locally bound devices on a mobile screen, including a complete empty state.
2. Scan, connect, inspect, and safely control a supported BLE device through native Android BLE while offline.
3. Discover, claim, and control simulated LAN devices through an on-site Spring Boot endpoint.
4. Browse and control platform devices through a cloud Spring Boot endpoint when internet access is available.
5. See the current access route, device transport, command lifecycle, reported state, failures, and recent activity.

## Approved Product Decisions

- The primary package is an Android APK for enterprise phones and PDAs.
- The existing Vite `client` UI, store, capability model, and REST/WebSocket contracts remain the shared application layer.
- Capacitor provides the Android shell and native plugin bridge.
- Native Android BLE supports direct offline control for known profiles.
- LAN discovery and control continue through the backend. The App does not scan or control arbitrary LAN protocols directly.
- Remote control uses the Spring Boot REST and WebSocket contracts.
- A later mini-program reuses platform APIs for lightweight remote access; it is not part of this delivery and is not promised native BLE access.
- Future personal users reuse the same organization, site, space, device, and command model through a single-member organization rather than a parallel personal device model.

## First-Delivery Scope

### Included

- Capacitor Android shell inside the existing `client` project.
- Existing mobile UI packaged in the Android WebView.
- Runtime endpoint profiles for on-site and cloud Spring Boot deployments.
- Native BLE scan, connect, disconnect, capability discovery, known-profile command encoding, and device-confirmation handling.
- Local persistence for endpoint settings, cached platform summaries, local BLE bindings, local BLE activity, and last reported state.
- Android runtime permission and App foreground/background lifecycle handling.
- Simulated LAN discovery, claim, command, acknowledgement, and activity through the existing backend.
- Unit, integration, WebView browser, Android emulator, and physical BLE smoke checks appropriate to the feature boundary.
- A debug APK that can be installed on a supported Android phone or PDA.

### Deferred

- Authentication, RBAC enforcement, tenant authorization, production TLS/WSS rollout, certificate management, secret storage, rate limits, and production deployment hardening.
- Background BLE scanning, a foreground service, background command execution, push notifications, and automatic BLE reconnect while the App is not active.
- Direct UDP, mDNS, SSDP, Modbus, CoAP, MQTT, or subnet scanning from the App.
- A production Edge Agent implementation. The boundary is reserved behind the on-site backend.
- Offline LAN or cloud command queues.
- Upload or synchronization of local BLE activity.
- Durable cross-device BLE identity without a vendor serial number, claim token, or equivalent hardware identity.
- Release signing, store distribution, managed-device deployment, and production upgrade policy.
- A mini-program or consumer-specific UI.

## Corrected Architecture

The App access route and the device-side transport are different concepts and must not be represented by one field.

```text
Android App
  |
  +-- Capacitor shell
  |     +-- Android permissions
  |     +-- App lifecycle
  |     +-- native BLE plugin
  |
  +-- Shared Vite UI / store / capability controls
        |
        +-- ConnectionResolver
              |
              +-- NativeBleAdapter -------- Android BLE -------- Nearby BLE device
              |
              +-- PlatformAdapter
                    |
                    +-- EndpointProfile: SITE_API  ---- REST / WS ---- On-site Spring Boot
                    |                                      |
                    |                                      +-- Future Edge Agent ---- LAN devices
                    |
                    +-- EndpointProfile: CLOUD_API ---- REST / WS ---- Cloud Spring Boot
                                                               |
                                                               +-- Platform device route
```

### Two connection axes

| Axis | Values in the first delivery | Meaning |
| --- | --- | --- |
| `accessRoute` | `BLE_LOCAL`, `SITE_API`, `CLOUD_API` | How this App instance currently reaches the operation |
| `deviceTransport` | `BLE_DIRECT`, `LAN_AGENT` | How the device is connected at the device/platform boundary |

A remotely controlled device may therefore have `accessRoute=CLOUD_API` and `deviceTransport=LAN_AGENT`. The UI displays both concepts when useful and never relabels a remotely accessed LAN device as a direct internet device.

## Component Boundaries

| Component | Responsibility | Depends on |
| --- | --- | --- |
| `RuntimeConfigRepository` | Persist active endpoint profile, site/cloud API URL, WebSocket URL, and last organization context | Capacitor Preferences |
| `EndpointProfile` | Immutable validated API/WS configuration for `SITE_API` or `CLOUD_API` | Runtime configuration |
| `PlatformAdapterFactory` | Create a new platform session for one immutable endpoint profile | `ApiClient`, `RealtimeClient` constructors |
| `PlatformAdapter` | Discovery, claim, device reads, command submission, activity reads, and realtime events through one shared platform contract | `ApiClient`, `RealtimeClient`, active endpoint profile |
| `NativeBleAdapter` | Android BLE permissions, scan, connect, service discovery, read/write/notify, and disconnect events | Capacitor BLE plugin, `BleProfileRegistry` |
| `BleProfileRegistry` | Known service/characteristic definitions, capability mapping, command encoding, and confirmation decoding | Vendor/profile definitions only |
| `ConnectionResolver` | Select exactly one access route before a command is created | Active device, active endpoint, BLE connection state |
| `CacheRepository` | Partitioned device summaries, local bindings, last state, and recent local activity | IndexedDB in the WebView |
| Client store | In-memory unified view, desired/reported state, connection health, commands, alerts, and activity | Repositories and adapters |
| UI renderer | Mobile navigation, empty states, controls, connection labels, permission prompts, errors, and activity filters | Client store and actions |

`LanApiAdapter` and `RemoteApiAdapter` are not separate full implementations. `PlatformAdapter` is shared; the selected `EndpointProfile` changes its endpoint and access-route label. This prevents duplicate REST/WebSocket logic.

## Adapter Contracts

The current `ConnectionAdapter` contract remains the starting point, but native BLE and platform operations use focused interfaces so discovery and claim semantics are not forced into unrelated transports.

```js
NativeBleAdapter = {
  availability(),
  requestPermissions(),
  scan(),
  stopScan(),
  connect(candidate),
  getCapabilities(),
  sendCommand(command),
  subscribe(listener),
  disconnect()
}

PlatformAdapter = {
  listDevices(context),
  discoverLan(context),
  claimLan(candidate, claim),
  sendCommand(command),
  listActivity(deviceId),
  subscribe(listener),
  disconnect()
}

createPlatformAdapter(endpointProfile) -> PlatformAdapter
```

Screen code invokes application actions and never imports a native BLE plugin or constructs API URLs.

## Mobile Navigation and Pages

The current three-item mobile navigation remains:

1. `设备`: device inventory, organization/site context, connection health, and complete empty state.
2. `动态`: combined command, connection, activity, and alert timeline with filters.
3. `添加`: entry to BLE direct connection or LAN discovery and claim.

### Device flow

```text
Device list
  -> Add device
       -> BLE direct
            -> permission -> scan -> select -> connect -> identify profile -> local device detail
       -> LAN discovery
            -> site context -> discover -> select -> space/name -> claim -> platform device detail
  -> Device detail
       -> connection/access status -> reported/desired state -> capability controls -> command result
  -> Activity
       -> all / commands / connections / alerts
```

### Device detail requirements

- Display `accessRoute` and `deviceTransport` without conflating them.
- Render controls only from a known capability profile.
- Show `desiredState` separately from `reportedState`.
- Disable control while a command is pending on the same capability.
- Show last synchronization time when cached state is displayed.
- Unknown BLE profiles expose generic metadata and battery information when readable, but no guessed control buttons.

## Runtime Endpoint Switching

Vite environment variables provide only development defaults. An installed App must use runtime configuration.

1. `RuntimeConfigRepository` loads the selected endpoint profile during bootstrap.
2. The application creates `ApiClient`, `RealtimeClient`, and `PlatformAdapter` from that immutable profile.
3. Changing profile disconnects the old WebSocket, cancels in-flight reads where possible, clears active control state, and creates a fresh platform session.
4. The App refreshes devices and reported state before enabling controls on the new route.
5. A command already sent on the old route stays attached to that route and is never copied or automatically resent.

The UI always shows `现场 LAN`, `互联网远程`, or `BLE 本地` for the current access route.

## BLE Identity and Local Binding

Native BLE identifiers are treated as App-local connection handles, not permanent enterprise hardware identities.

```text
LocalDeviceBinding
  appInstallId
  pluginDeviceId
  optional profileId
  optional manufacturer/model/serial
  displayName
  lastConnectionState
  lastReportedState
  localOnly = true
  pendingOrganizationContext (optional, non-authoritative)
```

- A BLE device remains `仅本机` until an explicit future platform claim binds it to a stable hardware identity.
- Cached organization/site/space context is a pending display context and does not make the local binding an authoritative enterprise `Device`.
- Local bindings and cached platform devices use separate repository keys.
- Platform cache keys are partitioned by organization context and endpoint profile.
- Local BLE activity stays on the device in the first delivery and is not uploaded.
- Clearing App data may remove local-only bindings; the UI does not promise cross-install recovery.

## BLE Command Semantics

A successful BLE characteristic write is transport delivery, not proof that the physical device applied the state.

```text
PENDING -> SENT -> ACKNOWLEDGED
                -> UNCONFIRMED
                -> FAILED
```

- `SENT`: bytes were accepted by the Android BLE stack or characteristic write operation.
- `ACKNOWLEDGED`: a profile-defined notification, response payload, or explicit state read confirms the device result.
- `UNCONFIRMED`: the profile supports writing but exposes no reliable confirmation mechanism.
- `FAILED`: permission, connection, encoding, characteristic, write, response, or timeout failure.
- `reportedState` changes only from decoded notification/read/response data.
- A synthesized target state from command parameters may update `desiredState`, never `reportedState`.
- Unknown profiles cannot send commands.
- Manual retry creates a new command identifier. No retry is automatic after disconnect or route change.

Profiles must declare command encoding and one of: notification confirmation, read-back confirmation, response decoding, or no confirmation. The UI uses that declaration to select `ACKNOWLEDGED` or `UNCONFIRMED` behavior.

## Platform Command Semantics

The existing backend command flow remains:

```text
PENDING -> SENT -> ACKNOWLEDGED
               -> FAILED
```

- Every platform command contains a client-generated idempotency key.
- The backend's unique `(device_id, idempotency_key)` constraint remains the duplicate-submission guard.
- `reportedState` changes only when the platform receives or simulates acknowledgement.
- App access route and device transport remain separate metadata. Existing backend `source` semantics must not be used as the App access-route label.
- A timeout retains the previous reported state and exposes manual retry.

## Offline and Cache Rules

| Situation | Read behavior | Control behavior |
| --- | --- | --- |
| BLE connected, no network | Local binding, local activity, last/received BLE state | Known confirmed or unconfirmed profile commands are allowed |
| BLE disconnected | Cached local binding and last state | Disabled; reconnect is explicit |
| Site API unavailable | Site-partitioned cached summaries with stale timestamp | Disabled; no offline command queue |
| Cloud API unavailable | Cloud/organization-partitioned cached summaries with stale timestamp | Disabled; no offline command queue |
| Route changes during a command | Existing command remains visible on its original route | No migration, duplication, or automatic resend |

The first delivery does not implement offline platform synchronization. Repository interfaces are replaceable, but no outbox uploader or conflict resolver is included.

## Android Permissions and Lifecycle

### Permissions

| Capability | Behavior |
| --- | --- |
| Android 12+ BLE | Request `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` only when the operator enters the BLE flow |
| Android 11 and below | Request the location permission required by the selected BLE plugin and OS version only for scanning |
| Network | Declare `INTERNET` and `ACCESS_NETWORK_STATE` |
| Bluetooth disabled | Detect before scan and direct the operator to enable Bluetooth |
| Permission denied | Explain the missing capability and provide an App settings action; LAN/cloud features remain available |

### Lifecycle

- Use the Capacitor App lifecycle rather than browser `beforeunload` alone.
- On background: stop active scans, pause nonessential polling, and preserve visible connection state without promising background BLE control.
- On foreground: recheck permissions and Bluetooth state, reconnect WebSocket, refresh platform state, and verify the active BLE connection before enabling controls.
- Do not run background scans or a foreground service in the first delivery.

## Network Build Profiles

- Debug builds may enable cleartext traffic only for explicitly configured development or on-site HTTP endpoints so the prototype can reach a local Spring Boot server.
- Release builds do not inherit an unrestricted cleartext configuration. Production HTTPS/WSS, certificates, and endpoint hardening belong to the later security milestone.
- Runtime endpoint configuration validates scheme, host, and complete API/WebSocket paths before activating a profile.
- The backend's current open CORS and WebSocket behavior remains demonstration-only.

## Error Handling

| Situation | Required App behavior |
| --- | --- |
| BLE permission denied | Identify the missing permission and provide retry/settings actions |
| Bluetooth disabled | Explain that scanning requires Bluetooth and recheck after returning to the App |
| No BLE devices found | Explain distance, power, and advertising checks; allow rescan |
| BLE connect/GATT failure | Keep candidate metadata, mark controls read-only, and offer explicit reconnect |
| Unknown BLE profile | Show generic information only; hide unsupported controls |
| BLE write without confirmation | End as `UNCONFIRMED`; do not change reported state |
| Platform endpoint unavailable | Show cached state and last-sync time; disable platform commands |
| WebSocket disconnected | Mark state stale, reconnect, then REST-resynchronize before control resumes |
| LAN claim conflict | Refresh candidates and explain that the device was already claimed |
| Command failure or timeout | Retain reported state, show reason, and provide manual retry |
| Endpoint profile changed | Cancel/finish old reads, close old realtime connection, and refresh before enabling controls |

## Package and Tooling Baseline

The implementation plan should pin mutually compatible package versions in `client/package-lock.json`. The validated package family at specification time is:

- `@capacitor/core`, `@capacitor/android`, and `@capacitor/cli` 8.4.x.
- `@capacitor-community/bluetooth-le` 8.2.x, which requires Capacitor 8.
- Existing Node.js 24 satisfies the Capacitor 8 CLI requirement of Node.js 22 or later.

Before generating the Android project, the implementation must configure JDK 21 or newer and install the Android SDK platform, build tools, platform tools, and command-line tools required by the pinned Capacitor Android project. Capacitor 8.4.2 compiles with Java 21 source compatibility; this project was verified with JDK 23 for Android while retaining JDK 17 for the Spring Boot backend.

## Test Strategy

### JavaScript unit tests

- Runtime endpoint profile validation and adapter recreation.
- Connection resolver selection and no cross-route resend.
- Native BLE plugin wrapper with a fake plugin.
- BLE permission, scan, connect, disconnect, known/unknown profile, confirmation, unconfirmed write, timeout, and retry cases.
- Cache partitioning by endpoint and organization context.
- Desired/reported state transitions including `UNCONFIRMED`.
- App lifecycle foreground/background reducers.

### Backend tests

- Existing discovery, claim, command, idempotency, acknowledgement, activity, and migration tests remain passing.
- Any added request metadata must preserve current API compatibility and validate allowed enum values.
- Site/cloud route metadata must not replace the device transport stored on `DeviceConnection`.

### Browser/WebView tests

- Mobile empty state and bottom navigation.
- BLE and LAN add paths with adapter fakes.
- Connection-route and device-transport labels.
- Cached stale state and disabled controls.
- Command state, failure, unconfirmed state, and manual retry.
- 390px mobile layout without horizontal overflow or overlapping controls.

### Android checks

- `npx cap sync android` succeeds from a clean client install.
- Gradle `assembleDebug` produces an installable APK.
- Emulator smoke test covers App bootstrap, site/cloud endpoint configuration, navigation, and mocked platform flows.
- Physical Android device smoke test covers permission request, scan, connect, disconnect, and generic metadata.
- A known BLE hardware profile is required before claiming that a physical control command is verified end to end.

## Acceptance Criteria

1. The existing `client` is the only shared operational UI source and remains browser-buildable.
2. Android project generation and synchronization are reproducible from documented commands.
3. A debug APK installs and opens on a supported Android phone or PDA.
4. Device, Dynamic, and Add navigation work at mobile widths with empty data.
5. Operators can configure and visibly distinguish site and cloud endpoint profiles at runtime.
6. Platform state refresh completes before controls are enabled after endpoint or lifecycle changes.
7. Simulated LAN discovery, claim, command, acknowledgement, and activity work through `PlatformAdapter`.
8. Native BLE permission, scan, connect, disconnect, and safe unknown-profile behavior work on Android.
9. Known-profile BLE control never turns a write completion into reported device state without profile-defined confirmation.
10. Offline BLE control works for a connected known device without the backend.
11. Offline site/cloud views are clearly stale and do not queue commands.
12. Local-only BLE bindings are not presented as authoritative platform devices.
13. Cached platform data is partitioned by endpoint and organization context.
14. In-flight commands are not copied or automatically resent when route or network state changes.
15. Existing client and focused backend tests remain passing, and Android-specific tests cover the native adapter boundary.
16. Existing `frontend` and `console` applications remain buildable.

## Implementation Sequence Boundary

The implementation plan should divide work into these ordered units:

1. Capture the existing project files as an intentional Git baseline and configure Android toolchain prerequisites.
2. Add Capacitor dependencies, configuration, and Android project generation to the existing `client`.
3. Add runtime endpoint profiles and refactor platform client construction.
4. Add App lifecycle integration and partitioned cache repositories.
5. Add the native BLE adapter and extend profile confirmation semantics.
6. Wire the existing UI/store to the resolver without duplicating screens.
7. Add Android permissions, debug network configuration, and actionable error states.
8. Verify browser, backend, emulator, APK, and physical BLE flows.

Security hardening, production distribution, Edge Agent implementation, mini-program delivery, and personal-user UI remain separate future specifications.
