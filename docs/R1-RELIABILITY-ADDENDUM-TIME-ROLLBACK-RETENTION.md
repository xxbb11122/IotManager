# IotManager R1 可靠性增补开发方案：时钟权威 / 回滚能力 / 数据保留

**版本：** 1.0
**日期：** 2026-09-22
**状态：** 待实施开发方案（不构成审批或发布授权）
**候选基线：** `e0977e77220773182df4e3a73741686cbb87c6d9`
**适用阶段：** R1 生产试点前的可靠性收敛
**文档定位：** `R1-RELIABILITY-AND-RELEASE-CLOSURE-PLAN.md` 的增补

> 本文只针对三项已核实的可靠性缺口提出可执行工作包。不扩大 R1 的业务功能范围、不替代既有审批结论、不代表 R1 已获准上线，也不改变任何既有 Gate 的判定标准。

## 0. 文档生效关系与审批前提

发生冲突时按以下优先级执行：

1. `PROJECT-APPROVAL-REVIEW.md`——审批边界与 Gate 结论；
2. `PROJECT-IMPROVEMENT-PLAN.md`——整改基线；
3. `R1-COMPLETION-DEVELOPMENT-PLAN.md`——R1 收尾路线；
4. `R1-RELIABILITY-AND-RELEASE-CLOSURE-PLAN.md`——发布闭环工作包；
5. 本文——上述第 4 项的增补工作包。

**审批前提（必须在前）：** 本文新增工作包均属于对 R1 审批范围的**扩展**，不是对既有批准范围的解释。按 `FEATURE-EXPANSION-EVALUATION-AND-ROADMAP.md` 第 0 节的规则，须以变更单 **CR-01** 提交 Gate 1 变更审批并留下记录。在 Gate 1 变更批准前，本文只能作为整改提案推进，**不得自行作为 R1 门禁对外宣布**。

## 1. 范围、新增工作包与非目标

### 1.1 新增工作包

| 编号 | 名称 | 性质 | 建议归属 | 需 Gate 1 变更 |
| --- | --- | --- | --- | --- |
| `P0-TIME-01` | 时钟权威与服务端时间基线 | 正确性缺陷修复 | R1 必做 | 是 |
| `P0-ROLLBACK-01` | 回滚能力的可执行化与演练 | 发布闭环补强 | R1 必做 | 是 |
| `P1-RETENTION-01` | 数据保留、归档与清理 | 运行可持续性 | R1 最小实现，R2 完整 | 是 |

`P0-TIME-01` 之所以定为 P0，是因为它不是设计偏好而是**已存在的正确性缺陷**（证据见第 2.1 节），且 P1-EDGE-01 的 TTL 收敛、P1-CLIENT-02 的 60 秒真值边界、天气新鲜度判定都将在它之上实现；不先修，后续验收不可测。

### 1.2 非目标

- 不将 R1.1 候选功能（事件中心、健康分、命令模板、二维码）并入本次；
- 不引入 Redis、消息队列或多实例架构——本方案全部工作在单主机 Docker Compose 内可完成；
- 不以「定时 `DELETE FROM` 全表」作为保留方案；
- 不把 Prometheus 的 15 天指标保留当作业务数据保留；
- 不因新增回滚演练而放宽、跳过或重试掩盖任何既有 Gate 的失败；
- 不把时区修复扩大为「多时区/跨地域站点」能力（那属于 R2 的范围变更）；
- 不用改 `TZ` 环境变量作为时钟问题的修复手段（见 3.1 的非目标说明）。

## 2. 已核实基线事实与证据位置

本节是三个工作包的问题依据。每条均标注证据位置，便于复核；复核限度见第 8 节。

### 2.1 时钟：已存在的混用缺陷

| 事实 | 证据位置 | 影响 |
| --- | --- | --- |
| 后端无 `java.time.Clock` 抽象，直接取系统时钟 | 全仓检索 `java.time.Clock` / `Clock.system` / `Clock` bean 均无命中；`LocalDateTime.now()` / `Instant.now()` / `System.currentTimeMillis()` 共 **69 处，分布于 23 个文件** | 时钟不可注入、不可测、不可审计 |
| 容器内 JVM 默认时区为 `Asia/Shanghai` | `deploy/docker-compose.yml:257` `TZ: ${TZ:-Asia/Shanghai}`；`deploy/.env.example:6` `TZ=Asia/Shanghai`；`deploy/.env.integration.example:6` | 服务端墙钟为 +08:00 |
| 日志时区与业务时区不一致 | `backend/src/main/resources/logback-spring.xml:8` `<timeZone>UTC</timeZone>` | 日志时刻与 DB 时刻相差 8 小时，排障时误导 |
| Agent 上报时刻被转换为 **UTC 墙钟**的无时区 `LocalDateTime` | `EdgeAgentService.java:433-435`，`LocalDateTime.ofInstant(instant(node, field), ZoneOffset.UTC)`；`EdgeAgentService.java:238` 读取 `observedAt` | 引入第二类墙钟基准 |
| 同一语义列混写两类墙钟 | 服务端时钟：`EdgeAgentService.java:207 / 223 / 264 / 328`（`agent.setLastSeen(LocalDateTime.now())`）。Agent 时钟：`EdgeAgentService.java:254 / 281 / 283 / 339 / 343`（`setLastSeen(observedAt)`） | 同一列中出现相差 8 小时的两种值 |
| 遥测时刻同样混入 Agent 时钟 | `EdgeAgentService.java:287 / 347` → `TelemetryService.java:28` `LocalDateTime sampledAt = observedAt == null ? LocalDateTime.now() : observedAt` | 见下两行 |
| **遥测「最新值」查询会取错** | `DeviceTelemetrySampleRepository.java:18` `findTopByDeviceIdOrderBySampledAtDesc`，排序键为 `sampledAt` | 同一设备上，服务端时钟写入的行（上海墙钟，较大）恒久压过 Agent 写入的行（UTC 墙钟，小 8 小时），即使后者实际更新 |
| **遥测历史范围查询会漏行** | `DeviceTelemetrySampleRepository.java:14`；`TelemetryService.java:43-46`，默认窗口 `LocalDateTime.now().minusDays(30)` ~ `LocalDateTime.now()` | 以服务端墙钟为边界检索 Agent 写入的行，窄窗口（如「最近 1 小时」）会系统性漏掉这 8 小时内的数据 |
| 分桶键按混用时刻截断，同一真实分钟可能产生两个桶 | `TelemetryService.java:29` `sampledAt.truncatedTo(ChronoUnit.MINUTES)`；`DeviceTelemetrySample.java:24-26` 唯一约束 `uk_device_telemetry_bucket(device_id, bucket_start)` | 同一真实时刻因来源不同落进两个桶，产生重复行 |
| 无时区列不做时区转换落库 | 全仓检索 `hibernate.jdbc.time_zone` 无命中；`DeviceTelemetrySample.java:41-45` 使用无时区 `LocalDateTime` | 「无时区」语义贯穿到存储层，无法事后还原 |
| 无服务端时间端点 | 检索 `/time`、`serverTime`、`server-time` 在控制器中无命中 | 客户端与 Agent 无法校时 |
| 命令过期判定两侧同源，**暂未受影响** | `EdgeAgentService.java:114-124`，`now = LocalDateTime.now()` 与 `command.getExpiresAt()`（同样由服务端生成）比较 | 说明：此处**不要**误判为已损坏；但它依赖「两侧都必须是服务端时钟」这一隐含前提，该前提目前无任何机制保证 |

**后果定性。** 在 `TZ=Asia/Shanghai` 的部署下，Agent 上报的 `observedAt` 与服务器 `LocalDateTime.now()` 相差固定的 **8 小时**；在 `TZ=UTC` 的部署下两者恰好一致。因此该缺陷**只在部分环境显现**，本地或 CI 若以 UTC 运行会看不到问题——这正是它至今未被发现的原因，也是它必须在上线前消除的理由。

### 2.2 回滚：策略完备，能力缺失

**重要更正：** 本项目**已有**回滚策略，本节不主张「没有回滚设计」。缺的是把策略变成可执行、可演练、可审计的能力。

已有策略（作为既有基线，本文不重复设计）：

- `PROJECT-IMPROVEMENT-PLAN.md:441`——Flyway 不执行直接 downgrade；数据库回滚使用备份恢复；应用迁移采用 Expand/Contract；
- `PROJECT-IMPROVEMENT-PLAN.md:166`——数据库恢复是回滚手段，禁止依赖 Flyway 自动 downgrade；
- `PROJECT-IMPROVEMENT-PLAN.md:120`——迁移编号从 V20 起顺序分配，V19 永久保留给 H2 长文本兼容迁移；每个迁移 PR 必须声明编号、依赖和回滚/Expand-Contract 方案；
- `PROJECT-IMPROVEMENT-PLAN.md:448`——发生 P0 缺陷、数据异常或设备失控风险时立即回滚到最近通过验收的版本；
- `R1-COMPLETION-DEVELOPMENT-PLAN.md` §12——12.1 部署顺序、12.2 Backend 回滚（保留前一个健康镜像 digest、N-1 兼容窗口、只切镜像不回滚 Flyway、schema 不兼容则禁止应用回滚）、12.3 Keycloak 回滚、12.4 Android 回滚（更高 versionCode + 同签名重打包）、12.5 数据恢复（双人确认、目标隔离、不覆盖运行 Volume、先存证据）。

缺失与风险：

| 事实 | 证据位置 | 影响 |
| --- | --- | --- |
| 无可执行的回滚工作流或脚本 | `.github/workflows/` 仅 5 个文件（`ci` / `image-security` / `runtime-e2e` / `recovery-drill` / `release-gate`）；`scripts/ci/` 与 `scripts/runtime/` 清单中无 `rollback*` | 策略无法被自动验证，回滚能力从未演练 |
| 未定义「上一已知良好候选」的指针与保留要求 | `docs/REGISTRY-RETENTION.md` 全文 6 行，只要求不删除 in-flight 候选的 digest，并称保留「至少到发布证据保留期」，但**未定义该期限**，也**未要求保留 N-1 候选** | §12.2「保留前一个健康镜像 digest」没有落地机制；可能发生「想回滚但上一候选已被清理」 |
| N-1 兼容性无自动化校验 | §12.2 要求「数据库变更必须满足 N-1 Backend 兼容窗口」；§12.1 要求「发布前执行数据库兼容检查」，但无对应脚本或工作流 | 兼容窗口靠人工判断，无法阻断 |
| 默认 Compose 使用可变本地 tag | `deploy/docker-compose.yml:80` `iot-manager-postgres:16-walg`、`:130` `iot-manager-keycloak:26.7.2`、`:211` `iot-manager-backend:local` | 与 §12.1「不使用 latest」的精神不符；回滚路径依赖人工渲染 env，易走错 |
| 不可变部署变体存在，但无回滚对应物 | `deploy/docker-compose.immutable.yml` 全部镜像为 `${IOT_*_IMAGE:?...}`，由 `image-digests.env` 提供；`scripts/ci/render-digest-env.sh` 负责渲染 | 正向可锁定 digest，反向无对等流程与保留要求 |
| 迁移目录存在多套且版本号重叠 | `db/migration/`、`db/migration-h2/`、`db/migration-postgresql/` 三套；V2/V5/V6/V8 在 h2 与 postgresql 中各有一份；`V19__align_long_text_columns_with_hibernate.sql` **仅存在于 migration-h2** | 「当前 schema 处于哪个版本」本身有歧义，Expand/Contract 兼容期难以机械校验；引擎间已存在 schema 漂移 |
| 破坏性数据迁移已存在，但未标注为「不可应用回滚」 | `db/migration/V3__enforce_command_idempotency.sql:1` `DELETE FROM device_commands AS duplicate`；`db/migration/V7__assign_legacy_devices_to_demo_context.sql` 改写历史数据 | 应用回滚**无法**恢复被删除/改写的数据；只能靠 PITR，且有数据丢失窗口。这一点在 §12.2 中未被显式标注 |
| 逻辑恢复是破坏性恢复，不是应用回滚 | `deploy/backup/restore.sh:42` `pg_restore --clean --if-exists --no-owner --no-privileges` | 容易被误当作「回滚手段」使用而丢数据 |

### 2.3 数据保留：业务数据无任何保留机制

| 事实 | 证据位置 | 影响 |
| --- | --- | --- |
| 后端无任何保留/清理/分区代码 | 检索 `Retention\|Purge\|cleanup\|prune\|deleteOlderThan\|Partition`（`backend/src/main/java`）仅命中 `weather/SiteWeatherPrivacyService.java`（天气坐标删除，属隐私而非保留） | 时间序列表只进不出 |
| 指标有保留，备份文件有保留，**业务数据没有** | `deploy/docker-compose.yml:478` `--storage.tsdb.retention.time=${PROMETHEUS_RETENTION_TIME:-15d}`；`:312` `BACKUP_RETENTION_DAYS: ${BACKUP_RETENTION_DAYS:-30}`、`:313` `BACKUP_INTERVAL_SECONDS: 86400` | 三者不对称：清理了外围证据，未清理主体数据 |
| 逻辑备份为全库导出，表体积直接决定备份体积与 RTO | `deploy/backup/backup.sh:20` `pg_dump --format=custom --no-owner --no-privileges`（无表排除） | 未被清理的表会同时放大备份存储与恢复时间 |
| WAL 归档有延迟上限，但归档物的保留期未定义 | `deploy/docker-compose.yml:363-365` `WALG_ARCHIVE_REMOTE_PROBE_INTERVAL_SECONDS=60`、`WALG_ARCHIVE_REMOTE_MAX_AGE_SECONDS=120`、`WALG_ARCHIVE_MAX_PENDING_SECONDS=900` | RPO ≤ 15 分钟有机制支撑；但 basebackup 与 WAL 链保留期无定义，直接影响 PITR 可回退窗口 |
| 遥测已按分钟桶降采样（存在唯一约束） | `DeviceTelemetrySample.java:24-26`、`TelemetryService.java:29` | 增长速率低于逐样本存储，但**仍无上界**：每设备每分钟一行，永久累积 |
| 保留判定的时钟依赖现有缺陷 | 若以 `LocalDateTime.now()` 作为清理边界，会继承 2.1 节的时区问题 | 可能出现「该删的没删 / 不该删的被删」 |

**待确认的增长表清单**（据实体与迁移文件整理，需在实施前按实际数据量与索引核对）：

`device_telemetry_samples`、`activity_events`、`command_events`、`device_commands`、`alerts`、`site_weather_snapshots`、`site_weather_forecast_points`、`weather_provider_access_events`、`agent_credential_rotations`，以及 V15 引入的审计事件上下文表。

**默认不删除类：** `command_events`、审计事件表、`device_commands` 的终态记录。理由：项目对外定位是「可审计的 IoT 运维系统」，删除审计与命令终态会直接破坏该定位（该主张与 `PROJECT-APPROVAL-REVIEW.md` 的审计要求一致，具体条款须在实施前由审批方确认）。

## 3. 工作包

### 3.1 `P0-TIME-01` 时钟权威与服务端时间基线

**问题。** 见 2.1 节。核心不是「时区没配对」，而是**同一个时间语义被两种不同的墙钟基准写入同一列，且列本身不带时区信息**，导致跨来源的时间比较系统性偏差 8 小时，并且偏差只在 `TZ=Asia/Shanghai` 下显现。

**改造。**

1. **引入时钟抽象。** 增加 `java.time.Clock` bean，全部 69 处直接取时钟的调用改为注入；测试提供固定时钟（`Clock.fixed`）。目标：任何时效判定的边界都可被测试精确控制。
2. **拆分两个时间语义，禁止混用。**
   - `receivedAt`：服务端接收时刻，来源为注入的 `Clock`，**唯一权威**，用于一切 TTL、在线判定、新鲜度、过期、限流窗口；
   - `observedAt`：来源上报时刻，保留原值并记录来源标识（`EDGE_AGENT` / `DEVICE` / `SERVER`），**仅用于展示与诊断**，不得参与判定。
3. **统一存储类型。** 时间列统一为带时区类型（`timestamptz` / `Instant` / `OffsetDateTime`），迁移现有无时区列；`hibernate.jdbc.time_zone` 显式配置为 UTC 并纳入配置检查。禁止无时区 `LocalDateTime` 进入判定逻辑。
4. **新增服务端时间端点。** `GET /api/v1/time` 返回 `serverTime`（UTC）、服务端 `zone`、`skewToleranceSeconds`。客户端与 Edge Agent 在启动时和周期性（建议 5 分钟）调用，计算并上报偏移量。
5. **协议扩展。** Edge Agent 心跳（`AgentHeartbeat`，已有 `sentAt`）增加 `clockOffsetMs`；服务端记录该值并纳入 Agent 健康状态。偏移超过阈值（建议 30 秒）时：**拒绝该 Agent 上报的 `observedAt` 作为任何判定依据**（仅存为参考值），并产生可观测告警。
6. **时钟可信度分级。** 对时钟偏移超阈值的 Agent，其设备的新鲜度判定降级为 `UNKNOWN` 并给出原因，不得默认为在线或离线。
7. **展示与判定分离。** 跨站点时间展示按站点 IANA 时区渲染（`site_weather_settings.timezone` 已存在该字段）；判定一律使用 UTC。
8. **修复已有的遥测排序与范围查询缺陷。** 在改造 1–3 完成后，回填/迁移 `device_telemetry_samples` 的 `sampled_at` 与 `bucket_start` 到统一基准；修正 `findTopByDeviceIdOrderBySampledAtDesc` 与 `findByDeviceIdAndSampledAtBetweenOrderBySampledAtAsc` 的语义；对既有混用数据给出一次性对账脚本与审计输出。

**验收。**

- **固定时钟单元测试**覆盖 TTL 收敛、在线判定、天气新鲜度（`FRESH/STALE/UNAVAILABLE`）、命令过期、限流窗口的每一个边界；
- **时钟偏斜集成测试**：将 Agent 时钟设置为 `+8h`、`-8h`、随机抖动三种情况，设备的在线判定与 TTL 收敛结果**必须完全一致**；
- **环境无关性测试**：同一组行为断言在 `TZ=UTC` 与 `TZ=Asia/Shanghai` 两种容器时区下结果一致（这是一条专门用来锁死本类缺陷的回归测试）；
- **遥测对账**：修复前后对同一设备执行「最新值」与「最近 1 小时历史」查询，结果一致且与真实时间线相符；
- **静态约束**：存在自动化检查，确保没有无时区时间参与判定路径（例如禁止 `LocalDateTime` 出现在判定代码中）；
- **可观测**：时钟偏移有指标与告警，偏移超阈值可在监控面板看到。

**非目标（重要）。** 不得把修改 `TZ` 环境变量或仅在 `EdgeAgentService.timestamp()` 中改用系统默认时区当成修复。这两种做法只是把 8 小时偏移换了个方向或改为依赖部署配置，缺陷仍在，只是更难复现。

**迁移与兼容。** 已有无时区时间列的数据迁移需要明确基准假设并留审计；迁移必须遵守 Expand/Contract（见 3.2 第 4 条），保证 N-1 应用在迁移窗口内可用。

### 3.2 `P0-ROLLBACK-01` 回滚能力的可执行化与演练

**问题。** 见 2.2 节。回滚策略在文档层面基本完备（`R1-COMPLETION-DEVELOPMENT-PLAN.md` §12），但没有任何可执行工作流、脚本或保留机制，因此**这是一项声称具备、实际未验证的能力**。按项目自身的规则（`PROJECT-IMPROVEMENT-PLAN.md:408`「备份、回滚或降级方案已验证」），未验证即不满足交付条件。

**改造。**

1. **定义三类回退并禁止互相冒充。** 应用回滚（切换到上一候选的镜像 digest 集）、数据回滚（PITR / 逻辑恢复）、配置与密钥回滚（Caddy/Keycloak/Secret/`image-digests.env`）。在运行手册中显式声明：`restore.sh` 的 `pg_restore --clean --if-exists` 属于数据回滚，代价是丢弃备份点之后的写入，**不能**当作应用回滚使用。
2. **建立「上一已知良好候选」指针与保留要求。** 明确记录并保留 N-1 与 N-2 两个候选的 `image-digests.json`、SBOM、provenance、扫描报告与对应镜像；补全 `REGISTRY-RETENTION.md`，把当前未定义的「发布证据保留期」写成具体时长，并新增「回滚所需候选」的保留条款（与该文件形成单一事实源）。
3. **新增回滚工作流 `rollback-drill.yml`。** 在隔离环境执行：部署候选 N → 部署候选 N-1（以 `--mode immutable`、`--pull never`、`--no-build`，从 N-1 的 digest env 渲染）→ 校验 N-1 健康、业务探针、数据可读、协议兼容。产出可审计证据并归档。
4. **迁移向前兼容规则（Expand/Contract）落地为可校验规则。**
   - 新增列必须可空或带默认值；
   - 重命名/删除必须拆分为两个发布周期；
   - `SET NOT NULL` 只允许在回填完成、旧版本已确认下线之后（现存实例：`migration-postgresql/V2:63-80`、`V5:27-28`、`V6:161`）；
   - R1 内禁止引入删除数据的迁移；确需例外时，必须在迁移文件中显式标注「本迁移不可应用回滚，仅可经 PITR 恢复」，并在 Gate 1 变更记录中留痕（现存先例：`V3` 的 `DELETE FROM device_commands`、`V7` 的历史数据改写）。
5. **N-1 兼容性自动化校验。** 在发布前阶段加入检查：以 N-1 应用镜像对迁移后的 schema 执行读写冒烟，失败即阻断发布。这是把 §12.2「必须满足 N-1 兼容窗口」变成可执行判据。
6. **消除迁移目录歧义。** 明确 `db/migration`、`db/migration-h2`、`db/migration-postgresql` 三套目录的适用 profile 与选择规则，并把该规则写入文档与检查脚本；说明 V19 仅存在于 h2 的原因与影响。目标：任何时刻都能机械判定「当前 schema 对应哪个版本、是否处于 N-1 兼容窗口」。
7. **回滚触发判据与决策人。** 写入运行手册：例如「P0 业务探针失败持续超过 X 分钟」「错误率超过阈值」「数据损坏或设备失控风险」。并将 `PROJECT-IMPROVEMENT-PLAN.md:448`（P0 缺陷立即回滚）具体化为可执行的判定表与责任人。
8. **回滚路径的配置一致性检查。** 回滚后必须确认无残留指向新版本：`image-digests.env`、Compose 渲染结果、Caddy 配置、Keycloak Realm 配置、客户端 WebSocket `protocolVersion` 协商、浏览器/客户端缓存。
9. **Android 侧的回滚边界写清。** 依 §12.4，Android 不能安装更低 `versionCode`，回滚靠「旧代码 + 更高 versionCode + 同签名」重新打包；因此**服务端回滚不得破坏已升级的客户端**——这正是 API `/api/v1` 兼容别名与 WebSocket 协议协商必须保持的原因，把这条因果关系显式写入手册。

**验收。**

- `rollback-drill.yml` 至少一次完整通过并归档：N→N-1 成功、N-1 业务探针通过、回滚耗时被记录；
- 回滚后 schema 与 N-1 应用的兼容性断言自动化通过；
- 用「含破坏性迁移」的场景演练一次，产出文档化的结论：该场景下应用回滚不可行，必须走 PITR，并量化数据丢失窗口；
- 保留机制可验证：模拟「上一候选已被清理」时，工作流必须**显式失败**而不是静默降级；
- 客户端兼容性：回滚后 N-1 服务端仍能与已升级到 N 的 Android 客户端通信（或明确记录不支持并给出降级行为）。

**非目标。** 不实现多实例滚动升级（属 R2，见 `FEATURE-EXPANSION-EVALUATION-AND-ROADMAP.md` 第 6 节）；不实现 Flyway 自动 downgrade（项目已明确禁止）。

### 3.3 `P1-RETENTION-01` 数据保留、归档与清理

**问题。** 见 2.3 节。指标有 15 天保留、备份文件有 30 天保留，而**业务数据没有任何上界**。逻辑备份是全库导出，因此表体积会同时放大备份存储和恢复时间（RTO），这会在恢复演练时集中暴露。

**改造。**

1. **产出保留矩阵。** 逐表定义：保留期、保留粒度、是否聚合后降采样保留、是否允许删除、删除方式、是否受法务保留约束。默认假设（须经审批确认）：
   - 遥测：热窗口（建议 30 天）保留分钟桶，之后降采样为小时桶保留（建议 12 个月），再之后删除；
   - 活动流与告警：保留（建议 12 个月），保留期内允许归档后删除；
   - 天气快照与预报点：短保留（建议 90 天），预报点可更短；
   - 供应商访问审计（`weather_provider_access_events`）、Agent 凭据轮换记录：保留（建议 24 个月）；
   - `device_commands` 终态、`command_events`、审计事件表：**默认不删除**。
2. **采用 PostgreSQL 声明式分区。** 时间序列表按月（或周）分区，清理以 `DROP PARTITION` 实现，而不是 `DELETE`——避免表膨胀、长事务与锁竞争。分区键与既有索引（如 `uk_device_telemetry_bucket`）的兼容性需在实施前评估。
3. **降采样保留。** 定期把超热窗口的分钟桶聚合为小时桶（保留 min/max/avg/样本数等），既保留趋势能力又控制体积。降采样必须幂等、可重放、可审计。
4. **清理任务。** 独立调度（复用现有 `ScheduledDatabaseTaskGuard` 机制），要求：`dry-run` 模式、单批行数上限、分批小事务、进度与失败可观测、支持中断续跑。
5. **取消时钟依赖。** 清理边界必须使用 UTC 与注入时钟（依赖 3.1 完成），禁止使用 `LocalDateTime.now()`。
6. **备份与保留的耦合设计。** 保留策略、`BACKUP_RETENTION_DAYS`、WAL-G basebackup 与 WAL 链保留必须一起设计，产出容量预算表：给定设备数与数据量，给出 30/90/365 天保留下的表体积、备份体积与预估 RTO。**注意：数据保留与备份保留是两个独立决定**，任何 PITR 目标不得超出所保留 WAL 的窗口。
7. **清理本身可审计。** 每次清理记录：范围、删除行数、执行时间、触发原因、执行者（系统）。提供「关于删除的审计」，使清理动作可追溯。
8. **隐私边界。** 与 `SiteWeatherPrivacyService` 的坐标删除策略保持一致：个人数据的删除请求**不得**被保留策略阻挡，保留策略也不能成为不删除个人数据的理由。

**验收。**

- 分区与清理在预生产环境完整跑通，且清理期间业务探针无退化（接口延迟、锁等待、复制延迟均需记录）；
- 产出容量预算并经评审：给定 X 设备、Y 桶/天，30/90/365 天保留下的体积与备份体积估算；
- **在保留策略生效后重跑一次 PITR 演练**，记录 RPO/RTO，并确认保留策略未破坏可回退窗口；
- 审计事件、命令终态记录在清理后完整（以测试断言保证）；
- `dry-run` 预测的行数与实际删除行数一致；
- 清理中断后可安全续跑，不产生部分删除的不可解释状态。

**非目标。** 不实现冷数据对象存储归档（对象存储属于 R2，见 `FEATURE-EXPANSION-EVALUATION-AND-ROADMAP.md` 6.3 节对 MinIO 的定位）；不实现报表聚合能力（FX-06 属 R2 候选）。

## 4. 测试与验收矩阵

| 类别 | 必测场景 | 自动化位置 | 完成判定 |
| --- | --- | --- | --- |
| 时钟抽象 | 固定时钟下的 TTL / 新鲜度 / 过期 / 限流边界 | Backend 单元测试 | 每个边界均有断言，无直接取系统时钟的判定路径 |
| 时钟偏斜 | Agent 时钟 ±8h 与随机抖动 | Backend 集成测试 | 在线判定与 TTL 结果不随来源时钟变化 |
| 环境无关性 | `TZ=UTC` 与 `TZ=Asia/Shanghai` 各跑一遍 | CI 双环境 Job | 同一组行为断言结果一致 |
| 遥测对账 | 修复前后「最新值」与窄窗口历史 | Backend 集成测试 | 与真实时间线一致，无 8 小时偏移 |
| 时间端点 | 客户端与 Agent 校时、超阈值降级 | Backend + Client + Edge 测试 | 超阈值时 `observedAt` 不参与判定且告警可见 |
| 回滚演练 | N → N-1 部署、探针、数据可读、耗时 | `rollback-drill.yml` | 至少一次完整通过并归档 |
| 回滚保留 | 上一候选已被清理时的行为 | 工作流静态/脚本测试 | 必须显式失败，不得静默降级 |
| N-1 兼容 | N-1 应用对迁移后 schema 的读写冒烟 | Release Gate 前置阶段 | 失败即阻断发布 |
| 迁移规则 | 新增列可空/带默认、无删除数据迁移 | 迁移校验脚本 | 违反规则即阻断 PR |
| 保留清理 | 分区切换、dry-run、中断续跑、批量上限 | Backend 集成测试 + 运行时任务 | 与 `dry-run` 预测一致，审计完整 |
| 容量预算 | 30/90/365 天的表体积与备份体积估算 | 容量脚本 + 评审记录 | 预算表经评审并有出处 |
| PITR 与保留 | 保留生效后的恢复演练 | Recovery 工作流 | RPO/RTO 被记录，回退窗口未被破坏 |

## 5. 建议实施顺序

| 顺序 | 工作内容 | 前置条件 | 产出 |
| --- | --- | --- | --- |
| 0 | 提交 CR-01，取得 Gate 1 变更批准；冻结候选 SHA；建立问题分支；补上能复现 8 小时偏移的失败测试 | 工作区干净、范围确认 | 变更批准记录、可复现的失败测试 |
| 1 | `P0-TIME-01` 时钟抽象与语义拆分（改造 1–3、5–7） | 步骤 0 | 注入时钟、`receivedAt`/`observedAt` 分离、环境无关性测试 |
| 2 | `P0-TIME-01` 数据修复与对账（改造 4、8） | 步骤 1 | 时间列迁移、时间端点、遥测排序与范围查询修复 |
| 3 | `P0-ROLLBACK-01` 保留机制与兼容规则（改造 2、4、6） | 步骤 1（需要稳定时钟做判定） | 上一候选指针、保留条款、迁移规则校验、目录歧义消除 |
| 4 | `P0-ROLLBACK-01` 回滚工作流与演练（改造 1、3、5、7–9） | 步骤 3 | `rollback-drill.yml` 通过并归档 |
| 5 | `P1-RETENTION-01` 分区与清理（改造 1–5、7–8） | 步骤 1、2 | 分区表、清理任务、保留矩阵、审计 |
| 6 | `P1-RETENTION-01` 容量预算与 PITR 复演（改造 6） | 步骤 4、5 | 容量预算表、含保留策略的 RPO/RTO 记录 |
| 7 | Gate 2 证据复核 | 步骤 1–6 全绿 | 与 `R1-RELIABILITY-AND-RELEASE-CLOSURE-PLAN.md` 第 7.1 节的证据合并提交 |

原则：`P0-TIME-01` 必须最先，因为保留清理（判定边界）与回滚演练（时间戳一致性校验）都依赖一个可信时钟。不得先做保留清理再修时钟——否则清理边界本身就带 8 小时偏差。

## 6. 风险与依赖

| 风险/依赖 | 影响 | 处置原则 |
| --- | --- | --- |
| 时区缺陷只在部分 `TZ` 部署显现 | 本地/CI 全绿但生产出错 | 专门加环境无关性回归测试；CI 双时区跑 |
| 既有混用时间数据已被写入生产 | 迁移基准不确定 | 迁移前做数据对账并留审计；明确假设与不可还原部分 |
| `TZ` 改动被当作修复 | 缺陷被掩盖而非消除 | 在评审检查表中显式禁止以改配置替代抽象 |
| 上一候选镜像被清理 | 回滚能力实际不可用 | 保留条款写进 `REGISTRY-RETENTION.md`；工作流对缺失显式失败 |
| 破坏性迁移先于回滚能力落地 | 回滚不可行且无记录 | 迁移规则校验先行；例外须在迁移文件与 Gate 1 记录中标注 |
| 分区改造影响既有唯一约束与索引 | 迁移失败或性能退化 | 实施前评估 `uk_device_telemetry_bucket` 与分区键兼容性 |
| 清理任务误删或误留 | 数据丢失或体积失控 | `dry-run`、批量上限、分批事务、可中断续跑、清理可审计 |
| 保留策略与 PITR 窗口冲突 | 恢复目标不可达 | 保留与备份保留统一设计；保留生效后必须复演 PITR |
| 三项均需 Gate 1 变更批准 | 未批准即实施会破坏治理 | 未获批准前只做步骤 0 的复现测试与提案，不合并实现 |

## 7. 完成定义与状态表述

本方案「开发完成」仅表示：三个工作包已合并、测试已通过、证据已归档。它与 R1 是否通过审批无关，也不改变任何既有 Gate 结论。

对外状态必须继续使用既有受控表述（见 `R1-RELIABILITY-AND-RELEASE-CLOSURE-PLAN.md` 第 9 节）：

- Gate 2 未通过前：**「R1 生产试点候选，发布闭环整改中。」**
- Gate 2 通过、Gate 3 未通过前：**「实现与发布准备度已复核，等待真实环境试点验证。」**
- 仅在审批文档明确签发 Gate 3 后：**「R1 生产试点已获批准。」**

不得因本方案完成而宣称「生产就绪」；不得把单次回滚演练成功表述为灾难恢复能力已验证。

## 8. 复核限度与待确认事项

本方案的证据来自对仓库的定向检索与文件阅读。为免误用，明确以下限度：

**已逐处核实（有 file:line 证据）：** 无 `Clock` 抽象与 69 处直接取时钟；容器 `TZ` 默认值；日志时区；`EdgeAgentService.timestamp()` 的 UTC 转换；`lastSeen` / `sampledAt` 的混写点；遥测排序与范围查询方法；`TelemetryService.record` 与分桶逻辑；5 个工作流清单；`scripts/` 无 rollback 脚本；`REGISTRY-RETENTION.md` 全文；`R1-COMPLETION-DEVELOPMENT-PLAN.md` §12；三套迁移目录与 V3/V7 破坏性迁移；Compose 镜像引用与 digest 变体；Prometheus 与备份保留参数；`pg_dump` 全库导出。

**基于检索的负结果（未见即视为缺失，但需你确认）：** 无服务端时间端点；无业务数据保留/清理代码；无 N-1 兼容性自动校验；迁移目录的选择规则无文档化说明。

**尚未阅读、需在实施前复核：** `docs/CI-RELEASE-RUNBOOK.md` 是否已含回滚步骤；`docs/VEX-POLICY.md` 与本次三项的关系；`PROJECT-APPROVAL-REVIEW.md` 中对审计保留的具体条款；`hibernate.jdbc.time_zone` 是否在生产 profile 中被配置（当前全仓无命中）；生产部署是否确实使用 `TZ=Asia/Shanghai`（当前依据是 Compose 默认值与 `.env.example`，非运行时证据）。

上述任何一项若与实际不符，对应工作包的问题定性与验收标准需要相应修订。

## 9. 变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-09-22 | 基于候选 `e0977e7` 的代码与部署资产核实，新增 `P0-TIME-01`、`P0-ROLLBACK-01`、`P1-RETENTION-01` 三个工作包 |
