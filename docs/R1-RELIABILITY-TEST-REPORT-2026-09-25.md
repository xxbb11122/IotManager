# R1 三工作包专项复测报告（阶段性）

| 项目 | 本次记录 |
| --- | --- |
| 复测日期 | 2026-09-25（Asia/Shanghai）；GitHub Actions 运行于 2026-09-24 UTC |
| 冻结候选 | `ee036dd6c8845fa503f6cca5acca82861b9ba769` |
| 测试依据 | `R1-RELIABILITY-TEST-PLAN-AND-ACCEPTANCE-v1.0.md` 的 59 个编号用例及 S0～S7 门禁 |
| 范围 | `P0-TIME-01` 时间权威、`P0-ROLLBACK-01` N→N−1 回滚、`P1-RETENTION-01` 数据保留，以及迁移、恢复、客户端和发布回归 |
| 严格结论 | **尚未通过完整验收，不得签发 Gate 2/Gate 3。** 59 项中完整 PASS 1、FAIL 3、BLOCKED 55、SKIPPED 0。局部自动化通过不等于其所属完整用例通过。 |

本报告是对 [2026-09-24 首轮报告](R1-RELIABILITY-TEST-REPORT-2026-09-24.md)的同一测试计划、**新 SHA** 复测，不能混用两次候选的 Gate 证据。`FAIL` 表示本候选的验收动作实际未达到标准，未必是业务逻辑故障；`BLOCKED` 表示尚无完整执行或前置证据，不等于代码已证明失败。本轮没有在用户数据库运行清理，没有覆盖业务卷，也没有虚构签名制品、回滚或 PITR 结果。

## 1. 已执行检查与直接证据

| 检查 | 结果 | 可证明范围与限制 |
| --- | --- | --- |
| 本机 JDK 17、`-Duser.timezone=UTC` 完整 Backend Maven 回归 | 139 项，0 失败、0 错误、2 跳过 | Linux Docker Engine 在本机不可用；两项 PostgreSQL Testcontainers 跳过。Java 日志为 `Z`，并非仅设置 Windows `TZ` 环境变量。 |
| 本机 JDK 17、`-Duser.timezone=Asia/Shanghai` 完整 Backend Maven 回归 | 139 项，0 失败、0 错误、2 跳过 | 与 UTC 使用同一候选及测试集；不能由此推出全部 TIME-01～12 边界已测。 |
| [Quick CI #36041859495](https://github.com/xxbb11122/IotManager/actions/runs/36041859495) 的 Java 双时区矩阵 | UTC、Asia/Shanghai 均成功 | GitHub Docker-capable Runner 实际执行 PostgreSQL Testcontainers；`RetentionServicePostgresIntegrationTest` 与 `TimeAuthorityStaticRuleTest` 均无失败/跳过。 |
| 同次 Quick CI 的 Web、Console、Client 与静态 Compose/Caddy | 成功 | 只覆盖构建及静态配置，不证明 Android 运行或真实 12 服务栈。 |
| 同次 Quick CI 的 Android debug 编译 | Gradle `BUILD SUCCESSFUL`，后续 APK 校验失败 | 校验步骤在默认 `client` 工作目录中使用 `client/android/...`，实际多了一层 `client/`；APK 上传未执行，`quick-gate` 失败。 |
| 同次 Quick CI 的源码安全 | Gitleaks 命中 1 项，Trivy/SBOM 未执行；证据上传又因目录无文件失败 | 命中行 `scripts/runtime/start-integration.ps1:231` 是所需 Secret **文件名**清单，不含 Secret 值；应精确处置误报并重跑，不能将本次安全门禁记为通过。 |
| [P0 Docker Runtime #36041859602](https://github.com/xxbb11122/IotManager/actions/runs/36041859602) | 失败/中断 | `Start the two-phase integration stack` 构建 `alertmanager` UI 的 `vite build` 时长时间无完成日志，之后 Runner 报 shutdown signal/operation canceled。健康、OIDC、RBAC、备份/恢复步骤均未执行；不能判定真实栈成功，也不能仅凭本次中断断言业务容器故障。 |
| Node 发布工具及工作流契约测试 | `release-tools.test.mjs`、`release-workflows.test.mjs` 均通过 | 证明局部解析、校验和 fail-closed 合同；不是真实 OCI 制品、受保护 Runner 或 N→N−1 演练。 |
| Bash/PowerShell 运行与恢复脚本语法 | Bash `-n` 与 PowerShell parser 均通过 | 语法检查不证明真实恢复。 |

本机 `docker info` 无法连接 `dockerDesktopLinuxEngine`；Windows 仅见停止状态的 `com.docker.service`，没有可用的独立 PostgreSQL 服务。因此本机不能运行完整 Compose、双实例保留、清理后 WAL/PITR；GitHub Java job 提供的是**部分**真实 PostgreSQL 集成证据，不可替代这些场景。

## 2. 59 个编号用例逐项登记

状态按“全部步骤及精确预期满足才 PASS”裁定。局部成功写在依据栏，但仍保持 BLOCKED。`P`=PASS、`F`=FAIL、`B`=BLOCKED。

### TIME / MIG

| 用例 | 状态 | 本次依据或剩余缺口 |
| --- | --- | --- |
| TIME-01 | B | 缺 TTL、在线、天气、命令、凭据、限流、保留全部 `cutoff±1ms` 固定 Clock 矩阵。 |
| TIME-02 | B | 双时区完整套件均绿，但尚无同一冻结数据的查询结果、分钟桶和生成 UTC 值逐项对比。 |
| TIME-03 | B | Edge 偏差/在线局部测试通过；缺缺失 `sentAt`、30 秒±1ms 和延迟诊断全矩阵。 |
| TIME-04 | B | 连续超限局部测试通过；恢复及再次超限、防告警风暴未完整验证。 |
| TIME-05 | B | 缺乱序接收、跨分钟、最新值及桶键的 ID 级对账。 |
| TIME-06 | B | 缺 `Z`、`+08:00`、旧无偏移、非法格式和反向范围的完整 HTTP 合同实测。 |
| TIME-07 | B | 缺新旧时间 API 的授权、限流、请求 ID 和信息暴露实际响应记录。 |
| TIME-08 | B | 未对旧行运行来源可证明/未知来源的只读对账；`LEGACY_UNKNOWN` 数量未知。 |
| TIME-09 | B | 未在同一数据库运行 N/N−1 的旧墙钟列读写与 `TZ` 配置匹配。 |
| TIME-10 | P | AST 规则扫描生产 Java 源码；唯一允许的系统时钟调用为 `TimeConfiguration` 中的 `Clock.systemUTC`，并验证注释/字符串不误报及真实调用可检出；双时区 CI 通过。 |
| TIME-11 | B | 缺 DST 显示时区和非法 legacy-zone 配置的合同实测。 |
| TIME-12 | B | 缺 REST/WS/审计日志新旧时间字段、相关 ID 的完整合同与样本。 |
| MIG-01 | B | H2 与 GitHub PostgreSQL 全新库迁移及冒烟通过；缺带历史数据的 PostgreSQL 升级副本。 |
| MIG-02 | B | 缺 H2/PG 表、唯一键、约束、索引及双 profile V24 的逐项等价审计。 |
| MIG-03 | B | 缺 N 在同一隔离库写入后由 N−1 实际读写。 |
| MIG-04 | B | 缺 N/N−1 交错写入和旧 API/Edge 协议窗口实测。 |
| MIG-05 | B | 未注入缺列、破坏性迁移、强制非空的拒绝样本。 |
| MIG-06 | B | 未做真实迁移中断/重试的 Flyway history 与数据 ID 对账。 |

### RET

| 用例 | 状态 | 本次依据或剩余缺口 |
| --- | --- | --- |
| RET-01 | B | 默认关闭/dry-run 和批量限界可见；缺所有非法参数的启动拒绝。 |
| RET-02 | B | H2/PG 测试均覆盖局部 dry-run；缺隔离 PG 的两个**调度周期**、全类别预测/指纹对账。 |
| RET-03 | B | PG 遥测归档集成场景通过；缺全部类别 90/365/730 天±1ms 的冻结 ID 集合。 |
| RET-04 | B | PG 覆盖幂等与源 ID 局部核对；缺预置同 ID 归档的全字段/摘要矩阵。 |
| RET-05 | B | H2/PG 校验和错误时热行保留通过；缺缺行、字段变更、复制后删除前中断等故障注入。 |
| RET-06 | B | 未做超 365 天热表积压先归档核验再清理的 ID 级验收。 |
| RET-07 | B | PG 设备 hold 局部通过；缺所有 scope、过期/解除、权限和不可变审计。 |
| RET-08 | B | 未运行 hold 与批次 guard 两种并发顺序。 |
| RET-09 | B | PG 游标/水位及单锁场景通过；缺双实例、续租、超时和进程崩溃恢复。 |
| RET-10 | B | 历史归档 API 的范围、分页、限流和站点权限未实测。 |
| RET-11 | B | 全类别 job run、hold 事件、指标和结构化日志未对账。 |
| RET-12 | B | 尚无真实设备量、行大小、WAL/备份与恢复预算输入；示例不能作为容量结论。 |
| RET-13 | B | 默认关闭/UTC cron 可见；未运行实际多实例与两个调度周期。 |
| RET-14 | B | 未实测 PG 表/索引/TOAST、不可用值语义及容量基线。 |

### RB / REC

| 用例 | 状态 | 本次依据或剩余缺口 |
| --- | --- | --- |
| RB-01 | B | 无 N/N−1 两个不同 `KNOWN_GOOD` 的签名 OCI digest 及 manifest 读回。 |
| RB-02 | B | 未在受保护 Runner 预拉 digest 或注入缺失/篡改。 |
| RB-03 | B | 未部署 N 并在独立 PG 库写入标记。 |
| RB-04 | B | 未在同一库以不可变 digest 启动 N−1。 |
| RB-05 | B | N−1 设备/命令/OIDC/RBAC/API/WS/Edge 业务探针未执行。 |
| RB-06 | B | schema、配置、端口、生产目标拒绝注入未执行。 |
| RB-07 | B | 失败/取消清理及清理后证明签发顺序仅有文本契约，未实演。 |
| RB-08 | B | 无单调时钟的业务验证完成计时；应用 RTO 未知。 |
| RB-09 | B | 无 N/N−1/N−2 证据完整性和 180 天可取回性读回。 |
| RB-10 | B | 无新版 Android 客户端连 N−1 或重新打包签名/versionCode 实测。 |
| REC-01 | B | 无真实清理后的独立源库及可核对的 base backup/WAL 链。 |
| REC-02 | B | 未运行物理 PITR；RPO/RTO 未知。 |
| REC-03 | B | 未核对恢复后 Flyway、业务 ID、权限和读写。 |
| REC-04 | B | 未注入断 WAL、错目标、篡改备份的隔离拒绝。 |

### REG / REL

| 用例 | 状态 | 本次依据或剩余缺口 |
| --- | --- | --- |
| REG-01 | B | 无完整运行态的四角色、跨站点 401/403 实测。 |
| REG-02 | B | 无双站点乱序响应、WS 重连与前后台恢复端到端记录。 |
| REG-03 | B | Edge 时钟偏差/在线局部通过；缺断连、多连接、命令重试矩阵。 |
| REG-04 | B | 无天气失败/缓存/位置变化/刷新节流与时间变更的完整运行态证据。 |
| REG-05 | F | Web 构建通过、Android Gradle 编译成功，但 CI 的 APK 路径校验退出 1，产物与时间字段合同未完成。 |
| REG-06 | F | 静态 Compose/Caddy 通过；P0 实栈在构建阶段被 Runner 中止，HTTPS/WSS、OIDC、PG、Backend 健康与指标均未验收。 |
| REL-01 | B | 发布工作流文本契约通过；tag/手工/Quick CI 的真实调用及篡改矩阵未运行。 |
| REL-02 | B | 无同一 release ID 的签名候选/拓扑/服务目录/digest 全链读回。 |
| REL-03 | B | 本次源码安全门禁失败，且无全量生产镜像、VEX、SBOM、provenance 读回及负例注入。 |
| REL-04 | F | P0 Runtime 0 次完整成功，要求连续 2 次；12 服务不可变运行态未执行。 |
| REL-05 | B | 无实际 HTTPS/WSS/OIDC/RBAC/数据库与备份恢复探针。 |
| REL-06 | B | 见证 Quick Gate 因前置失败而拒绝，但缺全部缺工件、错摘要、143 等注入矩阵。 |
| REL-07 | B | 无 Release Gate 签名长期 OCI 证据及 N/N−1/N−2 读回。 |

合计：TIME `1 P/11 B`，MIG `6 B`，RET `14 B`，RB `10 B`，REC `4 B`，REG `2 F/4 B`，REL `1 F/6 B`；即 **1 P、3 F、55 B、0 SKIPPED**。本地 Maven 中的 2 个 `skipped` 属于套件内部统计，不表示 59 个编号用例中有 2 个正式 SKIPPED；相应正式用例仍是 BLOCKED。

## 3. 当前门禁与最小闭环顺序

| 阶段 | 判定 | 主要缺口 |
| --- | --- | --- |
| S0 候选/环境 | BLOCKED | 缺 N/N−1/N−2 签名 digest、受保护回滚 Runner、隔离 PITR 目标和实测容量输入。GitHub 当前 `release-gate.yml` 无运行记录，自托管 Runner 列表为 0。 |
| S1 Quick CI | FAIL | Gitleaks 命中 Secret 文件名清单；安全工件未生成；Android APK 校验路径错误；`quick-gate` 正确阻断。 |
| S2 时间/迁移 | BLOCKED | 双时区/PG 新库局部通过；旧数据对账、精确边界和 N−1 同库兼容未完成。 |
| S3 保留 | BLOCKED | PG 局部集成通过；两次调度 dry-run、全类别 ID 对账、竞态/故障注入、真实容量与实际清理均未完成。 |
| S4 回滚 | BLOCKED | 缺两份 `KNOWN_GOOD` 签名 digest 和受保护 Runner；不能用模拟或本地重建替代。 |
| S5 恢复 | BLOCKED | 无清理后独立物理 PITR；RPO ≤15 分钟/RTO ≤60 分钟均未测。 |
| S6 关联回归 | FAIL | Android 产物校验、P0 实栈和 60 分钟基线/清理对照缺证据。 |
| S7 Gate 2 | BLOCKED | 不满足同 SHA Quick CI、P0 Runtime 连续两次、Image Security、Release Gate、59 用例和签署条件。 |

最小顺序：先精确处理 Gitleaks 的文件名误报及 APK 路径，使新 SHA Quick CI 全绿；再定位 `alertmanager` UI 构建停滞/Runner 中止并完成连续两次 P0 Runtime；准备受保护 Runner、真实 N/N−1/N−2 证据与隔离 PG/PITR；最后按 59 项重新运行边界、两次 dry-run、实际清理、N→N−1、清理后恢复和负载对照。每次修复产生新 SHA，必须重新关联同一候选的门禁证据，不得把本报告的局部绿色直接移作新候选放行结论。

本轮仅测试和记录，没有修改业务代码、CI 工作流或 GitHub 仓库。工作区其他未提交文件属于既有/并行编辑，未作为本报告候选代码证据。
