# IotManager R1 可靠性专项修复方案

| 项目 | 内容 |
| --- | --- |
| 版本与日期 | v1.0，2026-09-24 |
| 输入基线 | `R1-RELIABILITY-TEST-REPORT-2026-09-24.md` |
| 被测提交 | `609c9f07f341e414cbfe665ea2093a7f8f1591f1` |
| 报告提交 | `5f5319f6d7c7dfaafbe5434c71847627c06328dc` |
| 修复范围 | DEF-01～DEF-07，以及 59 项 TIME/MIG/RET/RB/REC/REG/REL 用例的关闭路径 |
| 当前结论 | Gate 2 保持阻断；完成本方案全部硬门禁并形成同一候选证据后重新审批 |

## 1. 修复目标与原则

本方案的目标不是让现有流水线“显示绿色”，而是恢复三个工作包的可验证性，并完成测试报告中 59 项用例的真实闭环：

1. `P0-TIME-01`：服务端权威时间在两个进程时区下结果一致，Edge 自报时间只用于诊断，旧数据不猜测时区。
2. `P0-ROLLBACK-01`：能够从不可变、已签名的 N 与 N−1 制品完成应用回滚，验证业务后 RTO 不超过 60 分钟。
3. `P1-RETENTION-01`：在 PostgreSQL 上证明 dry-run、归档、校验、删除、hold、锁、水位和故障恢复行为，且不误删数据。

执行遵守以下规则：

- 修复后的每次正式验收冻结一个新 SHA；不同 SHA 的成功证据不得拼接成一次 Gate 结果。
- 运行故障、测试误报和覆盖缺口分别关闭；不得通过删除断言、降低 fail-closed 规则或增加无条件重试获得绿色。
- 真实清理、回滚和恢复仅在明确隔离的数据库、Compose project、卷和受保护 Runner 中执行。
- P0 Runtime 必须连续两次完整成功；真实 N→N−1 与清理后 PITR 各至少完成一次。
- 模拟和静态检查用于提前发现错误，不替代真实 PostgreSQL、真实制品、真实恢复或 Gate 3 设备证据。

## 2. 总体执行顺序

| 阶段 | 工作内容 | 进入下一阶段的硬条件 |
| --- | --- | --- |
| F0 | 修复 DEF-01～DEF-07 | actionlint、脚本契约、本地目标测试全部通过 |
| F1 | 重跑 Quick CI 与 P0 Runtime | 双时区 Java、Web、Android、部署静态检查、安全任务全绿；P0 Runtime 连续两次成功 |
| F2 | 补齐 TIME/MIG 自动化 | TIME-01～12、MIG-01～06 的可自动化部分全部通过，无旧时间误修正 |
| F3 | 补齐 PostgreSQL retention | 两轮 dry-run 与实际执行完成 ID 级对账，故障注入 fail-closed |
| F4 | 执行真实 N→N−1 | N/N−1 证据按 digest 校验，业务探针通过，应用 RTO ≤60 分钟 |
| F5 | 执行清理后 PITR | RPO ≤15 分钟、RTO ≤60 分钟，恢复后版本、数据、权限和写入正确 |
| F6 | 关联回归、容量和发布完整性 | REG/REL、60 分钟对照负载、长期证据读回完成 |
| F7 | Gate 2 复核 | 59 项全部登记，无开放 P0/P1，测试/DBA/DevOps/安全签署 |

F0 和 F1 是第一批开发范围。F2～F6 在流水线恢复可信后按顺序执行，避免在错误的运行基础上制造无效证据。

## 3. 第一批：修复七项已定位缺陷

### 3.1 DEF-01：统一密钥目录并恢复 P0 Runtime

**根因**

`IOT_SECRET_DIR=./.runtime/iot-manager-p0/secrets` 被启动脚本按仓库根解析，而 Compose 的相对 bind 路径按 `deploy/docker-compose.yml` 所在目录解析。脚本生成密钥和容器读取密钥落在两个目录，`secret-volume-init` 因找不到 `postgres_admin_password` 退出 78。

**修改文件**

- `scripts/runtime/start-integration.sh`
- `scripts/runtime/start-integration.ps1`
- `.github/workflows/runtime-e2e.yml`
- `scripts/ci/tests/release-workflows.test.mjs`
- 可新增 `scripts/runtime/resolve-secret-directory.*` 或等价的小型公共函数

**实现要求**

1. 读取环境文件中的 `IOT_SECRET_DIR` 后，按 Compose 基础文件目录 `deploy/` 解析相对路径；绝对路径保持不变。
2. 将解析后的绝对路径导出为当前进程的 `IOT_SECRET_DIR`，密钥生成和全部 Compose 调用使用同一个值。
3. 在启动 Compose 前执行 fail-fast 预检：目录存在、13 个要求的密钥文件存在、非空、当前进程可读；错误只打印文件名，不打印内容。
4. Bash 与 PowerShell 使用相同的路径语义。Windows 路径在进入 Docker CLI 前按仓库已有的 Git Bash/PowerShell 路径适配规则处理。
5. 清理步骤仅在 `runtime.env` 存在时把它传给 Compose；清理前核对 Compose project 名称；错误路径不得由 Docker 自动创建为 root 所有目录。
6. 清理失败必须使运行态任务失败并保留脱敏诊断；不得把 `rm -rf` 权限失败吞掉。

**新增契约检查**

- 给定模板相对路径时，启动器生成目录与 `docker compose config` 的 `/source` bind 源完全相同。
- 给定受保护环境的绝对路径时不改写。
- 缺少、空文件、不可读文件分别在启动容器前失败。
- 清理时 `runtime.env` 不存在不会掩盖原始错误，专用 project 的容器和卷可以被核对。

**通过标准**

- `secret-volume-init` 正常完成，服务专用密钥卷权限符合既定 UID/GID 和 `0400` 要求。
- Keycloak、PostgreSQL、Caddy、Backend、备份、WAL-G、Prometheus、Alertmanager 全部进入预期状态。
- P0 Runtime 的 OIDC、四角色 RBAC、HTTPS/WSS、备份、DDL 拒绝与恢复探针完整执行。
- 同一候选连续两次 P0 Runtime 成功，失败清理负例也通过。

### 3.2 DEF-02：修复回滚工作流解析错误

**根因**

`.github/workflows/rollback-drill.yml` 在 job 级 `env` 使用 `${{ runner.temp }}`，该位置不允许 `runner` context，GitHub 在创建 job 前拒绝工作流。

**修改文件**

- `.github/workflows/rollback-drill.yml`
- `scripts/ci/tests/release-workflows.test.mjs`

**实现要求**

1. 删除 job 级 `DOCKER_CONFIG: ${{ runner.temp }}/...`。
2. 在首个需要 registry 的 step 前，用运行时已有的 `$RUNNER_TEMP` 生成专用目录，并通过 `$GITHUB_ENV` 导出绝对 `DOCKER_CONFIG`。
3. 目录权限设为 `0700`；登录、拉取、推送、读回和最终 scrub 都使用同一变量。
4. `always()` 清理步骤要覆盖“证据拉取前失败”和“登录后失败”，不得引用尚未建立的目录导致二次错误。
5. 工作流只允许 `workflow_dispatch`；push 只应触发静态工作流校验，不应自动执行真实回滚。

**通过标准**

- actionlint 检查所有 workflow 为 0 错误。
- Node 工作流契约同时覆盖非法 job context、digest 格式、不可变启动参数和清理后才签名的顺序。
- GitHub 能创建回滚 job；没有受保护 Runner/审批时显示等待或明确阻断，而非解析失败。
- 真实演练阶段满足第 6 节要求后，RB-01～RB-10 才能签为 PASS。

### 3.3 DEF-03：让 PostgreSQL Flyway 冒烟测试跟随迁移清单

**根因**

测试仍断言 18 个迁移和最终 V18；PostgreSQL 当前实际执行 24 个迁移，最终版本为 V25。V19 是 H2 专用，所以“迁移数量”和“最大版本”本来就不是同一个数。

**修改文件**

- `backend/src/test/java/com/iot/manager/migration/PostgresFlywaySmokeTest.java`
- `backend/src/test/java/com/iot/manager/migration/MigrationVersionAllocationTest.java`
- 可新增测试内 `MigrationInventory` 帮助类

**实现要求**

1. 从 `migration` 与 `migration-postgresql` 的有效文件集合计算 PostgreSQL 预期版本序列，拒绝重复版本和非法文件名。
2. 迁移前记录 Flyway resolved/pending 集合；迁移后断言：执行数等于预期集合数量、pending 为 0、当前版本等于集合最大版本。
3. 明确断言 H2 专用 V19 不进入 PostgreSQL，PostgreSQL V24 与 H2 V24 分别只出现在对应 profile。
4. 保留现有 PostgreSQL 列类型、默认值、索引和写入探针；增加 V20～V25 的关键表/列/索引断言。
5. 不以单个写死的迁移数量作为唯一标准；最大版本仍需由文件清单和 Flyway 实际状态双向核对。

**通过标准**

- PostgreSQL 16 Testcontainers 从空库迁移成功并到达 V25。
- 带 V18/V19 以前数据的升级夹具可升级且关键 ID 不变。
- UTC 与 Asia/Shanghai 两个 Java job 均通过同一组迁移断言。

### 3.4 DEF-04：隔离 retention 测试数据

**根因**

篡改归档负例有意留下损坏归档和热行，整类共用同一 H2 Context，后续测试重新扫描该行并按设计失败。

**修改文件**

- `backend/src/test/java/com/iot/manager/service/RetentionServiceIntegrationTest.java`
- 新增 `RetentionServicePostgresIntegrationTest.java`

**实现要求**

1. H2 集成测试采用每个方法独立数据库/Context。优先使用 `@DirtiesContext(classMode = AFTER_EACH_TEST_METHOD)`；不能依赖测试顺序。
2. 不使用外层 `@Transactional` 假设自动回滚，因为业务代码含 `REQUIRES_NEW`；若采用显式清理，必须按 FK 顺序只清理本测试生成的 UUID 数据。
3. 开启 JUnit 随机顺序并至少重复运行三轮，证明负例不会污染正例。
4. PostgreSQL Testcontainers 增加归档成功、摘要不一致、重复执行、复制后删除前异常、水位恢复和数据库锁场景。
5. 保留当前“损坏归档使热行保留”的 fail-closed 断言，不弱化字段或 SHA-256 比对。

**通过标准**

- `RetentionServiceIntegrationTest` 整类 6/6 通过，随机顺序三轮稳定。
- H2 与 PostgreSQL 对相同固定数据给出一致的保留/归档/删除 ID 集合。
- 故障注入后热表原行仍在，失败 job run 和水位状态可解释。

### 3.5 DEF-05：消除时间静态规则的注释误报

**根因**

静态规则对完整源码文本运行正则，`TimeProvider` 注释中的 `LocalDateTime.now()` 被识别为真实方法调用。

**修改文件**

- `backend/src/test/java/com/iot/manager/service/TimeAuthorityStaticRuleTest.java`
- `backend/pom.xml`（若采用 JavaParser）

**实现要求**

1. 使用 JavaParser 的测试依赖解析 `MethodCallExpr`，检查实际调用表达式，不扫描注释、字符串或文本块。
2. 禁止 `LocalDateTime.now(...)`、`Instant.now(...)`、`System.currentTimeMillis()`、`Clock.systemUTC()`、`Clock.systemDefaultZone()` 和 `Clock.system(...)`。
3. `TimeConfiguration` 只允许建立应用唯一的 `Clock` Bean；其他生产代码必须经 `TimeProvider` 或注入 `Clock`。
4. 添加正反夹具：注释/字符串出现禁用文本应通过，真实方法调用必须失败，允许的配置边界必须通过。

**通过标准**

- 当前生产源码通过规则。
- 临时加入一个真实 `Instant.now()` 的负夹具时规则稳定失败。
- TIME-10 在两个 CI 时区均通过，规则不存在 allowlist 过宽问题。

### 3.6 DEF-06：从真实源库和候选证据确定恢复版本

**根因**

恢复 workflow 和 Bash/PowerShell 脚本默认 V18；候选当前已到 V25。恢复验收的正确关系是“恢复后数据库版本等于恢复源版本”，在发布候选模式下还必须等于准确 SHA 的迁移清单最大版本。

**修改文件**

- `.github/workflows/recovery-drill.yml`
- `scripts/runtime/recovery-drill.sh`
- `scripts/runtime/recovery-drill.ps1`
- `scripts/runtime/wal-recovery-drill.sh`
- `scripts/ci/tests/release-workflows.test.mjs`
- 可新增 `scripts/ci/detect-flyway-version.*`

**实现要求**

1. 删除所有默认 `18`；脚本不得在缺少来源时猜测版本。
2. 物理恢复开始前，从健康的源 PostgreSQL 查询最新成功 Flyway version，记录为 `sourceFlywayVersion`；恢复后必须完全一致。
3. 逻辑备份恢复在备份前记录源库版本，并将其作为与备份校验和绑定的元数据；恢复后进行同一比较。
4. immutable 发布模式从准确 checkout 的迁移清单计算候选最大版本，并要求 `candidate version == source version == recovered version`。
5. 定时恢复允许源库版本与当前默认分支不同，因而以获批准源项目的数据库版本为主，报告同时记录源 SHA/候选 ID（若可用）。
6. 恢复报告新增 `sourceFlywayVersion`、`candidateFlywayVersion`、`recoveredFlywayVersion` 和三者一致性状态。
7. 缺 Flyway history、版本非数字、源与候选不一致均在备份/恢复证明签发前失败。

**通过标准**

- V25 候选恢复到 V25；构造源 V24/候选 V25 时明确拒绝。
- 断 WAL、错目标、错版本和篡改备份均 fail-closed。
- REC-01～REC-04 的报告包含实际 RPO/RTO、恢复版本及业务读写证据。

### 3.7 DEF-07：恢复 Android API 36 构建

**根因**

当前固定的 `android-actions/setup-android` v3 构建仍请求 Google 已移除的 `tools` 包，初始化阶段退出，Gradle 尚未开始。

**修改文件**

- `.github/workflows/ci.yml`
- `scripts/ci/tests/release-workflows.test.mjs`

**实现要求**

1. 更新到已修复该行为的 `android-actions/setup-android` v4.0.1，并固定完整提交 `40fd30fb8d7440372e1316f5d1809ec01dcd3699`。
2. 设置 `packages: ''`，由后续显式命令安装 `platform-tools`、`platforms;android-36`、`build-tools;36.0.0`；setup action 只负责命令行工具和许可证。
3. 关闭许可证全文日志，保留安装失败诊断；打印 `sdkmanager --version`、Java 版本和安装包列表摘要。
4. 保持 JDK 21、API 36 和严格工具链检查，不降低 compile/target SDK。
5. 上传 APK 前验证文件存在、非空，并记录 SHA-256；工件缺失继续 fail-closed。

**通过标准**

- setup 阶段不再请求废弃 `tools` 包。
- Android debug 构建实际执行成功，APK 工件可下载且 SHA-256 可复核。
- REG-05 还需完成时间字段兼容和客户端关键旅程后才可整体 PASS。

## 4. 第二批：补齐时间与迁移覆盖

| 工作包 | 覆盖用例 | 必须新增的自动化/证据 |
| --- | --- | --- |
| TIME-A 边界判定 | TIME-01、05、06、11、12 | 固定 `Clock`；截止点 ±1ms；乱序 observed/received；分钟桶；`Z`/偏移/旧格式/非法范围；DST 仅影响显示 |
| TIME-B Edge 偏差 | TIME-03、04、REG-03 | sentAt 缺失、30s、30s+1ms、±8h、网络乱序；三次告警、恢复、再触发、防风暴、在线状态不受影响 |
| TIME-C API/安全 | TIME-07、REG-01 | `/api/time` 与 `/api/v1/time`；UTC、容差、请求 ID；401/403、限流；不暴露主机/部署信息 |
| TIME-D 旧数据 | TIME-08、09 | `legacy-time-reconciliation.sql` 使用固定夹具；确认/未知/异常 ID；重复执行只读；N/N−1 旧列解释一致 |
| MIG-A 数据库矩阵 | MIG-01、02、06 | 空 H2、空 PG16、历史 PG 副本；V20～V25；中断/重试；表、列、约束、索引和 ID 对账 |
| MIG-B N−1 兼容 | MIG-03～05 | 同一隔离 PG 中 N 写入→N−1 读写→N 再读；破坏性 migration 负例；API v1 与 Edge 协议窗口 |

建议新增测试类按职责拆分，避免把所有场景堆进一个 Spring Context：

- `AuthoritativeTimeBoundaryTest`
- `TelemetryRangeContractTest`
- `ServerTimeControllerIntegrationTest`
- `EdgeClockSkewIntegrationTest`
- `LegacyTimeReconciliationTest`
- `PostgresMigrationCompatibilityTest`

TIME/MIG 阶段完成标准：两个 CI 时区测试数量、失败数和生成的 UTC 断言一致；旧来源不明行全部保持 `LEGACY_UNKNOWN`，无统一 ±8 小时修正。

## 5. 第三批：补齐 PostgreSQL 数据保留闭环

### 5.1 固定数据集

使用固定 `T0`，每个类别准备 cutoff−1ms、cutoff、cutoff+1ms，并预先登记稳定业务 ID。覆盖：

- 遥测热表 90 天、归档总期限 365 天、无 `received_at` 的 legacy 行。
- 审计、命令、命令事件、供应商访问和凭据轮换 730 天。
- 已解决告警 365 天、未解决告警永久保护。
- 天气快照 90 天、预报 30 天、每站点当前快照保护。
- 全局、类别、站点、设备、命令 hold，以及过期和解除后的重新扫描。

### 5.2 执行步骤

1. 在隔离 PostgreSQL 16 创建快照，导出所有业务表的 ID 集合和稳定字段摘要。
2. 保持 `enabled=false` 验证调度不执行；启用 `dry-run=true` 连续运行两个真实调度周期。
3. 对比两轮预测、hold、watermark、job run 与数据库前后指纹，业务数据变化必须为零。
4. 审批后在同一冻结数据副本启用实际执行，逐 ID 对账归档/删除/保护集合。
5. 注入缺归档、字段篡改、复制后异常、锁丢失、单批超时、双实例竞争和进程退出。
6. 重启后验证水位续跑无漏无重；完整扫描结束清除水位，解除 hold 的行在下次重新评估。
7. 执行历史归档 API 的范围、游标、limit、权限、跨站点和每分钟第 5/6 次请求。
8. 输出每类 job run、Prometheus 指标、结构化日志、表/索引/TOAST、WAL 和备份变化。

### 5.3 通过标准

- RET-01～RET-14 全部具有正常、边界和失败结果。
- 预测数、实际数和预登记 ID 集合完全一致；任何未解释差异均阻断。
- 损坏或缺失归档时热行保留，事务失败，水位不越过失败批。
- hold 创建与清理通过同一 guard 行形成可解释顺序，没有已提交 hold 被绕过。
- 60 分钟相同负载下普通 API P95 相对基线上升 ≤20%，新增 5xx 为 0，无死锁或连接池耗尽。
- 真实清理后立即进入第 7 节 PITR，不以 dry-run 推断恢复能力。

## 6. 第四批：真实 N→N−1 回滚

### 6.1 准入

- 受保护 `r1-rollback-drill` environment 和 `[self-hosted, linux, iot-manager-recovery]` Runner 可用。
- N 与 N−1 都是 Release Gate 签发的不同 `KNOWN_GOOD` 候选。
- 两个候选的 release manifest、SHA、attestation、镜像 digest、SBOM、扫描、API/协议/schema 元数据可按 digest 取回。
- N−2 证据至少完成可读性核对，用于证明保留链没有断裂。

### 6.2 演练

1. 预拉 N/N−1 全部镜像并验证 digest，关闭网络拉取兜底。
2. 在独立 Compose project 部署 N，完成登录并写入可识别设备、命令、遥测标记。
3. 使用单调时钟记录停止 N 的决策时刻。
4. 保留同一数据库卷，以 `--no-build --pull never` 启动 N−1，不执行 Flyway 降级。
5. 验证标记读取和写入、旧墙钟截止、OIDC、四角色、站点隔离、API v1、浏览器 WSS 与 Edge WSS。
6. 业务验证完成时停止计时；RTO 以该时间为准。
7. 执行缺 digest、篡改 manifest、错 schema、80/443 占用、疑似生产 project、中途取消等负例。
8. 先销毁并验证隔离资源，再签发成功证明并写入长期 OCI 归档。

### 6.3 通过标准

- RB-01～RB-10 全部 PASS；应用 RTO ≤60 分钟。
- 没有数据丢失、跨站点读取或权限提升。
- 清理成功前无法产生成功 attestation。
- N/N−1/N−2 及完整证据符合 180 天和三个已知良好候选保留规则。

## 7. 第五批：清理后物理恢复

1. 使用已执行实际 retention 的隔离源库，确认 base backup、新鲜 WAL 链和命名恢复点。
2. 源 project 与恢复 project/卷必须不同，目标卷预存在时拒绝执行。
3. 执行 WAL-G PITR，记录恢复点、目标 WAL、源/候选/恢复 Flyway 版本、单调 RTO 和 marker age。
4. 验证设备、命令、遥测归档、hold、角色、站点权限和恢复后写入。
5. 注入断 WAL、错误 base backup、错误 project 和篡改校验和。

通过标准：REC-01～04 全部 PASS，RPO ≤15 分钟、RTO ≤60 分钟；恢复报告没有秘密值，且由同一候选的 Release Gate 引用。

## 8. 第六批：关联回归与发布完整性

| 范围 | 必须完成 |
| --- | --- |
| REG-01～02 | 四角色与无权限账号、两站点切换、A/B 乱序响应、WS 重连、前后台恢复 |
| REG-03～04 | Agent 断连/多连接/TTL/命令幂等；天气成功、失败、缓存、位置变化、节流和隐私 |
| REG-05～06 | 三个 Web 构建、Android debug APK、时间字段兼容；完整 HTTPS/WSS/OIDC/PostgreSQL/观测栈 |
| REL-01～03 | tag/手工/Quick CI 信任边界；同一候选关联；每个镜像的 SBOM、provenance、扫描和 VEX |
| REL-04～07 | P0 Runtime 连续两次；恢复拓扑；失败注入；签名证据长期 OCI 归档和 digest 读回 |

Gate 3 的真机 GPS、BLE、真实 Shelly/nRF52840、两个真实站点和签名 Release APK继续按既定 Gate 3 单独验收，不能用本方案中的模拟记录替代。

## 9. 验证命令与证据产物

修复开发阶段至少执行以下入口；正式 Gate 以 GitHub 同一 SHA 的运行记录为准：

```text
actionlint .github/workflows/*.yml
node scripts/ci/tests/release-tools.test.mjs
node scripts/ci/tests/release-workflows.test.mjs
mvn -f backend/pom.xml test
mvn -f edge-agent/pom.xml test
bash scripts/verify.sh --strict
docker compose --env-file deploy/.env.integration \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.integration.yml config --quiet
```

应保留的脱敏证据：

- Surefire XML、双时区测试摘要、Android APK SHA-256。
- Compose config、service 状态/digest、健康探针、OIDC/RBAC/WS 报告。
- 两轮 dry-run 与实际 retention 的 ID/摘要差异、job run、水位、hold 和指标。
- N/N−1 manifest、attestation、业务探针和单调 RTO。
- PITR 的 base backup/WAL/恢复点、源/候选/恢复版本、RPO/RTO 与写入探针。
- Image Security、Release Gate、长期 OCI digest 和读回校验。

凭据、令牌、密钥值、真实位置和生产标识不进入仓库或公共 Actions 工件。

## 10. 缺陷关闭矩阵

| 缺陷 | 主责 | 代码完成条件 | 最终关闭条件 |
| --- | --- | --- | --- |
| DEF-01 | DevOps/Backend | 绝对密钥目录统一、预检和清理契约通过 | P0 Runtime 连续两次完整成功 |
| DEF-02 | DevOps/安全 | actionlint 与工作流契约通过，GitHub 可创建 job | 真实 RB-01～10 演练成功 |
| DEF-03 | Backend/DBA | PG migration inventory 测试通过 | 空库、历史库、双时区 CI 通过 |
| DEF-04 | Backend/测试 | retention 整类随机顺序三轮通过 | PostgreSQL RET-01～14 完成 |
| DEF-05 | Backend/测试 | AST 规则正反夹具通过 | TIME-10 双时区通过 |
| DEF-06 | DBA/DevOps | 无硬编码版本，三版本关系写入报告 | REC-01～04 真实演练通过 |
| DEF-07 | Android/DevOps | API36 debug APK 构建并产生 SHA | REG-05 客户端合同和关键旅程通过 |

## 11. 工作量与提交拆分建议

| 提交包 | 内容 | 估算 |
| --- | --- | --- |
| FIX-A | DEF-01 密钥路径、预检、清理 | 1～2 人日 |
| FIX-B | DEF-02 回滚 workflow 解析与契约 | 0.5～1 人日 |
| FIX-C | DEF-03～05 Java 测试门禁 | 1.5～2.5 人日 |
| FIX-D | DEF-07 Android action 与 APK 证据 | 0.5～1 人日 |
| FIX-E | DEF-06 恢复版本来源与证据 | 1.5～2.5 人日 |
| TEST-A | TIME/MIG 缺失矩阵 | 3～5 人日 |
| TEST-B | PostgreSQL retention 全矩阵 | 4～7 人日 |
| DRILL-A | 真实回滚、PITR、负例和证据 | 2～4 人日，另需受保护环境排期 |
| REG-A | 关联回归、容量与 Gate 汇总 | 2～4 人日 |

每个提交包独立可审查，但正式候选必须把全部修复合并到一个 SHA 后重新跑完整 Gate。不要在 FIX-C 中顺便改 retention 生产策略，也不要在 FIX-E 中扩大恢复目标范围。

## 12. 最终签发标准

只有同时满足以下条件，测试负责人才能申请 Gate 2：

1. 测试报告中的 59 项用例均有实际结果，`FAIL/BLOCKED/SKIPPED` 为 0。
2. 同一 SHA 的 Quick CI、P0 Runtime、Image Security、Recovery、Release Gate 全绿；P0 Runtime 连续两次成功。
3. 两轮 PostgreSQL dry-run、实际 retention、N→N−1 和清理后 PITR 均完成。
4. 应用回滚 RTO ≤60 分钟；PITR RPO ≤15 分钟、RTO ≤60 分钟。
5. 90/365/730 天各类别的预测、实际和稳定 ID 集合一致，受保护数据零误删。
6. N/N−1/N−2 制品与证据按不可变 digest 可取回，签名、主体和 SHA 对应正确。
7. 无开放 P0/P1；所有 P2 有影响、规避方式、责任人和期限。
8. 测试、Backend、DBA、DevOps、安全完成签署。Gate 2 通过仍不等于 Gate 3 已完成。

本方案完成后应新建复测报告，引用修复 SHA、每个工作流运行 ID、制品 digest 和受控证据索引；原测试报告保留为失败基线，不覆盖或改写历史结论。
