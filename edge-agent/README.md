# IoT Manager Edge Agent

`edge-agent` is an independent Java 17 process intended to run inside a site LAN. It discovers and controls local devices, then uses one outbound WebSocket to report discovery, telemetry, and command results to IoT Manager. The backend accepts this protocol at `/ws/edge/v1`.

## What is included

- Durable UUID identity stored in a local JSON file. Restarting the same installation keeps the same agent ID.
- Versioned JSON WebSocket protocol DTOs for hello, heartbeat, discovery snapshots, telemetry, command requests, and command results.
- A JDK `HttpClient` WebSocket transport with a reconnecting runtime shell.
- Pluggable discovery and device-driver interfaces.
- A real Shelly Plus Plug S Gen2 local RPC driver. It uses `Shelly.GetDeviceInfo`, `Switch.Set`, and `Switch.GetStatus`; confirmation occurs only after state read-back.
- R1 per-agent credential headers with one-time provisioning, rotation, expiry, and revocation. The backend stores only a BCrypt digest.
- Focused tests for durable identity, protocol serialization, and the Shelly RPC flow.

The initial discovery source is explicit IP/URL configuration. Java SE does not provide mDNS browsing, so mDNS belongs in a later `DiscoverySource` implementation without changing the Shelly driver contract.

## Configuration

Copy `src/main/resources/edge-agent.properties.example` to a writable location such as `C:\ProgramData\iot-manager\edge-agent.properties` or `/etc/iot-manager/edge-agent.properties`. The identity file path is resolved relative to that configuration file when it is not absolute.

```properties
agent.name=plant-edge-01
agent.site-code=demo-site
agent.identity-file=./data/edge-agent/identity.json
backend.websocket.url=ws://platform.example/ws/edge/v1
# R1 production (use wss:// and inject values from a secret store):
backend.websocket.credential-id=agentcred-...
backend.websocket.credential-token=iat_...
heartbeat.interval.seconds=30
discovery.interval.seconds=60
reconnect.delay.seconds=5
request.timeout.seconds=5
shelly.endpoints=http://192.168.1.50
```

The agent sends an `agent_hello` immediately after the transport connects, then sends heartbeat and discovery messages. In the production profile the WebSocket handshake must carry `X-Iot-Agent-Credential` and `X-Iot-Agent-Token`; the hello's agent/site identity must match the credential binding. An unsupported or malformed command is reported as `REJECTED`; a transport/device failure as `FAILED`; and a write whose read-back cannot confirm the requested state as `UNCONFIRMED`.

## Build and run

Use JDK 17 or newer:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
Set-Location edge-agent
mvn test
mvn package
java -jar target/iot-edge-agent-0.1.0-SNAPSHOT.jar --config C:\ProgramData\iot-manager\edge-agent.properties
```

For Linux, use the same Maven commands and point `--config` at `/etc/iot-manager/edge-agent.properties`.

## WebSocket wire contract

Every message is a JSON envelope with `type`, `protocolVersion`, `messageId`, `sentAt`, and `payload`. The typed body is in `payload`.

```json
{
  "type": "agent_hello",
  "protocolVersion": 1,
  "messageId": "1d46f6c0-3c00-4fae-bccf-0e3c0e1265e9",
  "sentAt": "2026-08-03T10:00:00Z",
  "payload": {
    "agent": {
      "agentId": "8e359e82-2e2a-482a-b1b5-d6c1b4a27f27",
      "agentName": "plant-edge-01",
      "siteCode": "demo-site",
      "softwareVersion": "0.1.0-SNAPSHOT"
    },
    "drivers": []
  }
}
```

Supported message types are `agent_hello`, `agent_heartbeat`, `discovery_snapshot`, `telemetry`, `command_request`, and `command_result`. The server sends `command_request`; the agent treats `commandId` as an idempotency key while it is in flight and retains the latest 10,000 completed command results in memory. The backend persists the command transition audit and accepts only receipts from the Agent connected to the claimed device. R2 still adds mTLS and broader retry/observability hardening.

## Shelly Plus Plug S Gen2 behavior

The driver recognizes Gen2 Plus Plug S devices (`SPSW-104PE16*` or `PlusPlugS`) from `Shelly.GetDeviceInfo`. It implements the shared `shelly-plus-plug-s-v1` Profile through driver ID `shelly-plus-plug-s-rpc-v1` and exposes only `set_power` with a Boolean `on` parameter. It calls `Switch.Set?id=0&on=<value>`, then reads `Switch.GetStatus?id=0`; only a matching `output` becomes `ACKNOWLEDGED`.

Use a local network address reachable from the agent host. This module does not expose a listener and does not ask the cloud backend to access the LAN.
