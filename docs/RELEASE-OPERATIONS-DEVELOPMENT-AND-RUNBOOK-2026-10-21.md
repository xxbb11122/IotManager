# 第 3～6 项发布运维开发与执行手册

本轮范围：专用 Linux runner 的准备入口、Android 签名配置、最终验收工作流调度、PG16 glibc→musl 逻辑迁移及新备份链衔接。手机/PDA 按用户要求使用模拟。工具不会合并 PR、创建正式 tag、自动切换业务流量或把模拟结果标为生产批准。实际验收结果追加在本文末尾。

## 1. 专用 Linux runner

入口：`scripts/ops/recovery-runner.sh check|register`。要求 Linux x86_64、非 root 专用账号、Node >=22、Docker/Compose、支持 attestation 的 gh、至少 20 GiB 可用磁盘。架构限制与仓库固定的 ORAS Linux amd64 工具一致。脚本不修改宿主系统包或防火墙。

```bash
bash scripts/ops/recovery-runner.sh check
# 从 GitHub Settings > Actions > Runners 下载官方 Linux x64 archive，
# 同时从该页面独立取得 SHA256；以下变量只填写到专用 VM 的当前会话。
export IOT_RUNNER_REPOSITORY=xxbb11122/IotManager
export IOT_RUNNER_HOME=/opt/iot-runner/attempt-001
export IOT_RUNNER_ARCHIVE=/private/actions-runner-linux-x64.tar.gz
export IOT_RUNNER_ARCHIVE_SHA256=<GitHub页面给出的完整哈希>
export IOT_RUNNER_NAME=iot-recovery-001
# 由管理端取得短期 registration token，经安全渠道设置到 VM 会话；
# 不将管理员 PAT 或 gh 登录状态复制到 runner 主机。
bash scripts/ops/recovery-runner.sh register
```

先验证 archive 哈希，再解包到全新、位于源码目录之外的私有目录；管理端通过 `gh api --method POST repos/xxbb11122/IotManager/actions/runners/registration-token --jq .token` 取得短期 token，通过安全渠道设置 VM 的 `IOT_RUNNER_REGISTRATION_TOKEN`，不输出到公共日志。注册为单任务 ephemeral runner，附加 `iot-manager-recovery` 标签；GitHub 默认提供 `self-hosted/linux/x64`。随后按脚本输出的 `env -u ... run.sh` 命令启动，避免继承管理凭据；每个任务结束后重新注册。预检通过不表示 runner 已注册或在线。

仓库为公开仓库，专用 VM 仅放经过批准的恢复源和所需权限；不用于普通 PR 构建，不与开发机共用 Docker socket。网络访问策略由 VM/网络管理员配置。恢复、回滚、Release Gate 新增托管 runner 上的源码检查：仅默认分支或允许的发布 tag；候选源码和工作流提交都必须已进入默认分支历史，再调度受保护主机。该检查覆盖这些发布入口，不能替代 GitHub 对其他工作流的访问管理。[GitHub runner 说明](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)

## 2. Android 正式签名配置

入口：`scripts/ops/android-signing.mjs check|configure`，要求 JDK 17+。使用已有、已批准的正式密钥；首次发布应由密钥保管流程创建并备份密钥。工具不会生成或替换正式密钥。

在本机会话中安全设置 `IOT_RELEASE_STORE_PASSWORD`、`IOT_RELEASE_KEY_ALIAS`、`IOT_RELEASE_KEY_PASSWORD`，不要把值写入命令历史、报告或仓库。Linux keystore 要求 0600。提供独立核对的证书 SHA256：

```bash
node scripts/ops/android-signing.mjs check --app glass \
  --keystore /private/glass-release.jks --cert-sha256 <批准的证书指纹> --last-version-code 0
# 只有仓库治理预检全部通过后，以下命令才上传到 android-release 环境：
node scripts/ops/android-signing.mjs configure --repository xxbb11122/IotManager \
  --app glass --keystore /private/glass-release.jks \
  --cert-sha256 <批准的证书指纹> --last-version-code 0
```

`0` 仅适用于从未分发过正式包；否则填写所有分发渠道的最高 versionCode。工具验证 RSA >=2048、剩余有效期至少一年、非 Android Debug、证书指纹一致，并通过 Java KeyStore 读取私钥及随机挑战签名验证两个密码。不能只依靠 keytool certreq：实测部分 PKCS12 情形会忽略 key password，现有实现已覆盖此拒绝测试。

Client 与 Glass 的保护环境 Secret 已分离，构建不回退使用另一个 App 的密钥：

| App | 四个 Secret |
| --- | --- |
| client | `IOT_CLIENT_RELEASE_KEYSTORE_BASE64`、`IOT_CLIENT_RELEASE_STORE_PASSWORD`、`IOT_CLIENT_RELEASE_KEY_ALIAS`、`IOT_CLIENT_RELEASE_KEY_PASSWORD` |
| glass | 对应 `IOT_GLASS_RELEASE_*` 四项 |

另维护 `ANDROID_CLIENT_CERT_SHA256 / ANDROID_GLASS_CERT_SHA256` 和 `ANDROID_CLIENT_LAST_RELEASE_VERSION_CODE / ANDROID_GLASS_LAST_RELEASE_VERSION_CODE`。原通用 `IOT_RELEASE_*` GitHub Secret 需迁入上述名称；本地进程变量名称保持通用，便于同一工具配置两 App。秘密经 stdin 交给 gh，不写本地配置包；上传部分失败会停止，补齐后重跑。正式构建继续校验 APK/AAB、包名、版本、实际证书及内嵌源码。[Android 签名说明](https://developer.android.com/studio/publish/app-signing)

## 3. 最终发布验收调度

入口：`scripts/ops/release-operations.mjs plan|dispatch`。配置文件只含公开身份，不含密钥：

```json
{
  "repository": "xxbb11122/IotManager",
  "sourceSha": "替换为已审核合并后的40位默认分支HEAD",
  "sourceProject": "iot-manager-new",
  "app": "glass",
  "versionCode": 26,
  "versionName": "1.2.0"
}
```

```bash
node scripts/ops/release-operations.mjs plan --config /private/release.json --output /private/plan.json
node scripts/ops/release-operations.mjs dispatch --config /private/release.json --stage gate
# 同一源码，分别执行；等待并保留每一次 Actions run 的最终结果：
node scripts/ops/release-operations.mjs dispatch --config /private/release.json --stage android
node scripts/ops/release-operations.mjs dispatch --config /private/release.json --stage recovery
```

plan 实时读取分支、三个保护环境、在线 runner、签名 Secret 名称与证书/版本变量；不可读取保持阻断。候选必须等于当前默认分支 HEAD，防止调用者沿用过期计划。dispatch 重新收集状态，按默认分支和明确输入调度一个阶段；`DISPATCHED/PENDING` 不是 PASS，不自动重复投递，不更新已分发版本号。

`--stage rollback` 另需在配置中填写不同的 `currentEvidenceDigest`、`rollbackEvidenceDigest`（完整 OCI sha256）。实际回滚工作流继续验证 GHCR 包、校验和、Release Gate attestation、批准时间与版本兼容；工具不创造 N-1。首次发布先建立合格的历史基线，旧失败构建不计入已批准 N-1。独立审核人与环境保护仍是此入口的真实前提。

## 4. PG16 迁移与新备份链

入口：`scripts/ops/postgres-migrate.mjs inspect|export|restore|verify`；在 Linux 专用维护环境执行。保留旧 glibc 镜像、旧卷、旧备份链，准备固定 digest 的新 musl 集群和全新卷。可在初始化时叠加 `deploy/docker-compose.migration.yml`，显式设置 `IOT_MIGRATION_INITDB_ARGS`；该配置仅影响新集群。两侧使用现有初始化脚本建立同名、同权限角色及空业务/Keycloak 数据库，密码通过受保护 Secret 配置，无须导出旧密码。

配置示例，所有占位值均须替换：

```json
{
  "id": "pg16-cutover-001",
  "adminUser": "iot_postgres_admin",
  "sourceContainer": "old-postgres-container",
  "targetContainer": "new-postgres-container",
  "sourceImageId": "sha256:替换为docker-inspect得到的64位Image哈希",
  "targetImage": "ghcr.io/xxbb11122/iot-manager-postgres@sha256:替换为批准的64位digest",
  "databases": ["iot_manager", "keycloak"],
  "oldBackupPrefix": "s3://approved-backups/glibc-chain",
  "newBackupPrefix": "s3://approved-backups/musl-chain"
}
```

1. 在维护窗口停止所有写入方，包括 Backend、Keycloak 和其他数据库客户端；保持新集群业务访问关闭。工具检查两侧无业务库连接，并在导出和恢复前后复核源数据，工具自身不修改源库，也不负责外部流量控制。
2. inspect 核对全部业务库、PG16、源 Image ID、目标 digest/ABI 标记、独立 PGDATA 及新集群 system identifier；同时清点 locale、角色/成员关系、所有权和 ACL。自动路径目前支持 UTF8 场景中的 C/POSIX/C.UTF-8/C.utf8 libc locale 且两侧元数据必须完全一致；其他 libc/ICU locale 会拒绝，需另行审核排序规则迁移，不能自动改为 C。
3. export 将两库自定义格式 dump 和完整清单写入全新 0700 目录，文件 0600；保留所有权/授权，不使用 no-owner/no-acl，不输出数据或密码。备份应另行放到获批准的加密存储。
4. restore 先验证配置、dump 哈希、源数据未变、目标角色/数据库权限一致和目标空库，再按库以单事务恢复；不自动 clean/drop。任何失败保留状态，需人工诊断并使用全新目标重试，多数据库整体切换不会自动执行。
5. verify 对比行流指纹、序列语义状态、large object、列/函数/策略、索引有效性、角色与对象授权。通过只得到 `DATA_VERIFIED_BACKUP_PENDING`。

```bash
node scripts/ops/postgres-migrate.mjs inspect --config /private/migration.json
export IOT_PG_MIGRATION_CONFIRM=pg16-cutover-001
node scripts/ops/postgres-migrate.mjs export --config /private/migration.json --directory /private/export-001
node scripts/ops/postgres-migrate.mjs restore --config /private/migration.json --directory /private/export-001
node scripts/ops/postgres-migrate.mjs verify --config /private/migration.json --directory /private/export-001
```

新源 Compose 项目的 S3 prefix 必须与旧链互不包含；备妥同一候选的 release-candidate/topology/services/image-digests.json 与 image-digests.env，并拉取全部需要的 digest。执行：

```bash
node scripts/ops/backup-migrated-database.mjs run --config /private/migration.json \
  --directory /private/export-001 --project iot-manager-new \
  --env-file /private/new-cluster.env --release /private/release-bundle \
  --output /private/new-chain-evidence-001
```

该入口先重验迁移结果，核对 Compose 指向的就是新集群，且 PostgreSQL/WAL-G 三服务镜像及 S3 prefix 均匹配。随后复用真正的 immutable WAL-G 演练：新全量备份、命名恢复点、WAL 上传、另卷恢复、恢复点之后事务排除及恢复库读写，保留独立恢复项目供检查。该步骤会向新集群的专用演练 schema 写标记。检查结果后使用限定该 recoveryProject 的 Compose 命令清理；旧库/旧链不清理。

最后通过受保护工作流保留可信证据，完成应用登录、API、WSS、权限和数据冒烟后再批准切流。新库开始接受业务写入后，回退旧库需要数据同步方案；保留旧卷不代表无损回退。[PostgreSQL pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)、[pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html)

## 5. 验证记录

新增 `Release Operations Simulation` 工作流在 GitHub 托管 Linux runner 执行；不注册正式 runner、不上传正式签名密钥、不调用外部 AI、不连接生产数据库。使用此前八镜像候选作为固定实验运行时，新工具源码单独记录工作流 SHA，不能把二者标为同一发布候选。

本地已完成工作流语法及新工具单元测试；双数据库迁移、新备份链等实际 Docker 验证结果待本轮执行后补入。
