# IoT Manager

## Prerequisites

- Java 17. The host default Maven Java runtime may be Java 8, so select Java 17 before running backend commands.
- Node.js and npm.

## Run locally

Open separate PowerShell windows for each service.

### Backend API (`http://localhost:8080`)

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
Set-Location backend
mvn spring-boot:run
```

The default `dev` profile uses a local file-backed H2 database at `backend/data/iotdb` and exposes the H2 console at `http://localhost:8080/h2-console`. H2 and its console are development-only; do not use either for a production deployment.

Flyway V1 creates the current `devices` and `alerts` foundation schema for a new database. The dev profile uses `baseline-on-migrate` so an existing local H2 database is registered at V1 and then checked by Hibernate validation, rather than being recreated or mutated by Hibernate.

### PDA client (`http://localhost:5175`)

```powershell
Set-Location client
npm install
npm run dev
```

For the local Vite proxy, no environment values are required. When the PDA client needs to connect to a backend endpoint explicitly, use the API prefix and the complete WebSocket endpoint:

```powershell
$env:VITE_API_BASE_URL = 'http://localhost:8080/api'
$env:VITE_WS_URL = 'ws://localhost:8080/ws/devices'
npm run dev
```

Web Bluetooth requires a secure context on a PDA. Serve the client over HTTPS on the device; plain HTTP on a LAN address will not enable BLE access. This is a browser compatibility prerequisite, not a claim that the prototype has completed its production TLS/WSS security work.

### Basic prototype loop

- **Simulated LAN:** list candidates with `GET /api/discovery/lan?siteCode=demo-site`, claim one with `POST /api/discovery/lan/{candidateId}/claim`, then submit a command with `POST /api/devices/{id}/commands`. Command state progresses through `PENDING`, `SENT`, then `ACKNOWLEDGED` or `FAILED`; the client receives updates from `/ws/devices` and can query `GET /api/commands/{commandId}`.
- **BLE:** the PDA client provides a browser-local Web Bluetooth GATT shell. An operator gesture opens the browser device picker, then the client connects to GATT and writes supported characteristics. It is separate from simulated LAN discovery and does not automatically register a backend LAN device.

## Prototype Security Boundary

The first delivery prioritizes the device lifecycle, simulated LAN flow, BLE connection shell, command acknowledgement, activity history, and replaceable adapter boundaries. Authentication, RBAC, tenant enforcement, secret storage, production TLS/WSS, rate limits, and production hardening are deliberately deferred.

The development profile currently uses open CORS, an open WebSocket endpoint, the H2 console, and global demo events. Keep it in a controlled local or demonstration environment; do not expose it as an enterprise production service. Organization, site, space, command-source, activity, and adapter seams remain in place for the later security milestone.

### Operations frontend (`http://localhost:5173`)

```powershell
Set-Location frontend
npm install
npm run dev
```

### Operations console (`http://localhost:5174`)

```powershell
Set-Location console
npm install
npm run dev
```

## Verify

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
Set-Location backend
mvn -q -Dtest=IotManagerApplicationTest test
```

```powershell
Set-Location client
npm test
npm run build
```

Build the other Vite applications with `npm run build` from `frontend` or `console`.
