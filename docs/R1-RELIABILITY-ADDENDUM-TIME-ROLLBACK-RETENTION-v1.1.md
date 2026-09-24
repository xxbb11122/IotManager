# IotManager R1 可靠性增补开发文档：时钟权威、回滚能力与数据保留

**版本：** 1.1  
**日期：** 2026-09-22  
**状态：** 待设计评审与实施（不构成发布审批）  
**候选基线：** `e0977e77220773182df4e3a73741686cbb87c6d9`  
**适用阶段：** R1 生产试点前可靠性收敛  
**文档关系：** 本文是 `R1-RELIABILITY-AND-RELEASE-CLOSURE-PLAN.md` 的实施增补，也是 `R1-RELIABILITY-ADDENDUM-TIME-ROLLBACK-RETENTION.md` v1.0 的修订建议稿

> 本文处理三个已确认的工程缺口：时间语义混用、回滚能力不可执行、业务数据缺少保留机制。它不增加业务功能，不替代审批文档，也不表示 R1 已获准上线。

## 0. 文档效力与治理边界

发生冲突时，按以下优先级执行：

1. `PROJECT-APPROVAL-REVIEW.md`——发布授权和 Gate 结论；
2. `PROJECT-IMPROVEMENT-PLAN.md`——整改范围、数据保留和恢复基线；
3. `R1-COMPLETION-DEVELOPMENT-PLAN.md`——R1 收尾、迁移和回滚原则；
4. `R1-RELIABILITY-AND-RELEASE-CLOSURE-PLAN.md`——可靠性与发布闭环工作包；
5. 本文——三个问题的实施细化。

### 0.1 工作包定性

| 编号 | 工作包 | 正确定性 | 评审要求 | 关闭位置 |
| --- | --- | --- | --- | --- |
| `P0-TIME-01` | 时钟权威与时间语义修复 | 已存在的正确性缺陷 | P0 设计补充评审；数据库迁移评审 | Gate 2 前 |
| `P0-ROLLBACK-01` | 可执行回滚与兼容演练 | 既有 Gate 2 要求未落地 | 发布/恢复设计评审 | Gate 2 前 |
| `P1-RETENTION-01` | R1 最小数据保留闭环 | 既有数据库整改基线未落地 | 数据所有者、DBA、安全评审 | Gate 2 前完成最小实现 |
| `R2-RETENTION-02` | 全量分区、冷归档和规模化降采样 | R2 平台硬化 | R2 Gate 设计评审 | Gate 4 前 |

上述前三项不是功能路线图中的 R1.1 功能扩展，因此不以 `CR-01` 作为默认前置条件。只有出现以下情况时才触发范围变更：

- 改变已审批的数据保留期限；
- 引入多实例、跨区域或新外部存储平台；
- 将 R2 全量分区/冷归档提前列为 R1 放行条件；
- 新增与缺陷修复无关的产品功能或外部协议能力。

数据库模型、Edge 协议和发布工作流的设计仍须留下 Gate 1/P0 设计补充评审记录，但该记录属于整改设计审查，不等同于 R1.1 功能扩展审批。

## 1. 当前问题、影响与优先级

| 优先级 | 问题 | 已确认影响 | R1 决策 |
| --- | --- | --- | --- |
| P0 | 服务端时间与 Agent 上报时间以不同墙钟写入无时区字段 | 最新遥测排序错误、窄时间窗口漏查、分钟桶重复、环境相关行为 | 必须最先修复 |
| P0 | 回滚只有原则，没有可执行脚本、候选保留和 N-1 兼容证据 | 发生发布故障时无法证明可恢复到上一健康候选 | 必须在 Gate 2 前闭环 |
| P1 | 业务增长表缺少归档与清理机制 | 数据、备份体积和 RTO 持续增长 | R1 完成有界保留；重型分区留到 R2 |

已核实的基线事实：

- Backend 生产代码中没有统一 `Clock` Bean；存在 69 处直接获取系统时间的调用，分布于 23 个文件；
- Edge Agent 已在部分模块使用 `Clock.systemUTC()` 和构造注入，不应再描述为“全仓无 Clock”；
- PostgreSQL 生产配置使用公共迁移目录加 `migration-postgresql`，H2 使用公共目录加 `migration-h2`；目录选择是明确的，风险在于跨 profile schema 等价性，而不是运行时无法选目录；
- 整改基线已经规定：原始遥测热数据 90 天、归档数据 365 天、审计和命令事件 2 年；
- `CI-RELEASE-RUNBOOK.md` 已定义不可变发布与失败处理，但尚无 N→N-1 的可执行回滚演练；
- `REGISTRY-RETENTION.md` 尚未给出具体保留时长，也未强制保留 N-1/N-2 健康候选。

## 2. 总体设计原则

1. **判定时间由服务端权威时钟产生。** TTL、在线状态、新鲜度、命令过期、限流和清理边界只使用服务端 `receivedAt`。
2. **事件时间与接收时间分离。** 设备/Agent 提供的 `observedAt` 只表示事件自报时间，不参与在线和过期判定。
3. **时间可信度不等于连接可信度。** Agent 时钟偏斜只降低 `observedAt` 可信度；只要服务端持续收到有效心跳，设备连接状态仍可为在线。
4. **迁移采用 Expand/Contract。** R1 内只新增兼容字段、双写和切读；N-1 兼容期结束前不删除旧字段。
5. **应用回滚与数据恢复分离。** 切换 N-1 镜像不回滚 Flyway；只有 schema 不兼容或数据损坏时才进入经批准的 PITR/逻辑恢复。
6. **数据生命周期必须有上界。** 删除前先判断保留期、法律/调查保留和归档状态；清理动作自身必须可审计。
7. **R1 控制改造面。** R1 先实现安全的有界保留；所有增长表全面分区、对象存储冷归档和规模化降采样留到 R2。

## 3. `P0-TIME-01` 时钟权威与时间语义修复

### 3.1 目标

- 消除 UTC 墙钟与 `Asia/Shanghai` 墙钟混写；
- 让时间边界可以通过固定时钟精确测试；
- 修复遥测最新值、时间范围和分钟桶语义；
- 保证同一行为在 `TZ=UTC` 与 `TZ=Asia/Shanghai` 下结果一致；
- 保持 N-1 Backend 在迁移窗口内可运行。

### 3.2 统一时间模型

| 字段/概念 | 类型 | 来源 | 用途 |
| --- | --- | --- | --- |
| `receivedAt` | `Instant` / PostgreSQL `TIMESTAMPTZ` | Backend 注入的 `Clock` | TTL、在线、过期、限流、排序、保留边界的唯一权威 |
| `observedAt` | 可空 `Instant` / `TIMESTAMPTZ` | Agent 或设备 | 展示、设备时间线、诊断 |
| `observedTimeTrust` | 枚举 | Backend 计算 | `TRUSTED`、`SKEWED`、`UNKNOWN`、`LEGACY_UNKNOWN` |
| `observedClockSkewMs` | 可空 `Long` | `receivedAt - observedAt` 的估算值 | 指标、告警、排障；不参与在线判定 |
| `displayZone` | IANA Zone ID | 站点配置或客户端显示设置 | 仅用于显示，不进入数据库判定 |

强制规则：

- 判定代码禁止直接调用 `LocalDateTime.now()`、`Instant.now()` 或 `System.currentTimeMillis()`；
- 必须调用 `Instant.now(clock)` 或统一 `TimeProvider`；
- JPA Entity 不注入 Spring Bean；实体审计字段由 Service、JPA Auditing 的 UTC Provider 或数据库默认值生成；
- 日志继续使用 UTC，并输出带偏移的 ISO-8601 时间；不得把日志改为本地墙钟来“对齐”无时区字段；
- `hibernate.jdbc.time_zone=UTC` 作为防御配置，但不能代替字段与迁移设计。

### 3.3 Backend 改造

新增统一配置：

```java
@Bean
Clock applicationClock() {
    return Clock.systemUTC();
}
```

按风险分两批替换直接取时钟调用：

**第一批——必须在 P0 完成：**

- `EdgeAgentService`；
- `TelemetryService`；
- `SiteWeatherService` 与天气隐私/重试调度；
- `CommandService`、`CommandBatchService`；
- `AgentCredentialService`；
- `ApiRateLimitFilter`；
- `ScheduledDatabaseTaskGuard`。

**第二批——同一版本完成但可独立 PR：**

- Entity 创建/更新时间；
- `AuditEventService`；
- 设备、分组和模拟器的展示性时间；
- 其余非判定类时间戳。

增加 ArchUnit 或等价静态规则：除允许清单中的 `ClockConfig`、`TimeProvider` 和测试代码外，`service`、`weather`、`config` 包不得直接调用系统时间。

### 3.4 Edge 时间处理

现有心跳已带 `sentAt`。服务端在收到消息时生成 `receivedAt`，并估算：

```text
observedClockSkewMs = receivedAt - sentAt
```

由于该值包含单向网络延迟，它只用于粗粒度诊断：

- 缺少 `sentAt`：`UNKNOWN`；
- 绝对偏差不超过 30 秒：`TRUSTED`；
- 绝对偏差超过 30 秒：`SKEWED`；
- 历史来源无法确认：`LEGACY_UNKNOWN`。

即使状态为 `SKEWED`，只要心跳持续到达，Agent 和设备仍按服务端 `receivedAt` 判断在线。禁止因设备时钟错误而把正常连接降级为离线或 `UNKNOWN`。

### 3.5 服务端时间端点

新增：

```http
GET /api/v1/time
```

响应示例：

```json
{
  "serverTime": "2026-09-22T02:30:00Z",
  "zone": "UTC",
  "skewToleranceSeconds": 30,
  "requestId": "..."
}
```

约束：

- 端点不返回部署位置、主机名或其他敏感信息；
- 使用现有读取限流；
- Client 可用请求发出/收到时间的中点估算显示偏差；
- 估算结果只用于诊断提示，不能改变服务端权限、在线或命令判定；
- Edge Agent 可周期性调用，但服务器不信任客户端自报的偏移值。

### 3.6 V20 Expand/Contract 迁移

下一条通用或 PostgreSQL 迁移从 V20 开始。建议拆分：

- `V20__add_authoritative_time_columns.sql`；
- `V21__add_telemetry_archive_and_retention_audit.sql`（供第 5 节使用）。

V20 对下列关键对象增加兼容字段：

| 对象 | 新字段 |
| --- | --- |
| Edge Agent | `last_received_at`、`reported_at`、`reported_time_trust`、`reported_clock_skew_ms` |
| Device Connection | `last_received_at`、`reported_at` |
| Device | `last_received_at`，保留旧 `last_seen` 供 N-1 使用 |
| Telemetry Sample | `received_at`、`observed_at`、`observed_time_trust`、`bucket_start_utc` |

迁移步骤：

1. 新字段均先允许为空，不删除旧字段；
2. 新版本双写旧字段和新字段；
3. 新查询优先使用新字段，缺失时进入明确的 legacy 兼容分支；
4. 只有来源可证明的数据才允许自动转换；
5. 无法判断 UTC/上海墙钟来源的旧数据不得统一加减 8 小时，标记为 `LEGACY_UNKNOWN`；
6. 生成一次性对账报告：总行数、可确认行数、未知行数、异常跨度和样本 ID；
7. N-1 兼容验证通过后保持旧字段一个完整发布周期；
8. 删除旧字段属于后续 Contract 迁移，不在本次 R1 候选内执行。

H2 与 PostgreSQL 应分别提供等价迁移并运行 schema parity 检查。V19 保持为 H2 专用历史迁移，不重编号、不复制到 PostgreSQL。

### 3.7 遥测查询修复

- 最新值按 `received_at DESC` 选择；
- 历史范围的过滤边界使用 `received_at`；
- `observed_at` 作为可选展示字段返回；
- 新分钟桶使用 `bucket_start_utc = received_at.truncatedTo(MINUTES)`；
- 若业务需要按设备事件时间浏览，提供独立排序选项，不得替换默认服务端时间线；
- 新唯一键至少包含 `device_id + bucket_start_utc`；迁移窗口内保留旧唯一键并处理双写冲突。

### 3.8 指标与告警

至少提供：

- `iot_agent_clock_skew_seconds`；
- `iot_agent_clock_trust_total{status=...}`；
- `iot_telemetry_legacy_time_total`；
- `iot_time_endpoint_requests_total`。

连续三个心跳偏差超过 30 秒时产生时钟偏斜告警；该告警不自动改变设备在线状态。

### 3.9 验收标准

- 固定时钟测试覆盖 TTL、天气新鲜度、命令过期、凭据过期、限流和清理边界；
- 同一测试套件在 `TZ=UTC` 与 `TZ=Asia/Shanghai` 下结果一致；
- Agent `+8h`、`-8h` 和抖动测试不会改变连接在线判定；
- 最新遥测与最近一小时查询符合服务端真实接收顺序；
- legacy 对账报告完整且不静默修正不可确认数据；
- N-1 Backend 能在 V20 后 schema 上完成规定的读写冒烟；
- 静态检查可阻止关键包重新引入直接系统时钟。

## 4. `P0-ROLLBACK-01` 可执行回滚与兼容演练

### 4.1 目标

- 把“回滚原则”变成可重复执行、可失败、可审计的工作流；
- 证明 N-1 应用可在 N 的 Expand 阶段 schema 上运行；
- 确保上一健康候选的镜像与证据不会提前被清理；
- 明确应用回滚、配置回滚和数据恢复的边界。

### 4.2 三类回退

| 类型 | 动作 | 数据影响 | 审批 |
| --- | --- | --- | --- |
| 应用回滚 | 将镜像 digest 集从 N 切换到 N-1 | 不回滚数据库，不应丢数据 | Incident Commander + DevOps |
| 配置回滚 | 恢复已验证的 Caddy、Keycloak、Secret 引用和 digest env | 取决于配置变更 | DevOps；密钥相关需安全角色 |
| 数据恢复 | PITR 或经批准的逻辑恢复 | 可能丢失恢复点之后写入 | 双人确认，必须包含 DBA/数据负责人 |

`deploy/backup/restore.sh` 使用 `pg_restore --clean --if-exists`，属于数据恢复，不得包装成普通应用回滚。

### 4.3 已知良好候选目录

每个通过 Release Gate 的候选生成不可变 `release-manifest.json`，至少包含：

```json
{
  "releaseId": "r1-rc.x",
  "commitSha": "...",
  "schemaVersion": "21",
  "apiVersion": "v1",
  "protocolVersion": 1,
  "images": {
    "backend": "registry/image@sha256:..."
  },
  "evidenceChecksums": {
    "sbom": "sha256:...",
    "provenance": "sha256:...",
    "scan": "sha256:..."
  },
  "approvedAt": "...",
  "status": "KNOWN_GOOD"
}
```

保留策略：

- 保留当前已知良好候选、N-1、N-2；
- 每个已知良好候选从被替代之日起至少保留 180 天；
- 若 180 天内尚未形成两个更新的已知良好候选，则继续保留；
- 镜像 digest、SBOM、provenance、扫描、manifest、签名与最终 Gate 证据必须作为一组保留；
- helper tag 可以清理，但底层 digest 和证据组不得被删除；
- 正式执行前将以上规则写入 `REGISTRY-RETENTION.md`，作为唯一事实源。

### 4.4 回滚演练工作流

新增 `.github/workflows/rollback-drill.yml`，仅允许：

- `workflow_dispatch`；
- 受保护的 `r1-rollback-drill` environment；
- 隔离 Compose project、隔离数据库和隔离密钥；
- 明确输入 N 与 N-1 的 release manifest；
- 默认拒绝生产目标。

固定步骤：

1. 验证 N 与 N-1 manifest 的签名、校验和、候选 SHA 和 Gate 状态；
2. 验证所有 N-1 digest 仍在 Registry；
3. 按 digest 预拉取 N-1 镜像；
4. 部署 N 并完成 Expand 迁移；
5. 写入可识别的测试数据和协议样本；
6. 冻结测试写入并保存诊断证据；
7. 从 N-1 manifest 渲染 `image-digests.env`；
8. 使用 `--mode immutable --pull never --no-build` 启动 N-1；
9. 验证健康探针、OIDC、RBAC、API v1、WebSocket 协商、数据读取和允许的写入；
10. 验证 Caddy、Keycloak Realm 引用和缓存不存在 N 残留；
11. 记录开始、决策、恢复服务和完全验证的时间点；
12. 上传证据并销毁隔离环境。

不得在预拉取镜像之前执行 `--pull never`。缺少任一 N-1 镜像或证据时必须显式失败。

### 4.5 N-1 schema 兼容规则

- 新列先可空或具有向后兼容默认值；
- 重命名使用“新增 → 双写 → 切读 → 后续删除”；
- `SET NOT NULL` 只能在回填完成且 N-1 已退出兼容窗口后执行；
- R1 新迁移禁止直接删除业务数据；
- 例外必须标记“不可应用回滚，只能数据恢复”，并经过单独设计审批；
- 静态规则只能作为第一层；最终必须运行 N-1 镜像对迁移后 schema 的真实读写冒烟。

迁移目录检查应验证：

- 公共、H2、PostgreSQL 的版本组合合法；
- profile 选择结果唯一；
- 等价版本在两个数据库中的对象、列和约束符合预期；
- V19 只允许 H2 专用文件；后续共享或 PostgreSQL 迁移从 V20 顺序分配。

### 4.6 触发条件与决策

| 情况 | 默认动作 |
| --- | --- |
| 数据损坏、设备失控或越权风险 | 立即停止发布/冻结相关写入，进入回滚决策 |
| 核心健康探针持续失败 5 分钟 | 应用回滚 |
| 5xx 比例连续 5 分钟达到或超过 5% | 应用回滚，除非证据明确为外部依赖 |
| N-1 与新 schema 不兼容 | 禁止强启 N-1，进入数据恢复或前向修复决策 |
| 数据恢复 | 必须双人确认、目标隔离、先保存源证据 |

阈值可在审批中调整，但正式发布前必须锁定在运行手册中，不能在事故处理中临时发明。

### 4.7 Android 与协议边界

- Android 不能安装更低 `versionCode`；客户端回退必须使用旧代码、相同签名和更高 `versionCode` 重打包；
- Backend 回滚后必须继续支持已升级客户端使用的 `/api/v1` 契约；
- WebSocket/Edge Agent 至少保留一个协议版本兼容窗口；
- 不兼容变更不得与删除旧协议在同一候选完成。

### 4.8 验收标准

- `rollback-drill.yml` 至少一次完整通过并归档；
- N→N-1 的镜像、schema、OIDC、API、WebSocket 和数据读写验证全部通过；
- 模拟 N-1 digest 被清理时工作流明确失败；
- 应用回滚时间被记录并满足 RTO 目标；
- PITR 演练达到 RPO ≤ 15 分钟、RTO ≤ 60 分钟；
- 破坏性迁移样例能够被迁移检查阻断；
- 所有证据绑定同一候选 SHA、release ID 和镜像 digest。

## 5. `P1-RETENTION-01` R1 最小数据保留闭环

### 5.1 固定保留基线

以下期限来自现有整改基线，不在本方案中重新定义：

| 数据类别 | 在线/热保留 | 归档/总保留 | 清理条件 |
| --- | --- | --- | --- |
| 原始遥测分钟桶 | 90 天 | 归档数据总计 365 天 | 已归档、无保留冻结 |
| 审计事件 | 2 年 | 2 年 | 无法律/调查保留 |
| 命令及命令事件 | 2 年 | 2 年 | 命令已终态、无保留冻结 |
| 生产备份 | 30 天 | 服从不可变/异地副本策略 | 不破坏 PITR 链 |

其他数据的 R1 建议值：

| 表/数据 | 建议期限 | 特殊条件 |
| --- | --- | --- |
| `alerts` | 已解决后 365 天 | 未解决告警不删除 |
| `activity_events` | 按审计事件处理，2 年 | 保留冻结优先 |
| `site_weather_snapshots` | 90 天 | 保留当前有效快照 |
| `site_weather_forecast_points` | 30 天 | 过期预报可删除 |
| `weather_provider_access_events` | 2 年 | 按外部访问审计处理 |
| `agent_credential_rotations` | 2 年 | 当前有效凭据及未结束轮换不删除 |

建议值在执行删除前必须由产品/数据所有者和安全角色确认；改变前三项固定基线需要单独变更审批。

### 5.2 R1 归档模型

R1 不一次性把所有历史表原地改造成分区表。遥测采用有界、可重放的热表→归档表流程：

1. V21 新增 `device_telemetry_samples_archive`，保留关键字段与 UTC 时间语义；
2. 将 `received_at < now - 90d` 且 `received_at >= now - 365d` 的热数据按批次复制到归档表；
3. 使用稳定业务键和 `ON CONFLICT DO NOTHING` 保证重放幂等；
4. 每批验证插入计数、业务键覆盖和校验摘要；
5. 验证通过后才删除热表对应批次；
6. 归档表中超过 365 天的数据按批次删除；
7. 默认历史 API 只查询热表；需要长期查询时使用独立归档查询路径并设置更严格限流。

无法确认时间基准的 `LEGACY_UNKNOWN` 行在人工对账完成前不得被自动清理。

R2 再评估：

- PostgreSQL 声明式分区；
- 分区级 `DROP`；
- 小时/日级降采样；
- 对象存储冷归档；
- 1000 设备持续负载下的自动分区与恢复演练。

### 5.3 清理执行器

复用 `ScheduledDatabaseTaskGuard`，增加 retention job：

- 默认每天 `02:30 UTC` 运行；
- 首次部署默认 `dry-run=true`；
- 每批最多 5,000 行；
- 每批独立小事务；
- 获取数据库任务锁，保证单实例执行；
- 配置短锁等待和有限 statement timeout；
- 支持从 watermark 中断续跑；
- 失败不推进 watermark；
- 两次 dry-run 报告审核通过后，才允许在受保护配置中开启实际删除。

清理边界统一使用：

```java
Instant cutoff = Instant.now(clock).minus(retentionDuration);
```

禁止使用 `LocalDateTime.now()` 或部署时区计算清理边界。

### 5.4 保留冻结

新增最小 `retention_holds` 模型：

- `scope_type`：站点、设备、命令、审计类别；
- `scope_id`；
- `starts_at`、可空 `ends_at`；
- `reason`；
- `created_by`、`created_at`；
- `released_by`、`released_at`。

任何匹配有效 hold 的数据均不得归档后删除或永久删除。创建与解除 hold 必须写入审计事件。隐私删除请求另走隐私流程；如与法律保留冲突，必须由数据负责人作出记录化决定，清理任务不得自行判断。

### 5.5 清理审计与指标

新增 `retention_job_runs`，至少记录：

- 策略版本；
- dry-run/execute 模式；
- 数据类别和时间范围；
- 预计、归档、删除、跳过和失败行数；
- hold 命中数；
- 开始/结束时间；
- watermark；
- 失败原因与 request/correlation ID。

至少提供：

- `iot_retention_rows_archived_total`；
- `iot_retention_rows_deleted_total`；
- `iot_retention_rows_held_total`；
- `iot_retention_job_duration_seconds`；
- `iot_retention_job_failures_total`；
- 各增长表体积和最旧记录年龄。

### 5.6 备份与容量

保留策略上线前产出容量模型，至少包含：

- 设备数；
- 每设备每日分钟桶数量；
- 平均 `state_json` 大小；
- 索引膨胀系数；
- 30/90/365/730 天表体积；
- 每日全量备份体积；
- WAL 生成速率；
- 预估恢复时间。

保留策略与 WAL-G base backup/WAL 链必须共同评审。任何 PITR 目标不得超出实际保留的完整 WAL 链。保留策略生效后必须重新执行物理恢复演练。

### 5.7 验收标准

- dry-run 预测数与执行结果在允许误差内一致；
- 90 天热数据、365 天归档、2 年审计/命令期限均有边界测试；
- active alert、非终态命令、有效凭据和 hold 数据不会被删除；
- 归档复制可重放，不产生重复或遗漏；
- 中断后能够从 watermark 恢复；
- 清理期间 API 延迟、锁等待和数据库连接池无明显退化；
- 保留上线后 PITR 仍满足 RPO ≤ 15 分钟、RTO ≤ 60 分钟；
- 清理操作本身可以通过审计记录追踪。

## 6. API、协议与配置变更

| 类型 | 变更 | 兼容策略 |
| --- | --- | --- |
| REST | 新增 `GET /api/v1/time` | 纯新增，不删除旧接口 |
| Edge 心跳 | 服务端使用现有 `sentAt` 计算粗略偏斜 | 缺字段视为 `UNKNOWN`，不拒绝旧 Agent |
| 遥测响应 | 增加 `receivedAt`、`observedAt`、`observedTimeTrust` | 保留现有 `sampledAt` 一个兼容周期 |
| 数据库 | V20 时间字段、V21 归档/审计字段 | Expand/Contract，N-1 读写验证 |
| 配置 | 时钟阈值、retention dry-run、批次和调度 | 生产默认 fail-safe，首次不实际删除 |
| CI | 新增 rollback drill 与双时区测试 | 不降低现有 Quick CI/P0 Gate |

建议配置键：

```yaml
iot:
  time:
    clock-skew-tolerance: 30s
  retention:
    enabled: true
    dry-run: true
    schedule: "0 30 2 * * *"
    batch-size: 5000
    telemetry-hot-days: 90
    telemetry-total-days: 365
    audit-days: 730
    command-days: 730
```

生产环境不得通过普通运行时参数把固定基线调小；如确需调整，必须经过变更审批并留下策略版本。

## 7. 测试计划

| 层级 | 场景 | 阻断条件 |
| --- | --- | --- |
| Backend 单元 | 固定时钟下 TTL、天气、命令、凭据、限流、保留边界 | 任一边界错误 |
| Backend 集成 | `TZ=UTC` 与 `TZ=Asia/Shanghai` 双环境 | 结果不一致 |
| Edge 集成 | `sentAt` ±8h、缺失和网络抖动 | 在线状态被设备时钟错误改变 |
| Telemetry | 最新值、最近一小时、分钟桶、legacy fallback | 排序/范围/唯一性错误 |
| Flyway | H2/PostgreSQL V20/V21 + N-1 兼容 | profile schema 不等价或 N-1 冒烟失败 |
| Workflow | N/N-1 manifest、digest 缺失、校验和篡改 | 未 fail-closed |
| Rollback E2E | N→N-1、OIDC、RBAC、API、WS、数据读写 | 任一核心探针失败 |
| Retention | dry-run、归档重放、hold、批次失败、续跑 | 误删、漏归档或重复 |
| Recovery | 保留策略生效后的 WAL/PITR | RPO/RTO 不达标 |
| 性能 | 清理并发下 API 延迟、锁等待、备份时间 | 超过经评审的预算 |

关键测试必须接入 CI，不能只作为本地脚本存在。双时区测试、迁移 parity 和 release/rollback 工具测试进入 Quick CI；完整 rollback drill 与 PITR 使用受保护环境。

## 8. 实施顺序与交付物

| 阶段 | 工作 | 负责人角色 | 交付物 |
| --- | --- | --- | --- |
| S0 | 设计补充评审、失败测试、候选冻结 | 架构/Backend/DBA/测试 | 评审记录、复现测试 |
| S1 | Clock、时间语义和 V20 Expand | Backend/Edge/DBA | 时间模型、迁移、双写 |
| S2 | 遥测切读、对账、双时区测试 | Backend/测试 | 查询修复、对账报告 |
| S3 | 候选保留与 `REGISTRY-RETENTION.md` | DevOps/安全 | N/N-1/N-2 保留规则 |
| S4 | `rollback-drill.yml` 与 N-1 冒烟 | DevOps/Backend/DBA | 回滚证据、RTO 记录 |
| S5 | V21、归档、hold、清理与审计 | Backend/DBA/安全 | Retention job、审计与指标 |
| S6 | 容量预算、负载与 PITR 复演 | DBA/DevOps/测试 | 容量报告、RPO/RTO 证据 |
| S7 | Gate 2 证据复核 | 产品/开发/测试/安全 | 签字记录与已知限制 |

依赖关系：

```text
S0 → S1 → S2
          ├─→ S3 → S4
          └─→ S5 → S6
S4 + S6 → S7
```

时钟修复必须先于实际清理；回滚保留规则必须先于回滚演练；保留策略生效后必须重新执行恢复演练。

## 9. Definition of Done

三个工作包只有同时满足以下条件才可标记完成：

- P0/P1 实现和迁移已经过代码、DBA、测试与安全评审；
- Backend、Edge、Client、Flyway、Workflow 测试全部通过；
- 双时区和 ±8 小时时钟偏斜测试通过；
- legacy 数据对账结果和不可恢复部分已明确记录；
- N→N-1 演练完整通过，N-1/N-2 制品确实可取回；
- 数据保留 dry-run、实际归档/清理和中断续跑通过；
- 保留生效后的 PITR 达到 RPO ≤ 15 分钟、RTO ≤ 60 分钟；
- 指标、告警、运行手册、回滚手册和证据索引已更新；
- 没有未解释的 P0/P1 缺陷；
- Gate 2 重新复核并留下签字记录。

完成本文不代表 Gate 3 已通过。真实手机 GPS/BLE、真实 Edge 设备、两站点三端隔离、签名 Release APK 和生产域名/证书仍须按既有 Gate 3 要求验收。

## 10. 风险与控制

| 风险 | 控制 |
| --- | --- |
| 历史无时区数据无法还原 | 不批量猜测；标记 `LEGACY_UNKNOWN`；保留对账证据 |
| 一次替换 69 处时间调用造成大回归 | 分关键判定和审计展示两批 PR；静态规则防回归 |
| Agent 时钟告警误伤在线状态 | 时钟可信度与连接状态完全分离 |
| N-1 镜像或证据被清理 | N/N-1/N-2 + 180 天保留；演练前显式验证 |
| `--pull never` 在干净 Runner 失败 | 先按 digest 预拉取，再禁拉取/禁构建启动 |
| schema 已破坏导致应用回滚失败 | Expand/Contract + N-1 真实读写冒烟 |
| Retention job 误删 | 首次 dry-run、hold、批次限制、对账、审计、fail-safe |
| 所有表一次分区导致迁移风险 | R1 使用归档表和分批操作；全面分区留 R2 |
| 清理缩短 PITR 窗口 | 数据保留与 WAL 链共同评审，生效后复演恢复 |

## 11. 受控状态表述

- Gate 2 未通过：**“R1 生产试点候选，时间、回滚和数据生命周期闭环整改中。”**
- Gate 2 通过、Gate 3 未通过：**“实现与发布准备度已复核，等待真实环境试点验证。”**
- 只有审批文档明确签发 Gate 3 后：**“R1 生产试点已获批准。”**

Quick CI 全绿、一次回滚演练成功或 retention dry-run 成功，都不能单独表述为“生产就绪”。

## 12. 变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-09-22 | 初版提出时钟、回滚和保留三个工作包 |
| 1.1 | 2026-09-22 | 纠正 CR-01 定性与迁移目录表述；恢复 90/365 天和 2 年保留基线；分离时间可信度与在线状态；补充 V20/V21、N-1 演练、R1 最小归档和 DoD |

