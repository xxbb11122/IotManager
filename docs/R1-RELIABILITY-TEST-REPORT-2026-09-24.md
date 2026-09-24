# R1 三工作包专项测试执行报告

| 项目 | 本次记录 |
| --- | --- |
| 执行日期 | 2026-09-24（Asia/Shanghai） |
| 测试基线 | `609c9f07f341e414cbfe665ea2093a7f8f1591f1`；本地 HEAD 与 GitHub Actions 的 `head_sha` 一致 |
| 执行依据 | `docs/R1-RELIABILITY-TEST-PLAN-AND-ACCEPTANCE-v1.0.md`，59 个编号用例及 S0～S7 门禁 |
| 范围 | `P0-TIME-01`、`P0-ROLLBACK-01`、`P1-RETENTION-01`，以及直接关联的迁移、恢复、客户端和发布回归 |
| 总结论 | **不通过，不能签发 Gate 2，更不能宣称 Gate 3 或生产就绪**。59 项中完整 PASS 0、FAIL 5、BLOCKED 54、SKIPPED 0。下文另列通过的*局部自动化检查*，不把它们冒充完整用例通过。 |

本报告只记录此次确实执行或读取的证据。没有在用户数据库运行清理、没有覆盖生产卷、没有伪造已签名制品或受保护 Runner 的演练结果。`BLOCKED` 表示缺少完整执行环境、前置门禁或数据矩阵，**不等于功能失败**；`FAIL` 表示本次候选的相应验收项已经观察到失败，即使根因在测试/CI 而非业务代码。

## 1. 环境、候选与证据索引

- 本地：Windows；JDK 17（`C:\Program Files\Java\jdk-17`）、Maven 3.9.11（`D:\apache-maven-3.9.11`）、Node 24；Docker Desktop Linux Engine 未启动，无法在本机运行 Testcontainers、Compose、PITR。默认 `java` 是 Java 8；仓库 Windows `mvnw.cmd` 本机报 `fail to move MAVEN_HOME`，故后端测试改用已安装的 Maven/JDK 17。该替代不改变被测源码，但不能代表 CI 工具链。
- GitHub [Quick CI #35962274151](https://github.com/xxbb11122/IotManager/actions/runs/35962274151)：同一 SHA；Web、静态 Compose/Caddy、源码安全/SBOM 成功；UTC 与 Asia/Shanghai Java job 均失败；Android job 在 SDK 初始化阶段失败；`quick-gate` 因前置失败而失败。
- GitHub [P0 Docker Runtime #35962274196](https://github.com/xxbb11122/IotManager/actions/runs/35962274196)：同一 SHA；静态 Compose 校验成功，真实栈在 `secret-volume-init` 失败，后续健康、OIDC、RBAC、恢复探针未执行。脱敏工件 `p0-runtime-evidence-609c9f07f341e414cbfe665ea2093a7f8f1591f1` 的 `compose-logs.txt` 显示 `Required source secret is unavailable or empty: postgres_admin_password`。
- GitHub [Rollback Drill #35962273452](https://github.com/xxbb11122/IotManager/actions/runs/35962273452)：同一 SHA；工作流文件在 GitHub 校验阶段失败，无 job/Runner 运行证据。`actionlint v1.7.12` 本地明确定位到 `.github/workflows/rollback-drill.yml:40`。
- 本地 JDK 17：`backend/target/surefire-reports/`；Edge `edge-agent/target/surefire-reports/`。本地仅使用隔离 H2 内存库；`PostgresFlywaySmokeTest` 由 GitHub 的 PostgreSQL 16 Testcontainers job 提供实际日志。
- 本地契约：`node scripts/ci/tests/release-tools.test.mjs` 与 `node scripts/ci/tests/release-workflows.test.mjs` 均退出 0；`actionlint` 检查全部六个 workflow 时仅报告回滚工作流的上述错误；Git Bash `bash -n` 检查四个运行/恢复脚本通过。契约/语法通过不代表回滚或恢复通过。
- `node scripts/db/retention-capacity-model.mjs --input docs/retention-capacity-input.example.json` 退出 0，输入标记为 `illustrative`，**不能**作为生产容量或 RTO 证据。
- 本次没有同 SHA 的 Image Security、Release Gate 成功运行、N/N−1/N−2 `KNOWN_GOOD` digest/签名读回或长期 OCI 证据；GitHub Release 列表为空也不能证明 GHCR 中绝对不存在制品，只能说本次未取得符合 S0 的证明。

## 2. 已实际运行的局部自动化结果

| 检查 | 实际结果 | 证明范围与限制 |
| --- | --- | --- |
| 本地 Edge Agent `mvn test` | 7 测试、0 失败、0 错误 | Agent 模块自身回归；不是真实 BLE/Shelly 或 Edge/Backend 全链路 |
| H2 旧版设备迁移兼容单测 | 1/1 通过，H2 迁移到 V25 | `DevicePlatformMigrationCompatibilityTest`；不证明 PostgreSQL 历史升级或 N−1 实际读写 |
| Edge 连续三次偏差心跳单测 | 1/1 通过 | 证明测试里的站点诊断告警与仍在线；未测 30 秒±1ms、恢复/再触发、真实网络延迟 |
| 保留锁单测 | 1/1 通过 | 证明该测试的单个竞争场景；未测双实例、租期续期与进程崩溃 |
| 正常遥测归档单独运行 | 1/1 通过 | 新 H2 库中归档、核验、热表删除与 legacy 保留；未覆盖全部期限/类别/PostgreSQL |
| 保留 dry-run 单独运行 | 1/1 通过 | 单次 H2 dry-run 不删除；未达到方案要求的**两个调度周期**、全类别 ID 对账 |
| 预置篡改归档单独运行 | 1/1 通过 | 摘要不一致时抛错并保留热行；未覆盖复制后删除前异常和 PostgreSQL 事务 |
| Node 发布工具/工作流契约 | 2 个脚本均 PASS | 仅静态/模拟契约；不能替代签名制品读回或真实回滚 |

完整 `RetentionServiceIntegrationTest` 类在本地为 **6 项中 4 项 ERROR**；这与 GitHub UTC/Shanghai 两个 job 一致。单独正常归档、dry-run、篡改保护均通过，说明这 4 个错误目前首先是**测试相互污染**，不能直接断言正常归档算法在干净数据库必然失败，也不能据此放行保留功能。

## 3. 已定位缺陷/阻断项（按优先级）

| ID / 级别 | 现象与可复核根因 | 影响及最小修复方向 |
| --- | --- | --- |
| DEF-01 / P0 | P0 Runtime 的 `secret-volume-init` 退出 78。`deploy/.env.integration.example:70` 指定 `IOT_SECRET_DIR=./.runtime/iot-manager-p0/secrets`；`scripts/runtime/start-integration.sh:167-172` 将相对路径拼到**仓库根**，而 Compose 的 `deploy/docker-compose.yml:56` 将相对 bind 源解析到 **deploy 目录**。本地 `docker compose config` 明确显示 `/source` 实际来自 `.../iot-manager/deploy/.runtime/iot-manager-p0/secrets`；CI 脱敏日志显示其中缺 `postgres_admin_password`。 | 全链路启动、REL-04、REG-06、PITR 前置均阻断。统一为经过校验的绝对密钥目录，启动器和 Compose 使用同一值；再检查失败清理中 `runtime.env` 不存在与 root-owned bind 目录权限错误，不得仅重跑。 |
| DEF-02 / P0 | `.github/workflows/rollback-drill.yml:40` 在 job 级 `env` 引用 `${{ runner.temp }}`；GitHub 此位置不允许 `runner` context。GitHub 该 workflow 在 push 上显示解析失败、无 job；`actionlint` 报同一行。 | RB-01～RB-10 都无法启动。把 `DOCKER_CONFIG` 放到允许 `runner.temp` 的 step 级环境/运行时设置，或使用此处允许的上下文，并重新做 `actionlint` 与受保护环境的真实演练。 |
| DEF-03 / P1（测试门禁） | PostgreSQL 16 Testcontainers 实际执行了 24 个迁移（版本序列到 V25；V19 仅 H2），但 `PostgresFlywaySmokeTest.java:32-33` 仍断言执行数及最终版本均为 18；CI 报 `expected: 18, but was: 24`。 | 双时区 Java job 与 Quick CI 失败；当前证据不是 Flyway 迁移 SQL 出错。以当前获批准迁移清单核验实际 PG 个数与最终 V25，增加两 profile 版本分配断言，避免未来再写死旧数。 |
| DEF-04 / P1（测试隔离） | `RetentionServiceIntegrationTest` 类仅 `AFTER_CLASS` 重置 Spring Context，`archiveChecksumMismatchFailsTheBatchAndRetainsTheHotSample` 在同一 H2 数据库保存 `{"tampered":true}` 归档并故意留下热行。随后 4 个用例调用 `runOnce()`，重新扫描同一源样本 2，按设计在 `stateJson` 校验处抛错；独立运行的正常/负例都通过。 | 整类与 CI 失败；修复为每测试独立数据库/事务可靠回滚或在负例后清理**本测试专用**数据，再随机顺序/双时区整类复跑。不能删除生产归档或弱化 fail-closed 校验。 |
| DEF-05 / P1（静态规则误报） | `TimeAuthorityStaticRuleTest` 正则扫描整份 Java 文本，`TimeProvider.java:43` 的注释 `LocalDateTime.now()` 被当成实际直接取时钟调用。独立/CI 均复现。 | TIME-10 与双时区 Java job 失败；改为语法树/去注释扫描或收紧匹配，同时保留真实直接调用的负例以防规则被削弱。 |
| DEF-06 / P1（恢复门禁） | `.github/workflows/recovery-drill.yml:81,190`、`scripts/runtime/recovery-drill.sh:135` 等仍预期 Flyway 18；候选已为 V25。 | REC-02/03 的版本核对会误判或误验。预期版本应从同一候选/源库的签名证据派生并做一致性校验，不能只把常量随手替换为 25。 |
| DEF-07 / P1（CI 环境） | Android JDK21/API36 job 的 `android-actions/setup-android` 阶段调用 `sdkmanager tools`，日志报 `Failed to find package 'tools'` 并退出 1，APK 编译步骤未开始。 | REG-05 与 Quick CI 全绿被阻断；更新/替换被固定的 setup-android 行为，验证 Android API36 安装与 debug APK 实际产物。不能称为应用编译失败。 |

本次未发现数据被误删的证据；也**未证明**归档/清理在 PostgreSQL 或双实例下安全。`DEF-01` 和 `DEF-02` 是直接阻断真实运行与回滚的实现/工作流问题；`DEF-03`～`05` 主要是测试门禁问题，不能简单概括为“业务功能坏了”。

## 4. 59 项用例逐项登记

状态按第 10 节“完整覆盖才 PASS”解释。下列局部成功可用于复测起点，但不满足对应编号用例的全部精确预期。`B`=BLOCKED，`F`=FAIL。

### TIME / MIG

| 用例 | 状态 | 本次依据或缺口 |
| --- | --- | --- |
| TIME-01 | B | 无固定 Clock 的 TTL/天气/命令/限流/保留全边界矩阵。 |
| TIME-02 | B | UTC 与 Asia/Shanghai CI 都运行，但 Java job 均因 DEF-03～05 失败，无法对比完整相同数据结果。 |
| TIME-03 | B | 仅 ±8h 中的一个 Edge 偏差集成场景成功；缺缺失/30s±1ms/真实延迟。 |
| TIME-04 | B | 三次偏差及在线/告警局部通过；恢复、再次超限和防风暴未执行。 |
| TIME-05 | B | 无乱序接收、跨分钟、最新值/桶键 ID 级测试。 |
| TIME-06 | B | 无 `Z`/偏移/旧格式/无效格式的完整 HTTP 合同。 |
| TIME-07 | B | 端点源码可见，但授权、限流、请求 ID 的实际 HTTP 证据缺失。 |
| TIME-08 | B | 未运行带可证明/未知来源旧行的只读对账，`LEGACY_UNKNOWN` 数量未知。 |
| TIME-09 | B | 无 N 与 N−1 同库读写和旧 `TZ` 实测。 |
| TIME-10 | F | 静态规则因注释误报，独立与 CI 均失败（DEF-05）。 |
| TIME-11 | B | 无 DST 展示时区/非法 legacy-zone 的合同测试。 |
| TIME-12 | B | 无 REST/WS/日志新旧字段与关联 ID 的完整合同记录。 |
| MIG-01 | F | H2 空库及旧 V1 升级到 V25 局部成功；PostgreSQL 冒烟被旧版 18 断言直接判失败；历史 PG 副本未测（DEF-03）。 |
| MIG-02 | B | 尚未对 H2/PG 约束、索引和 V24 语义做逐项差异审计。 |
| MIG-03 | B | 无同一隔离 PG 库的 N→N−1 读写。 |
| MIG-04 | B | 无 N/N−1 交错写入和 API/Edge 兼容窗口实测。 |
| MIG-05 | B | 未注入破坏性迁移/缺列的真实拒绝样本。 |
| MIG-06 | B | 未做中断与重试的 Flyway history/ID 对账。 |

### RET

| 用例 | 状态 | 本次依据或缺口 |
| --- | --- | --- |
| RET-01 | B | 静态配置默认关闭/dry-run 与 1–5000 限界可见；未做所有非法配置的启动拒绝。 |
| RET-02 | B | 单独 H2 dry-run 通过；缺两个调度周期、全表/ID 指纹与 PostgreSQL。 |
| RET-03 | B | 单独 H2 遥测 120 天归档通过；缺 90/365/730 天±1ms、全部类别和冻结 ID 集合。 |
| RET-04 | B | 摘要比对代码与单次归档已测；缺同批重放及相同 `source_sample_id` 的全字段验证。 |
| RET-05 | B | 篡改归档的 fail-closed 测试单独通过；缺缺行、复制后删除前异常/PG 事务。 |
| RET-06 | B | 未测热表中已超 365 天积压行的先归档再清理。 |
| RET-07 | B | 一个设备 hold 测试在整类中局部通过；缺所有 scope、过期/解除、审计与角色。 |
| RET-08 | B | 未构造 hold/批次 guard 双顺序竞态。 |
| RET-09 | B | 单个锁场景通过；缺双 Backend、续租、超时、崩溃与水位恢复。 |
| RET-10 | B | 历史归档 API 分页、跨站点、权限和第 5/6 次限流未测。 |
| RET-11 | B | 无全类别 job run、指标和结构化日志逐项对账。 |
| RET-12 | B | 仅 `illustrative` 示例模型可运行，无实测行大小/WAL/备份/RTO 输入。 |
| RET-13 | B | 源码可见默认关闭及 UTC cron；未运行实际两个调度周期/多实例。 |
| RET-14 | B | 未实测 PostgreSQL 表/索引/TOAST、不可用值语义和容量基线。 |

### RB / REC

| 用例 | 状态 | 本次依据或缺口 |
| --- | --- | --- |
| RB-01 | B | 未取回经签名的真实 N 与 N−1 `KNOWN_GOOD` OCI 证据。 |
| RB-02 | B | 未在受保护 Runner 预拉 digest 或注入缺失/篡改；工作流解析失败。 |
| RB-03 | B | 未部署 N 并写入隔离 PG 标记。 |
| RB-04 | B | 未在同一数据库启动 N−1，不能证明 immutable/无降级。 |
| RB-05 | B | 未执行 N−1 OIDC/RBAC/API/WS/Edge 业务探针。 |
| RB-06 | B | 未执行 schema/配置/端口/生产目标拒绝注入。 |
| RB-07 | B | 未执行取消/失败清理与证明签发顺序；现有 P0 Runtime 清理本身报错。 |
| RB-08 | B | 未得到单调计时的业务验证完成时间；应用 RTO 未知。 |
| RB-09 | B | N/N−1/N−2 的 digest 可读性及 180 天保留证据未取得。 |
| RB-10 | B | 无升级 Android 客户端连接 N−1/签名 versionCode 证据。 |
| REC-01 | B | 无实际清理后的独立源库、base backup/WAL 连续链和恢复点。 |
| REC-02 | B | 受保护 PITR 未执行；RPO/RTO 未知。 |
| REC-03 | B | 未对恢复后 V25、设备/命令/归档、权限与写入验收；DEF-06 旧版 18 预期阻断。 |
| REC-04 | B | 未在隔离恢复目标注入断 WAL/错目标/篡改备份。 |

### REG / REL

| 用例 | 状态 | 本次依据或缺口 |
| --- | --- | --- |
| REG-01 | B | P0 Runtime 未起栈，四角色/越权合同未执行。 |
| REG-02 | B | 无双站点客户端乱序响应与 WS 重连实测。 |
| REG-03 | B | Edge 单个偏差在线场景成功；断连/多连接/命令重试全矩阵未测。 |
| REG-04 | B | 无时间变更后的天气主源故障/缓存/节流完整运行证据。 |
| REG-05 | F | Web 构建成功，但 Android setup 在编译前失败，合同和 APK 不满足全过（DEF-07）。 |
| REG-06 | F | Compose 配置校验成功，但真实 P0 栈因密钥目录不一致退出 78（DEF-01）。 |
| REL-01 | B | 合同脚本通过；tag/手工/Quick CI 三入口的真实篡改矩阵未测。 |
| REL-02 | B | 无同一 release ID 的 manifest/digest/服务目录全链读回。 |
| REL-03 | B | 源码安全/SBOM job 成功；生产镜像全量扫描/VEX/缺项注入未取得。 |
| REL-04 | F | P0 Runtime 首次未启动，更无两次连续成功（DEF-01）。 |
| REL-05 | B | HTTPS/WSS、Keycloak/OIDC/RBAC/备份探针因栈未启动无法执行。 |
| REL-06 | B | 观察到前置失败会阻断 Quick Gate；缺完整负例矩阵/143/签名产物验证。 |
| REL-07 | B | 无 Release Gate 成功及长期 OCI 签名证据/N/N−1/N−2 读回。 |

合计：TIME 1 F/11 B，MIG 1 F/5 B，RET 0 F/14 B，RB 0 F/10 B，REC 0 F/4 B，REG 2 F/4 B，REL 1 F/6 B；即 **5 F、54 B、0 PASS**。

## 5. 阶段门禁与下一次复测顺序

| 阶段 | 当前判定 | 放行前必须补的证据 |
| --- | --- | --- |
| S0 | BLOCKED | 修复已知阻断；冻结同 SHA 的迁移/配置快照、N/N−1/N−2 digest 与签名、隔离备份/WAL。 |
| S1 | FAIL | 修复 DEF-03～05、07；双时区 Java 与 Android 实际 build 全绿，Quick Gate 成功。 |
| S2 | BLOCKED | TIME/MIG 完整边界、历史 PG 升级、旧时间对账与 N−1 同库兼容。 |
| S3 | BLOCKED | 隔离 PostgreSQL 两次调度 dry-run、逐 ID 对账后才允许真实归档/清理；加入竞态和故障注入。 |
| S4 | BLOCKED | DEF-02 修复并由受保护 Runner 使用真实 N/N−1 签名 digest 完成应用回滚与 ≤60min 业务 RTO。 |
| S5 | BLOCKED | DEF-06 修复；清理后独立 PITR，RPO ≤15min、RTO ≤60min，含业务读写。 |
| S6 | BLOCKED | DEF-01/07 修复并两次完整 P0 Runtime；60min 基线/清理对照、两站点与 Android/客户端回归。 |
| S7 | BLOCKED | 上述证据全齐、无开放 P0/P1、角色签署；本报告不是签署意见。 |

建议按 **DEF-01 → DEF-02 → DEF-03/04/05/07 → DEF-06 → S1/S2/S3/S4/S5/S6 复测** 处理。任何修复都会产生新 SHA；新报告必须重建同一候选的 CI/运行态/制品关联，不能把本次 SHA 的局部绿色记录直接挪作新候选 Gate 证据。

## 6. 尚不能回答的验收数字

- 90/365/730 天全类别的保留、归档、删除、hold 精确 ID 与计数：**未实测**。
- `LEGACY_UNKNOWN` 数量、可证明来源比例：**未实测**。
- N/N−1/N−2 digest、签名、180 天可取回性：**无合格读回证据**。
- N→N−1 应用 RTO、清理后 PITR RPO/RTO：**未执行，不得填 0 或“达标”**。
- 60 分钟基线/清理负载、锁等待、连接池、WAL 与备份速率：**未实测**。
- Gate 3 的真实设备、真机 GPS/BLE、两个真实站点、签名 Release APK：**不属于本次可替代的模拟证据，仍待真实验收**。

本次未改动业务代码或工作流，也未提交 GitHub。诊断期间添加的临时打印已撤销；工作区原有未跟踪动效文档和测试方案未改动。
