# IoT Manager P0 / R1 Docker 运行手册

本目录提供 PostgreSQL 16、Keycloak、Spring Boot Backend、Caddy、逻辑备份和
WAL-G 的单主机 Compose 运行态。它用于完成 P0 缺陷闭环和 R1 受控试点，不代表
Redis、mTLS、多实例、工单/报表或真实设备 Gate 3 验收已经完成。

代码已实现两阶段启动、最小权限数据库账户、OIDC/PKCE、TLS/WSS、备份和恢复
演练入口；是否可作为发布依据仍以 CI 与目标主机产生的 Gate 2 运行证据为准。

## 对外边界

| 用途 | 地址 |
| --- | --- |
| 监控端 | `https://<DOMAIN>/` |
| 控制台 | `https://<DOMAIN>/console/` |
| REST API | `https://<DOMAIN>/api/v1` |
| 设备 WebSocket | `wss://<DOMAIN>/ws/devices` |
| Edge Agent WebSocket | `wss://<DOMAIN>/ws/edge/v1` |
| Keycloak | `https://<DOMAIN>/auth/` |

宿主机只发布 Caddy 的 `80/443`。PostgreSQL、Keycloak 管理端口 `9000`、Backend
端口 `8080`、H2 Console 和 Actuator 均不通过 Caddy 暴露；公网访问
`/h2-console`、`/actuator/**` 必须是 `404`。

## R1 observability profile / R1 可观测性

Prometheus and Alertmanager are an internal-only R1 profile. Neither service
publishes a host port, Caddy deliberately returns `404` for every
`/actuator/**` path, and the Backend accepts `/actuator/prometheus` only when
the caller supplies the Docker-secret-backed `X-Iot-Metrics-Token` header.
No Keycloak role can obtain that authority.

For an integration run that includes the profile:

```powershell
.\scripts\runtime\start-integration.ps1 -Observability -Verify
```

```bash
IOT_ENABLE_OBSERVABILITY=true bash scripts/runtime/start-integration.sh --verify
```

The verification script proves the public `404`, a private authenticated
scrape, and an `up` Prometheus target before storing redacted evidence. The
GitHub `P0 Docker Runtime` workflow enables this profile automatically.

## Runtime secret delivery

`IOT_SECRET_DIR` is a host directory, not a Docker-managed secret object.
Compose `file:` secrets are bind mounts and retain the host UID; a `0600` file
owned by the deployment account is therefore unreadable by the deliberately
non-root PostgreSQL, Backend, Keycloak, WAL-G and Prometheus containers on a
Linux runner. The one-shot `secret-volume-init` service copies the required
source values into one named volume per service. It assigns each target
directory `0700` and each target file `0400` to that service's runtime UID.

Keep the host directory root-controlled (`0700`) with non-empty, LF-terminated
`0400` files. Do not put secret values in `.env`. The initializer gives each
service only its minimum set: for example, `backup` receives the owner database
credential but never the Backend DML credential, and Prometheus receives only
the scrape token. The runtime validation asserts those positive and negative
mount checks.

After an approved secret rotation, stop the dependent services, recreate
`secret-volume-init`, then restart the affected services so they reopen their
private volumes. Database-role password rotation remains a separately planned,
transactional operation; do not overwrite a running database credential by
editing a source file alone.

Keycloak keeps the public `https://<DOMAIN>/auth` issuer fixed and enables its
documented dynamic backchannel only for private Docker-network clients. This
allows the bootstrap/reconciliation helpers to use the internal endpoint before
public DNS and Caddy are available; Keycloak itself has no published host port.

## 前置条件

- Linux Docker Engine 与 Docker Compose v2；不要只安装 Docker Client。
- 生产域名的 A/AAAA 记录已经指向主机，防火墙仅开放 TCP 80/443。
- 从完整仓库根目录执行命令；Backend、Caddy、Keycloak 和 PostgreSQL 镜像都依赖
  仓库中的 Docker build context。
- 生产主机应至少预留 4 CPU、8 GB 内存和 20 GB 可用磁盘，并在启动前确认没有占用
  80/443 的现有服务。
- 禁止使用 `docker compose down -v` 清理任何已知或未知的生产数据卷。

## 集成环境：一键全链路启动

集成环境固定使用 `iot-manager.localhost` 与 Caddy 内部 CA，不需要公网 DNS。脚本
会生成被 Git 忽略的临时 Secret，并将 OWNER、ADMIN、OPERATOR、VIEWER 四个集成
验收账户的 Keycloak subject 写入受保护的运行态文件。

PowerShell：

```powershell
.\scripts\runtime\start-integration.ps1 -Verify
```

Linux/macOS/Git Bash：

```bash
bash scripts/runtime/start-integration.sh --verify
```

该命令按以下固定顺序执行：

1. 创建 `deploy/.env.integration`（若不存在）与
   `deploy/.runtime/iot-manager-p0/secrets/`；Secret 不写入 `.env`。
2. 启动 `volume-init → postgres → keycloak → caddy`。Caddy 只依赖 Keycloak，
   因此 Backend 尚未启动时 `/auth/**` 仍可访问。
3. 幂等收敛 Keycloak Realm、Role 和 public client，并创建/更新四个测试角色。
   引导账户会写入完整的必填用户资料，避免 PKCE 登录被 Keycloak
   重定向到资料补全页；脚本只输出非敏感 subject，不输出密码或 token。
4. 启动 Backend、逻辑备份、WAL-G 归档和 base-backup sidecar。
5. `-Verify`/`--verify` 等待全部健康后验证 HTTPS、HTTP→HTTPS、401、H2 404、
   CORS、1 MB 请求体限制、安全响应头及仅 Caddy 发布端口，并把无 Secret 的证据放在
   `artifacts/p0-runtime/<UTC 时间>/`。

集成 CA 不会安装到系统信任库；运行验证会从 Caddy 私有 volume 导出 CA，并仅传给
测试进程。GitHub Actions `P0 Docker Runtime` 工作流会进行浏览器端
PKCE/JWT/RBAC/WSS 验证，并使用一次性 OWNER 签发的 Edge Agent 凭据验证 Caddy
WSS header 透传、受凭据保护的 agent hello 和吊销后拒绝连接。

### R1 integration identity matrix

The integration environment creates real `OWNER`, `ADMIN`, `OPERATOR`, and
`VIEWER` Keycloak accounts. The owner is authorized for both `primary-site`
and `restricted-site`; the other three accounts receive only `primary-site`.
This is deliberate: the runtime suite proves both role behavior and cross-site
denial. These accounts are integration-only and must remain disabled in a
normal production `.env` unless an approved membership plan explicitly adds
them.

## 生产环境：受控两阶段启动

1. 创建非敏感配置与 root 管理的 Secret 目录。`.env` 绝不能放密码、HMAC、访问密钥
   或 Bearer Token。

   ```bash
   cp deploy/.env.example deploy/.env
   chmod 600 deploy/.env
   sudo install -d -m 0700 /etc/iot-manager/secrets
   sudo install -m 0400 /secure-source/<secret-name> /etc/iot-manager/secrets/<secret-name>
   ```

   所需 Secret 文件名为：`postgres_admin_password`、`iot_db_owner_password`、
   `iot_db_app_password`、`keycloak_db_password`、
   `keycloak_bootstrap_admin_password`、`keycloak_owner_password`、
   `keycloak_admin_password`、`keycloak_operator_password`、`keycloak_viewer_password`、
   `weather_fingerprint_secret`、`metrics_scrape_token`、
   `walg_s3_access_key`、`walg_s3_secret_key`。设置
   `IOT_SECRET_DIR=/etc/iot-manager/secrets`。

2. 填写 `DOMAIN`、ACME 邮箱、精确的 Web/Console Redirect URI、移动回调 URI 和
   OWNER 组织/站点信息。`IOT_DASHBOARD_REDIRECT_URI` 只能是根路径，
   `IOT_CONSOLE_REDIRECT_URI` 只能是 `/console/`；禁止 `/*`。

3. 配置生产备份。模板默认 `WALG_STORAGE_MODE=s3`，必须将
   `WALG_S3_PREFIX` 指向已启用服务器端加密、版本化和 Object Lock/不可变保留策略的
   专用 bucket 前缀。未提供该配置时 WAL-G 进程会失败而不是静默退回本地文件系统。
   `filesystem` 仅允许 `docker-compose.integration.yml` 的隔离验收环境。

4. 启动身份平面，收敛 Realm 并创建第一个 OWNER。生产调用只使用基础 Compose 文件：

   ```bash
   export IOT_COMPOSE_PROJECT=iot-manager
   export IOT_ENVIRONMENT_FILE="$PWD/deploy/.env"
   export IOT_RUNTIME_STATE_FILE=/etc/iot-manager/runtime.env
   export IOT_COMPOSE_FILES="$PWD/deploy/docker-compose.yml"

   docker compose --project-name "$IOT_COMPOSE_PROJECT" \
     --env-file "$IOT_ENVIRONMENT_FILE" \
     -f deploy/docker-compose.yml \
     up -d --build volume-init postgres keycloak caddy

   bash scripts/runtime/reconcile-keycloak-realm.sh
   bash scripts/runtime/bootstrap-keycloak-owner.sh
   ```

   `bootstrap-keycloak-owner.sh` 创建或更新 Keycloak 用户、分配 `OWNER` role，并将
   不可变 subject 写入 `$IOT_RUNTIME_STATE_FILE`。后续 Compose 命令必须加载这个
   状态文件；不要把 subject 改写为用户名。生产默认不创建 VIEWER；仅当显式设置
   `IOT_CREATE_INTEGRATION_VIEWER=true` 时，脚本还会写入一个独立的 VIEWER subject，
   后端仅为该账户授予配置站点的只读成员资格。

5. 启动业务平面：

   ```bash
   docker compose --project-name "$IOT_COMPOSE_PROJECT" --profile application --profile observability \
     --env-file "$IOT_ENVIRONMENT_FILE" --env-file "$IOT_RUNTIME_STATE_FILE" \
     -f deploy/docker-compose.yml \
     up -d --build backend backup wal-g-archive wal-g-backup alertmanager prometheus
   ```

Backend 使用 `iot_manager_app` 执行业务 DML，Flyway 使用独立的
`iot_manager_owner`，两者均不是 PostgreSQL 超级用户。Keycloak 使用独立的
`keycloak` 数据库和角色。WAL-G 仅复用 `iot_manager_owner` 调用被显式授予的
`pg_backup_start/pg_backup_stop` 及 PostgreSQL 内置只读 `pg_read_all_settings`
（用于校验物理备份目录）；该 owner 只继承此一个只读角色。WAL 归档 sidecar 不挂载
PostgreSQL 数据卷，而是从私有 spool 逐段上传；应用账户从不获得这些权限，也不能执行
`CREATE TABLE`、`CREATE ROLE` 或 `CREATE DATABASE`。

逻辑 `backup` sidecar 同样只使用 `iot_manager_owner`，并且只挂载
`iot_db_owner_password`。`pg_dump` 必须能够锁定和读取所有平台拥有的关系，包含刻意
不授予 Backend DML 账户的 `r1_recovery_drill` schema；绝不能为了恢复验证而把
`iot_db_app_password` 挂载给备份容器。恢复后的应用角色探针由 PostgreSQL 容器内的
`application-role-psql.sh` 执行，它创建的临时 `.pgpass` 会在命令退出时清除。

Backend、`wal-g-archive`、`wal-g-backup` 与 `backup` 使用
`restart: unless-stopped`。Backend 还使用默认 `24 × 5s` 的有界 Flyway
连接重试来覆盖依赖恢复窗口；容器处于 running 状态不代表业务可用，始终以 readiness
作为流量准入依据。

首次 OWNER 通过 PKCE 登录成功后，按本组织的紧急访问流程轮换或移除
`KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME` 对应的 bootstrap 管理员凭据。

## 健康、安全与验收检查

集成环境可直接运行：

```powershell
.\scripts\runtime\verify-stack.ps1
```

或：

```bash
bash scripts/runtime/verify-stack.sh
```

生产环境应在受控终端执行等价检查并保存脱敏结果。最低预期包括：

```bash
curl -fsSI https://<DOMAIN>/
curl -fsSI https://<DOMAIN>/console/
curl -fsS https://<DOMAIN>/auth/realms/iot-manager/.well-known/openid-configuration
curl -i https://<DOMAIN>/api/v1/devices       # 无 token 必须为 401
curl -i https://<DOMAIN>/h2-console           # 必须为 404
```

此外须验证：HTTP 返回 308 并跳转 HTTPS、非法 Origin 没有
`Access-Control-Allow-Origin`、超过 1 MB 的 `/api/**` 请求返回 413、响应具备
HSTS/`X-Content-Type-Options`/`X-Frame-Options`，以及除 Caddy 外没有容器发布宿主
机端口。

受控集成环境还必须单独运行以下破坏性演练，`start-integration -Verify` 不会替代它们：

```powershell
.\scripts\runtime\verify-resilience.ps1 -Confirm RESILIENCE
```

```bash
IOT_RESILIENCE_CONFIRM=RESILIENCE bash scripts/runtime/verify-resilience.sh
```

演练会验证 PostgreSQL 暂停时的 HTTP 503、数据库先停止后 Backend 冷启动的有界
Flyway 重试、数据库恢复后无需人工重启 Backend 即恢复健康，以及四个长运行服务的
`unless-stopped` 重启策略配置。

### CORS 与请求体边界

P0 的公开浏览器入口只允许一个精确 HTTPS Origin：`IOT_ALLOWED_ORIGINS` 必须与
`https://<DOMAIN>` 相同，且 Caddy 与 Backend 同时执行该白名单。不要在此阶段把它改为
`*` 或逗号分隔的多 Origin；多 Origin 需要同步扩展 Caddy allow-list 并经过安全审查。

Caddy 会在代理和鉴权之前拒绝已知 `Content-Length` 超过 1 MB 的 `/api/**` 请求，并拒绝
HTTP/1.1 chunked API 请求，确保大请求不会先被 Backend 以 401/403 掩盖。后端的
`request_body` 限制仍保留，作为下游读取请求体时的第二道保护。

## 备份和恢复演练

`backup` 在启动后立即生成一份自定义格式 `pg_dump`，随后按
`BACKUP_INTERVAL_SECONDS` 执行并生成 SHA-256 sidecar；每次完整 dump/checksum 成功后
才原子更新 `.backup-last-success`。healthcheck 会校验该 marker、dump、sidecar 和最大
年龄，而不是仅因持久卷上存在旧文件就保持健康。WAL-G 也分别记录远端连接和最近一次
base backup 的成功时间，并在远端探测陈旧或私有 spool 出现超龄未上传 WAL 时 fail closed。
PostgreSQL 容器本身没有 egress 网络。

恢复演练只可恢复到不同 Compose project，且必须显式确认：

PowerShell：

```powershell
.\scripts\runtime\recovery-drill.ps1 `
  -BackupFile C:\path\to\iot_manager-<timestamp>.dump `
  -Confirm RESTORE
```

Shell：

```bash
IOT_RESTORE_CONFIRM=RESTORE \
  bash scripts/runtime/recovery-drill.sh /absolute/path/to/iot_manager-<timestamp>.dump
```

脚本拒绝与源 project 同名的恢复目标，也拒绝复用已有 recovery `postgres-data` volume；
恢复后检查预期的最新 Flyway 版本、零失败迁移、必需角色代码、关键表以及应用账户在
`public.devices` 上的实际 DML 权限。默认版本为 V18；升级迁移后以
`IOT_EXPECTED_FLYWAY_VERSION` 显式更新验收期望。恢复目标会保留以供检查，只能用
`docker compose ... down` 停止，禁止添加 `-v` 直到演练证据归档完成。

RPO ≤15 分钟、RTO ≤60 分钟必须依据真实对象存储、WAL、恢复起止时间、首个 readiness
和读写探测生成的实际报告签发；本手册与本地 volume 不是该结论的替代证据。

### Physical WAL/PITR drill (protected only)

Logical restore does not prove WAL replay. The protected GitHub workflow
`Protected WAL-G Recovery Drill` is the only automated path intended for the
physical drill. It requires an approved S3-compatible immutable repository, a
self-hosted recovery runner, and the `r1-recovery-drill` protected
environment. The script creates a pinned base backup, writes a marker, waits
until the marker's WAL segment can be fetched from the real repository, then
creates a named PostgreSQL restore point in that same archived segment. It
restores the pinned base into a different Compose project and proves the
marker, Flyway version, readiness, and a write operation.

Do not point this command at the filesystem integration repository and do not
run it against an unapproved target:

```bash
IOT_PITR_CONFIRM=PITR \
IOT_ENVIRONMENT_FILE=/secure/iot-manager/.env \
IOT_COMPOSE_PROJECT=iot-manager \
bash scripts/runtime/wal-recovery-drill.sh
```

The script rejects source/recovery project collisions and pre-existing target
volumes. It retains the recovered target for inspection; only the protected
workflow may remove its own `iot-manager-gate2-pitr-*` target with `down -v`.

## 更新与回滚

- 只从已审阅的 Git SHA 构建镜像；记录 image digest、配置版本和备份校验和。
- Dockerfile 与 Compose 中的第三方基础镜像必须同时固定版本 tag 和 digest。升级时必须在已审阅的变更中更新两者、重建全部可部署镜像并重新通过 Trivy 镜像扫描；不得把浮动 tag 直接用于生产部署。
- 迁移失败时 Backend 必须保持不可用；不要执行 Flyway `repair`、修改历史 checksum，
  或通过删除数据卷“回滚”。
- 回滚前先完成并校验备份。数据库结构仅可采用前向兼容应用镜像或已演练的独立恢复方案。
- 故障证据不得包含 Secret、JWT、Cookie、完整坐标或私钥；CI 运行态工作流会在上传
  artifact 前按生成 Secret 的精确值扫描证据。
