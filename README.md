# IoT Manager

## Prerequisites

- Node.js 22+ and npm.
- JDK 17 for the Spring Boot backend. The host default Maven Java runtime may be Java 8, so select JDK 17 before running backend commands.
- JDK 21+ for Android builds. This project has been verified with `C:\Program Files\Java\jdk-23`; Capacitor 8.4.2 cannot be built with JDK 17 source compatibility.
- Android SDK Platform 36, Build Tools 36.0.0, platform tools, and an API 36 emulator or Android device for App verification.

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

### Mobile/web client (`http://localhost:5175`)

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

The Android App uses the native Capacitor BLE adapter. When the same client is opened in a browser, its Web Bluetooth fallback requires a secure context; plain HTTP on a LAN address will not enable browser BLE access.

### Basic prototype loop

- **Simulated LAN:** list candidates with `GET /api/discovery/lan?siteCode=demo-site`, claim one with `POST /api/discovery/lan/{candidateId}/claim`, then submit a command with `POST /api/devices/{id}/commands`. Command state progresses through `PENDING`, `SENT`, then `ACKNOWLEDGED` or `FAILED`; the client receives updates from `/ws/devices` and can query `GET /api/commands/{commandId}`.
- **BLE:** the Android App scans and connects through the native BLE plugin; the browser build retains a Web Bluetooth fallback. BLE bindings remain local to the App installation and are separate from simulated LAN discovery, so a local BLE device is not automatically registered as a backend LAN device.

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

## Android enterprise client

The Android App packages the existing `client` application with Capacitor. Android builds require JDK 21 or newer; the commands below use the JDK 23 installation verified on this machine. The backend continues to use JDK 17.

### Build the debug APK

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-23'
$env:ANDROID_SDK_ROOT = 'C:\Users\Raid\AppData\Local\Android\Sdk'
$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_SDK_ROOT\platform-tools;$env:Path"

Set-Location client
npm ci
npm run build
npx cap sync android
Set-Location android
.\gradlew.bat clean assembleDebug
```

The generated APK is `client/android/app/build/outputs/apk/debug/app-debug.apk`.

### Install and launch

From `client/android` with an emulator or Android device visible in `adb devices`:

```powershell
$adb = "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe"
& $adb install -r '.\app\build\outputs\apk\debug\app-debug.apk'
& $adb shell am start -n 'com.iot.manager.client/.MainActivity'
```

Open **连接设置** in the App to select a site API or cloud API profile. An Android emulator reaches services running on the host through these addresses:

```text
API:       http://10.0.2.2:8080/api
WebSocket: ws://10.0.2.2:8080/ws/devices
```

For a physical phone or PDA, replace `10.0.2.2` with the backend computer's reachable LAN address. `localhost` on Android refers to Android itself, not the development computer.

Plain HTTP, WS, and WebView mixed content are enabled only when the Android package is debuggable, for controlled local development. Release builds do not inherit those exceptions and will require production HTTPS/WSS configuration in the later security milestone.

### Runtime behavior

- Site and cloud profiles use the same replaceable platform adapter. `accessRoute` describes how the App reaches an operation; `deviceTransport` separately describes how the device reaches the platform boundary.
- Platform snapshots are cached by endpoint and organization. When a snapshot is stale or the endpoint is offline, it is read-only.
- Platform commands are not queued, automatically retried, or resent after lifecycle and endpoint changes. A manual retry creates a new command.
- A known BLE binding can connect and send supported commands without platform access. A write changes `desiredState`, but only a decoded notification, read-back, or response may change `reportedState`.
- A BLE profile that supports writes but has no reliable confirmation ends in `UNCONFIRMED`, displayed as **已发送，设备未提供确认**. This is not treated as an acknowledgement.

The API 36 emulator flow has been exercised for install, launch, navigation, and connection settings. Physical BLE permission, scan, connect, reconnect, known-profile command, and unknown-profile read-only checks still require compatible BLE hardware before production acceptance.

Authentication, RBAC, tenant enforcement, production certificates, background BLE, Edge Agent delivery, mini-program delivery, release signing, managed distribution, rate limits, and broader security hardening remain deferred milestones.
