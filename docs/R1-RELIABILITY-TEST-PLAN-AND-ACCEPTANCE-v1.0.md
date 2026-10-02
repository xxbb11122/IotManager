# IotManager R1 可靠性专项测试方案与执行标准

| 项目 | 内容 |
| --- | --- |
| 版本与日期 | v1.0，2026-09-24 |
| 文档状态 | 待执行测试方案；不是测试报告或 Gate 签发意见 |
| 基线提交 | `609c9f07f341e414cbfe665ea2093a7f8f1591f1`；正式测试开始时重新冻结准确 SHA |
| 工作包 | `P0-TIME-01` 时钟权威、`P0-ROLLBACK-01` N→N−1 回滚、`P1-RETENTION-01` 数据保留 |
| 主责 | 测试负责人统筹；Backend/Edge、DBA、DevOps、安全负责人按证据项共同签署 |

## 1. 目的、范围和审批边界

本文件是上述三个工作包的一份独立、可执行的测试清单。它同时覆盖时间变更可能影响的设备在线、遥测、命令、凭据、天气、限流、权限、客户端以及数据库和发布链。每条高风险规则应具有正常、边界、拒绝/故障三类用例；单元测试、静态检查、模拟、真实 PostgreSQL、完整回滚和物理恢复证据不可互相冒充。

发生规则冲突时，沿用仓库既定优先级：`PROJECT-APPROVAL-REVIEW.md` 的 Gate 边界优先，其次是整改基线和 `R1-RELIABILITY-ADDENDUM-TIME-ROLLBACK-RETENTION-v1.1.md`，本文件只规定如何验证，不扩大 R1 产品范围。

- **Gate 2**：本文件三个工作包和同一候选的 Quick CI、P0 Runtime、Image Security、Release Gate、真实恢复证据与签署记录均满足后，才可申请实现/发布准备度复核。
- **Gate 3**：另需真实 nRF52840/Shelly、真机 GPS/BLE/网络切换与覆盖安装、两个真实站点三端隔离、天气与生产域名/证书、签名 Release APK 等证据。天气备用源仅在供应商合同、配额、隐私审查与 Provider 契约测试通过后纳入验收；未获批准时按主源故障与缓存降级验收。模拟不能代替真实环境证据。
- **Gate 4 / R2**：1000 台设备、每台 30 秒一条遥测、100 个并发 WebSocket、24 小时稳定性、Redis/mTLS 等继续按已审批 R2 范围验收；不作为本次 R1 三工作包的隐含放行条件。
- 单次 Quick CI 全绿、单次 retention dry-run 或一次模拟回滚均不能表述为“生产就绪”。

## 2. 准入条件和测试环境

| 编号 | 环境/材料 | 准入要求 | 责任角色 |
| --- | --- | --- | --- |
| ENV-01 | 冻结候选 | 记录 Git SHA、依赖锁文件、迁移清单、配置快照和工作流版本；同一报告不得混用不同候选的证据 | 测试/DevOps |
| ENV-02 | Quick CI | Linux JDK 17 Backend/Edge 与 PostgreSQL Testcontainers；`TZ=UTC` 和 `TZ=Asia/Shanghai` 双矩阵；Node 22 Web；JDK 21/API 36 Android debug；Compose/Caddy/源码安全任务 | 开发/测试 |
| ENV-03 | 数据库 | 独立的 H2 全新库、PostgreSQL 全新库、带 V20 之前历史数据的 PostgreSQL 升级库；测试数据与真实生产数据隔离 | DBA |
| ENV-04 | 回滚 | 受保护的 `r1-rollback-drill` environment、`[self-hosted, linux, iot-manager-recovery]` Runner、独立 Compose project/卷/密钥、可取回的 N 与 N−1 `KNOWN_GOOD` 证据 OCI digest | DevOps/安全 |
| ENV-05 | 候选保留 | 核对 N/N−1/N−2 镜像 digest、SBOM、provenance、扫描、manifest、签名和 Gate 证据成组保留；被替代后至少 180 天，Actions 的 90 天副本不能充当长期保留 | DevOps/安全 |
| ENV-06 | 恢复 | 受保护的恢复 Runner、单独的目标数据库与卷、已验证的 base backup 和连续 WAL 链、批准的源 Compose project；测试前记录恢复点 | DBA/DevOps |
| ENV-07 | 身份与站点 | 至少两个站点 A/B；OWNER、ADMIN、OPERATOR、VIEWER 及无权限账号；含过期和撤销令牌 | 安全/测试 |
| ENV-08 | 测试数据 | 预先保存每条数据的稳定 ID、站点、状态、权威时间和预期去向；测试前后均导出计数与 ID 集合 | 测试/DBA |

正式回滚只使用受保护环境的经批准候选。缺少 N 或 N−1 的真实 digest/签名证据时，标记为“环境前置未满足”，不得用标签、本地重建或虚构 manifest 替代。

### 2.1 固定数据设计

以固定 UTC 时刻 `T0` 作为可复现基准。时间边界分别准备 `cutoff−1ms`、`cutoff`、`cutoff+1ms`；Edge `sentAt` 准备缺失、偏差恰好 30 秒、超出 30 秒 1ms、`T0+8h`、`T0−8h`、网络乱序和连续三次超限。遥测至少包含同一分钟的重复事件、事件时间与接收顺序相反的事件、可证明 UTC 来源的旧行和来源不明的旧行。

各类别数据包含：90/365 天遥测、730 天审计/命令、已解决与未解决告警、终态与非终态命令、当前与历史天气快照、过期预报、供应商访问审计、当前有效与历史凭据轮换；再分别添加站点、设备、命令、类别、全局 hold。固定数据集中的每个预期保留/归档/删除 ID 必须事先列入断言清单。

## 3. 执行顺序与阶段门禁

| 阶段 | 执行动作 | 进入下一阶段的条件 | 主证据 |
| --- | --- | --- | --- |
| S0 预检查 | 冻结候选、检查迁移与旧版兼容、验证备份/WAL 和 N/N−1/N−2 制品 | 无缺失前置；第 9 节已知阻断项解决 | 候选清单、制品读回、备份验证记录 |
| S1 快速回归 | Quick CI 双时区、Backend/Edge/Web/Android/静态部署/安全；工作流契约负例 | 同一 SHA 的所有必需任务成功，失败/错误/关键跳过均为 0 | Surefire/前端/Android/CI 工件 |
| S2 时间与迁移 | 第 4、5 节；先固定时钟再测试历史数据与 N−1 兼容 | 所有 P0 场景通过，无未经解释的旧时间修正 | 时间断言、迁移与对账报告 |
| S3 数据保留 | 先两次调度 dry-run，再在隔离库执行归档/删除/故障注入 | ID 级对账一致、受保护数据零误删 | `retention_job_runs`、水位、审计和数据库差异 |
| S4 回滚 | 第 7 节完整 N→N−1 和 fail-closed 负例 | 完整演练至少一次通过、应用 RTO ≤60 分钟、失败场景确实阻断 | 签名回滚证明、Playwright/Compose/计时记录 |
| S5 物理恢复 | 保留实际清理后重新运行隔离 WAL/PITR | RPO ≤15 分钟、RTO ≤60 分钟、业务读写与迁移版本正确 | 恢复报告、WAL/备份链、业务探针 |
| S6 容量/关联回归 | 固定负载对比、两站点与客户端关键旅程 | 第 8 节预算与回归通过 | 指标、负载曲线、客户端报告 |
| S7 Gate 2 审阅 | 测试/DBA/DevOps/安全按第 10 节核对证据 | 无开放 P0/P1、签字与限制清单齐全 | 测试总结与 Gate 证据索引 |

Quick CI 推荐以 `.github/workflows/ci.yml` 为标准入口。其 Java job 使用 `bash scripts/verify.sh --strict --skip-web --skip-deploy`，工作流契约还应执行 `node scripts/ci/tests/release-tools.test.mjs` 与 `node scripts/ci/tests/release-workflows.test.mjs`。文件存在、脚本被调用和测试真正通过是三个不同状态，应分别记录。

## 4. `P0-TIME-01` 时间权威测试

| 用例 | 步骤/注入 | 精确预期 | 层级与证据 |
| --- | --- | --- | --- |
| TIME-01 | 使用固定 `Clock` 测 TTL、在线判断、天气新鲜度、命令及批次到期、凭据到期、限流、保留截止点的前/等于/后边界 | 业务判定只使用服务端权威 `receivedAt`；边界没有 1ms 错误 | Backend 单元/集成断言 |
| TIME-02 | 在 UTC、Asia/Shanghai 两个进程环境运行完全相同的数据与断言 | 数据判定、查询结果、分钟桶和生成的 UTC 时间一致；显示时区变化不改变业务值 | CI 两份可比测试摘要 |
| TIME-03 | Agent 发送缺失 `sentAt`、≤30 秒、>30 秒及 ±8 小时的自报时间；服务端持续接收有效心跳 | `UNKNOWN/TRUSTED/SKEWED` 正确；偏差不会使仍有有效心跳的连接离线；单向网络延迟仅作为诊断估计 | Edge/Backend WS 集成记录 |
| TIME-04 | 连续三次偏差超限，随后恢复正常，再次超限 | 站点范围的时钟诊断告警按规则产生；无告警风暴；恢复与再触发行为符合既有告警状态模型 | 告警行、指标与事件日志 |
| TIME-05 | 让 `observedAt` 与接收顺序相反，跨分钟边界插入同设备样本 | 最新值、最近一小时、分钟桶按 `receivedAt`/`bucket_start_utc` 处理；无漏查、重复桶或旧设备时间覆盖新值 | 查询 ID 顺序与桶键 |
| TIME-06 | 查询含 `Z`、`+08:00`、旧无偏移时间、无效格式及 `from > to` 的遥测范围 | 合法输入归一到相同 UTC 区间；旧无偏移格式按明确兼容语义处理；无效输入返回受控 4xx | HTTP 合同测试 |
| TIME-07 | 调用 `/api/v1/time` 与旧 `/api/time`；测试授权、限流和请求 ID | UTC ISO 时间、`zone=UTC`、容差和请求 ID 正确；不暴露主机/部署信息；客户端估算偏差不能改变服务端权限与过期判定 | HTTP 响应与安全日志 |
| TIME-08 | 运行旧时间对账：可证明来源与不可证明来源混合；重复运行 | 未知来源标 `LEGACY_UNKNOWN` 且不统一加减 8 小时；总数、已确认数、未知数、异常跨度和样本 ID 可复核；重复执行不篡改未知行 | 受控只读对账报告 |
| TIME-09 | 检查旧 `LocalDateTime` 列双写、`IOT_TIME_LEGACY_ZONE` 与 N−1 实际 `TZ` 的组合 | N 与 N−1 对旧服务端写入时间的解释一致；不匹配配置被发现并阻断回滚验收 | 双版本命令过期实测 |
| TIME-10 | 扫描判定路径新增的直接系统取时钟调用 | 关键 `service/weather/config` 代码不能绕过注入时钟；允许清单经评审 | `TimeAuthorityStaticRuleTest` |
| TIME-11 | 用不同 IANA 显示时区（含有夏令时变化的时区）渲染同一 `Instant`；输入非法 `legacy-zone` | 只有展示发生变化，存储、TTL 和保留截止点不变；非法 IANA 区域拒绝配置 | API/Client 与配置测试 |
| TIME-12 | 检查 REST、WebSocket 与审计日志中的新旧时间字段，包括序列化、请求相关 ID 和旧 `sampledAt` | UTC 带偏移时间可还原为同一瞬间；旧字段在兼容窗口存在；日志不以部署机器墙钟替代权威时间 | 合同与日志样本 |

重点回归：Agent/设备在线、命令到期与确认、天气缓存/重试、凭据轮换、限流、审计事件和 WebSocket 时间字段。`observedAt` 的可信度与连接在线状态必须分开验收。

## 5. 迁移与 N−1 数据兼容测试

| 用例 | 步骤/注入 | 精确预期 |
| --- | --- | --- |
| MIG-01 | 分别从空 H2、空 PostgreSQL 运行完整 Flyway；再从带旧数据的受保护副本升级 | 公共迁移与各 profile 专用迁移组合合法；V20–V25 成功；历史版本不重编号；旧数据可读 |
| MIG-02 | 对比 H2/PostgreSQL 新表、列、唯一键、索引和约束，特别是两个 profile 的 V24 | 与语义要求等价；差异有显式批准记录，不能只凭 Flyway 返回成功判定等价 |
| MIG-03 | N 对扩展后 schema 写入设备/遥测/命令；在**同一隔离数据库**启动 N−1 读写 | 旧字段保留且兼容；N−1 可读取标记并执行允许写入；不使用 Flyway 降级或 `pg_restore --clean` 伪装应用回滚 |
| MIG-04 | 新旧版本交错写入，随后由 N 再读旧版写入 | 无 `NOT NULL`/唯一键/时间解析冲突；客户端 `/api/v1` 与至少一个 Edge/WS 协议兼容窗口仍可用 |
| MIG-05 | 构造缺列、破坏性 DROP、无默认值的强制非空迁移样本 | 迁移静态检查与真实 N−1 冒烟至少有一层明确拒绝；拒绝记录标明是应用回滚不可行还是可前向修复 |
| MIG-06 | 迁移中断并重试；检查 Flyway history 与关键数据 ID | 不重复写入或破坏旧字段；失败保持可诊断，不在不确定 schema 上继续发布 |

## 6. `P1-RETENTION-01` 数据保留与归档测试

### 6.1 各类数据的期限和保护条件

| 类别 | 边界测试 | 必须保留的特殊数据 |
| --- | --- | --- |
| 遥测热表 | `received_at < T0−90d` 才进入归档；恰好等于边界的行保留 | 无权威 `received_at` 的 legacy 行、命中 hold 的行 |
| 遥测归档 | 总期限 365 天；超过 365 天的热表积压也须先复制、校验，再按策略清理 | 归档校验不完整或摘要不一致时的热表原行 |
| 审计/活动/天气供应商访问事件 | 730 天及前/等于/后 1ms | 命中有效 hold 的事件 |
| 命令及命令事件 | 730 天及终态判断 | 非终态命令、关联 hold 的命令与事件 |
| 告警 | 已解决后 365 天 | 未解决告警与 hold |
| 天气快照/预报 | 快照 90 天、预报 30 天 | 每站点当前有效快照与 hold；历史配置不能造成无限保留 |
| 凭据轮换 | 730 天 | 当前有效凭据、未结束轮换和 hold |

固定 90/365/730 天保留基线不得由普通运行时参数缩短。其他类别的建议期限须在实际删除前由数据所有者与安全角色记录确认。

| 用例 | 步骤/注入 | 精确预期 |
| --- | --- | --- |
| RET-01 | 检查默认 `enabled=false`、`dry-run=true`；输入批次 0/5001、过短期限、非法锁租期/批次超时 | 默认零实际删除；非法配置在启动/绑定阶段拒绝；单批只允许 1–5000 行 |
| RET-02 | 用相同冻结数据运行至少两个调度周期的 dry-run；比对处理 ID 与数据库前后指纹 | `retention_job_runs` 记录预测数、hold、水位、持续时间；热表/归档表及其他业务行零变更；两次报告可复核 |
| RET-03 | 在隔离库切换执行模式；检验 90/365/730 天及各类别边界 | 仅预先列出的合格 ID 被归档/删除；冻结数据的预测数、实际数和 ID 集合完全一致，不接受未解释差异 |
| RET-04 | 把同一遥测批次运行两次，并预置相同 `source_sample_id` 的归档行 | 可重放、无重复；逐项核对 device、时间、可信度、来源、payload 和 SHA-256 指纹后才能删热表 |
| RET-05 | 使归档缺行、字段变更或摘要错误；模拟复制后删除前的异常 | 当前批事务失败，热表原行仍在，失败原因有记录，watermark 不错误推进 |
| RET-06 | 插入已经超过 365 天但仍在热表的积压数据 | 先复制并验证，再按总保留期清理；不因错过 90–365 天窗口而永久积压或直接跳过核验 |
| RET-07 | 逐一创建站点、设备、命令、数据类别、全局 hold；测试过期、解除、重复解除、无效类别和无权限角色 | 有效 hold 阻止匹配行删除；解除后下次完整扫描重新评估；不支持的类别拒绝；创建/解除有不可变、含操作者的审计事件 |
| RET-08 | 在清理批次与 hold 创建之间制造并发，覆盖“hold 先取得 guard”和“批次先取得 guard”两种顺序 | 同一 guard 行提供可解释的序列化顺序；任何已提交且应生效的 hold 不被陈旧快照绕过 |
| RET-09 | 双 Backend 实例同时触发、租期续期与失效、单批超时、进程突然退出后重启 | 同一时刻只有一个持锁执行者；失败批不推进水位；续跑不漏、不重；到达批次数上限后下次继续 |
| RET-10 | 执行历史归档 API：31 天范围两侧、limit 1/500/501、游标翻页、跨站点、未登录及每分钟第 5/6 次请求 | 分页稳定无重复/遗漏；非法范围或 limit 为 4xx；无权返回 401/403；第 6 次按每主体 5 次/分钟预算限流 |
| RET-11 | 检查每类 `retention_job_runs`、hold 事件、相关 Prometheus 指标与结构化日志 | 策略版本、类别、时间窗、预计/归档/删除/跳过/失败/hold 数、开始结束时间、watermark、关联 ID 可追溯；证据不暴露密钥 |
| RET-12 | 用经测量的设备量、行大小、索引膨胀、WAL 与备份数据运行容量模型 | 产出 30/90/365/730 天体积、备份与恢复预算；示例输入不能冒充生产测量；预测 RTO 超标则不得开启实际清理 |
| RET-13 | 检查关闭调度、默认 `02:30 UTC` 触发、主机时区变化、多实例调度与一次运行结束后再次扫描 | 关闭时不执行；启用时按 UTC 计划运行且不重复并发；完整通过后清除 watermark，使解除 hold 的行下次可重新评估 |
| RET-14 | 检查表体积、最旧权威记录年龄、归档/删除/hold/失败计数与时长指标；在 H2 与 PostgreSQL 比较不可用值语义 | PostgreSQL 包含表、索引及 TOAST；无权威时间或不可测量时明确标记不可用，不冒充零；dry-run 阶段已有容量基线 |

正式开启 `dry-run=false` 前，按 `DATA-RETENTION-RUNBOOK.md` 验证新鲜备份与 WAL 链，审阅两次 dry-run、hold 测试、锁等待、连接池、API 延迟和容量报告，并记录变更批准。真实测量和包含生产标识的对账报告只存受限证据位置，不提交仓库。

## 7. `P0-ROLLBACK-01` 回滚与失败注入

| 用例 | 步骤/注入 | 精确预期 |
| --- | --- | --- |
| RB-01 | 从 Release Gate 签发的 OCI digest 拉取 N 与 N−1 的完整证据包；校验 manifest、SHA、签名者工作流、校验和、Gate PASS、schema/API/protocol 版本 | 均为真实且不同的 `KNOWN_GOOD` 候选；证据与镜像按 digest 绑定；不信任可变 tag |
| RB-02 | 预拉取全部 N−1 镜像；模拟缺失 digest、损坏下载、篡改 manifest/签名和错误来源 SHA | 缺一项即显式失败；不重新构建、拉取 helper tag 或忽略验证 |
| RB-03 | 在独立项目部署 N，完成 Expand 迁移，登录并写入可识别的设备、命令、遥测标记 | N 写入数据和启动时 schema 版本被记录；记录切换决策时间点 |
| RB-04 | 停 N 且保留隔离数据库，使用 `--mode immutable --pull never --no-build` 启动 N−1 | N−1 使用预拉取 digest；不降级 Flyway、不清理数据库；所有镜像身份与 manifest 相符 |
| RB-05 | 在 N−1 验证 N 的标记、设备和命令读写、旧墙钟命令截止、OIDC 登录、四角色 RBAC、API v1、浏览器 WS、Edge WS | 核心探针全过，升级客户端仍兼容 `/api/v1`；无跨站点读取、越权或丢数据 |
| RB-06 | 在 N−1 schema 不兼容、配置不一致、80/443 已占用或目标疑似生产项目时启动 | 演练立即拒绝/失败；不强行启动 N−1 或改写生产目标；错误具有原因与证据 |
| RB-07 | 注入中途失败/取消与正常结束两条路径，检查卷、容器、临时 GHCR 凭据、证书信任和证明签发顺序 | 隔离资源清理可验证；清理成功前不得签成功证明；失败必须保留脱敏诊断，不得将 Runner `143` 当成功 |
| RB-08 | 用单调时钟记录回滚开始、服务可用、业务验证完成 | 应用 RTO 按**完成业务验证**计量，≤60 分钟；仅容器变 healthy 不等于完成 |
| RB-09 | 核查 N/N−1/N−2 证据包及所有镜像在注册表中可读，检查 180 天清理排除规则 | 三个已知良好候选及其完整证据成组保留；缺 N−1 或 N−2 的风险必须阻断正式回滚能力签发 |
| RB-10 | 用已升级 Android 客户端连接 N−1 Backend；评估需要客户端回退时的打包规则 | 新客户端仍能使用现有 API/协议；若需重新打包旧代码，必须保持签名且使用更高 `versionCode`，不以安装低版本 APK 作为回滚方案 |

`.github/workflows/rollback-drill.yml` 的文本契约测试仅证明配置存在；只有受保护 Runner 上真实镜像、Keycloak、PostgreSQL、Caddy、Backend 和 Playwright 探针完成，才算 RB-01～RB-08 通过。成功证据应在隔离资源清理后签名并按长期 OCI digest 保存。

## 8. 恢复、性能、关联回归和安全

### 8.1 保留生效后的物理恢复

| 用例 | 操作 | 通过标准 |
| --- | --- | --- |
| REC-01 | 在执行过真实归档/清理的隔离源库检查 base backup、连续 WAL 与目标恢复点 | PITR 目标在可用 WAL 窗口内；源与目标项目/卷分开；不会覆盖源数据 |
| REC-02 | 使用受保护 `recovery-drill.yml` 执行物理恢复并测量 | RPO ≤15 分钟、RTO ≤60 分钟；包括恢复后服务验证，不只计算 PostgreSQL 启动 |
| REC-03 | 核对 Flyway 版本、关键设备/命令/归档记录、权限与写入探针 | 实际版本与候选/源库证据一致；业务数据和读写能力正确；输出恢复报告 |
| REC-04 | 故意断开 WAL 链、提供错误目标项目或篡改备份证据 | 明确失败；目标隔离不被放宽；缺失证据不得用逻辑恢复冒充物理 PITR |

### 8.2 负载与容量执行标准

在固定的预生产代表性流量下，采集至少 60 分钟无清理基线，再采集至少 60 分钟清理期间数据；记录设备数、分钟桶速率、查询/命令并发、表和索引体积、WAL 速率、备份时长、API P50/P95/P99、数据库锁等待及连接池状态。执行前冻结负载脚本、数据量和基线。

本专项测试采用以下**新增的防退化阈值**，它们不改变 Gate 4 的 1000 设备要求：普通 API P95 相对同负载基线上升不超过 20%，且不超过该环境已批准的更严格 SLO；清理期间新增的业务 5xx 为 0；无死锁、连接池耗尽或无法在配置的单批超时内完成的批次。任何阈值失败必须定位到清理或环境原因，不能以重跑一次“碰绿”结案。若环境尚无受评审的负载/容量输入，则不得签发实际清理的容量结论。

### 8.3 受影响功能与权限回归

| 用例 | 必测旅程 | 通过标准 |
| --- | --- | --- |
| REG-01 | 未登录/过期 JWT、越权站点/设备/命令/归档/hold，OWNER/ADMIN 与只读角色 | 未登录业务 API 为 401，越权为 403；无跨站点数据或事件 |
| REG-02 | 两站点快速切换、A/B 乱序响应、WebSocket 重连和前后台恢复 | 当前 UI/缓存/订阅只展示当前站点；未完成 REST 真值同步前不开放错误的命令操作 |
| REG-03 | Agent 断连、设备多连接、TTL 到期和恢复；命令发送、确认、超时和重试 | 在线状态由服务端接收事实决定；命令幂等，网络抖动不误确认/误重放 |
| REG-04 | 天气成功、上游失败、缓存过期、位置变化、刷新节流和隐私限制 | 时间修复不破坏天气新鲜度；失败显示降级/最后有效快照，不虚构实时值、不产生刷新风暴 |
| REG-05 | 前端、Console、Client 构建及 Android debug APK，重点检查 API 时间字段和旧 `sampledAt` 兼容 | 构建/已有自动化全过；旧字段保留一个兼容窗口，新字段序列化和显示正确 |
| REG-06 | Caddy HTTPS/WSS、Keycloak OIDC、PostgreSQL、Backend 的 Compose 健康和指标/告警 | 同一候选运行态可诊断，证书、授权、结构化日志与基础观测均正常 |

以上回归属于三个工作包的波及面。Gate 3 仍需在真实手机、真实设备和两个真实站点另行完成相应证据。

### 8.4 发布完整性与运行态门禁回归

| 用例 | 必测动作 | 通过标准 |
| --- | --- | --- |
| REL-01 | 从 tag、受控手工触发、普通 Quick CI 分别经过发布调用链；篡改事件/调用链字段 | 只有可信 Release Gate 获得发布模式；普通 CI 不能伪装发布；字段篡改使最终 Gate 失败 |
| REL-02 | 核对同一候选 SHA 的 release candidate、拓扑、服务目录、镜像 digest 与工作流来源 | 身份和校验和一一对应；候选被替换或阶段来自其他 SHA/运行时拒绝 |
| REL-03 | 对全部生产镜像逐一关联 digest、CycloneDX SBOM、provenance、扫描报告及有效 VEX；注入缺项、错配和过期 VEX | 缺证据、HIGH/CRITICAL 未获有效处置、过期/错配 VEX 均阻断 Image Security/Release Gate |
| REL-04 | 对正常与恢复拓扑运行 Compose/Caddy 配置校验及不可变镜像启动 | P0 Runtime 两次连续完整通过；12 个运行态服务和恢复补充服务的证据与预期 digest、健康/一次性任务状态一致 |
| REL-05 | 在运行态完成 HTTPS/WSS、Keycloak OIDC、四角色 RBAC、PostgreSQL/Backend 健康、备份与恢复探针 | 所有核心探针成功；401/403、请求/追踪 ID、结构化日志和基础指标/告警有可核对证据 |
| REL-06 | 注入缺工件、镜像摘要不符、服务未就绪、扫描失败、工作流超时与 Runner 143 | 对应阶段和最终 Gate 均失败，留下诊断；不得跳过、改用本地镜像或反复重跑到一次绿色 |
| REL-07 | 验证发布证据包签名、长期 GHCR OCI 归档和按不可变 digest 读回 | 签名与主体正确，校验和读回一致；90 天 Actions 工件仅作诊断副本，长期保留覆盖 N/N−1/N−2 及 180 天规则 |

## 9. 当前已知缺口与执行前修正

| 编号 | 当前证据 | 对验收的影响 | 处置要求 |
| --- | --- | --- | --- |
| GAP-01 | `.github/workflows/recovery-drill.yml` 两处 `IOT_EXPECTED_FLYWAY_VERSION: "18"`，`scripts/runtime/recovery-drill.sh` 默认也为 `18`；本候选迁移已到 V25 | 新候选可能误报恢复失败或验证错误 schema | 从获批准候选/源库证据确定预期版本并核对；修复及复测后再运行 REC-02/03。不能仅把常量随手改成 25 以掩盖版本来源问题 |
| GAP-02 | `RetentionServiceIntegrationTest` 现有场景主要基于迁移后的 H2 | 无法证明 PostgreSQL 的锁、事务、时间类型和批次行为 | 补 PostgreSQL Testcontainers 的保留边界、竞态、中断和幂等集成测试 |
| GAP-03 | 现有时间静态规则、Edge 偏差与保留测试只覆盖部分矩阵 | 精确 1ms 边界、所有保留类别/hold 范围、各判定服务仍可能漏测 | 按 TIME/MIG/RET 表逐项补自动化，保证失败路径可重复 |
| GAP-04 | `rollback-data-compatibility.spec.js` 和工作流已编写，但仅有文本/本地测试不能证明真实回滚 | 缺受保护环境的 N/N−1 镜像、认证、数据库兼容与 RTO 证据 | 获取两个 `KNOWN_GOOD` 候选并完整运行 RB-01～RB-10 |
| GAP-05 | 当前 Maven 构建未配置 JaCoCo 报告门禁 | 不能宣称已达到整体/核心代码覆盖率百分比 | 补工具后再统计；优先保证本计划高风险需求正例、反例、边界和故障注入均有可执行用例 |
| GAP-06 | 保留策略实际清理后的完整 PITR 与容量测量尚无本候选证据 | dry-run 和模型不能证明 RPO/RTO | 完成 REC-01～REC-04 与第 8.2 节实测 |
| GAP-07 | Quick CI 与 Release Gate 工作流存在，但本候选尚未按 REL-01～REL-07 汇总同一 SHA 的完整证据 | 容易把局部绿色任务误认作整体可发布 | 汇总全部实际运行 ID、状态、签名、digest 和失败诊断，缺项不得签发 Gate 2 |

以上是**待处理/待执行**清单，不表示已经运行并发现所有用例失败。每项关闭时须链接修复提交、测试运行和证据工件。

## 10. 测试记录、缺陷处理与签发规则

### 10.1 每条用例的记录模板

| 字段 | 必填内容 |
| --- | --- |
| 用例与需求 | 用例 ID、工作包、风险等级、执行者、复核者 |
| 候选身份 | Git SHA、release ID、镜像 digest、Flyway 版本、配置/工作流版本 |
| 环境和数据 | 数据库种类、`TZ`、站点/角色、测试数据清单与快照、备份/WAL 标识 |
| 执行与结果 | 步骤、预期、实际、开始/结束时间、PASS/FAIL/BLOCKED/SKIPPED |
| 可复核证据 | CI/工作流 URL、Surefire/Playwright、HTTP 记录、数据库 ID/计数/摘要、日志/指标、RPO/RTO 原始计时、工件校验和 |
| 缺陷闭环 | 缺陷 ID、根因、修复 SHA、受影响用例重测和相关回归结果 |

真实生产标识、凭据、令牌和原始隐私数据不得写入公共 Actions 工件或仓库；原始对账/容量数据放在受控证据存储，公开证据仅留校验和与脱敏摘要。

### 10.2 PASS、阻断与复测

1. 每项 P0/P1 需求至少映射正常、边界和拒绝/失败用例；本文件 59 个编号用例逐一登记，全部必需用例有真实执行结果。`SKIPPED`、未部署环境或仅静态检查，不计为通过。代码覆盖率只能辅助判断：若接入 JaCoCo，按既有改进方案复核核心服务行覆盖率 ≥80%、整体行覆盖率 ≥70%、核心分支覆盖率 ≥65%；当前未配置该报告，不能声称已经达标。
2. 同一候选 SHA 的 Quick CI、P0 Runtime、Image Security、Release Gate 全绿；P0 Runtime 按可靠性方案要求连续两次完整通过。证据必须关联相同候选、release ID 和 digest。
3. 时间与迁移、两次 dry-run、实际归档/清理、真实 N→N−1、清理后 PITR 均满足上文的 ID 级断言、RPO/RTO 和 fail-closed 条件。
4. 数据丢失/误删、越权、候选身份不可信、回滚不可行、无法恢复、RPO/RTO 超标均视为 P0 阻断；核心功能或边界错误视为 P1 阻断。P0/P1 开放缺陷数必须为 0；P2 只能在影响、规避方式、责任人和后续计划明确后列为已知限制。
5. 测试偶发失败须查明环境或代码根因。修复后重跑失败用例、同模块回归和同一候选的相关 Gate；不得只重跑到一次绿色就关闭缺陷。Runner 143、超时、缺工件均为未通过，按证据分类。
6. 测试负责人汇总报告，Backend/DBA/DevOps/安全复核各自证据，按 `PROJECT-APPROVAL-REVIEW.md` 重新申请 Gate 2。Gate 2 通过不代表 Gate 3 已签发。

### 10.3 最终报告必须回答的问题

- 同一 SHA 的哪些自动化和运行态任务通过，哪些仍处于 BLOCKED/SKIPPED？
- 90/365/730 天边界各有多少行保留、归档、删除、被 hold 阻止？ID 集合是否一致？
- `LEGACY_UNKNOWN` 行有多少，来源可证明的比例、处理/保留决策是什么？
- N/N−1/N−2 制品能否按 digest 取回？N→N−1 的业务验证完成时间是多少？
- 实际清理后物理恢复的 RPO/RTO、Flyway 版本和业务读写结果是什么？
- 负载、锁等待、连接池、备份/WAL 速率对比如何？有无开放 P0/P1？
- Gate 2 与 Gate 3 各自还缺什么真实证据？

## 11. 对应仓库证据入口

- 设计和批准边界：`docs/PROJECT-APPROVAL-REVIEW.md`、`docs/R1-RELIABILITY-ADDENDUM-TIME-ROLLBACK-RETENTION-v1.1.md`、`docs/R1-RELIABILITY-AND-RELEASE-CLOSURE-PLAN.md`。
- 执行手册：`docs/DATA-RETENTION-RUNBOOK.md`、`docs/CI-RELEASE-RUNBOOK.md`、`docs/REGISTRY-RETENTION.md`。
- CI/演练：`.github/workflows/ci.yml`、`.github/workflows/rollback-drill.yml`、`.github/workflows/recovery-drill.yml`、`.github/workflows/release-gate.yml`。
- 现有测试起点：`TimeAuthorityStaticRuleTest`、`EdgeAgentWebSocketIntegrationTest`、`RetentionServiceIntegrationTest`、`RetentionTaskLockServiceIntegrationTest`、`DevicePlatformMigrationCompatibilityTest`、`client/e2e/rollback-data-compatibility.spec.js`、`scripts/ci/tests/release-workflows.test.mjs`。
- 容量与旧时间对账：`scripts/db/retention-capacity-model.mjs`、`docs/retention-capacity-input.example.json`、`scripts/db/legacy-time-reconciliation.sql`。

本文件仅建立执行标准与证据目录；所有测试、缺陷关闭和 Gate 签发状态以实际运行记录为准。

## 12. 工作包与用例追踪表

审核者须逐行核对本表。任何要求没有对应执行结果和证据链接时，状态为 BLOCKED，而不是默认 PASS。

| 已批准要求/风险 | 必需用例 | 主要证据 | 签发角色 |
| --- | --- | --- | --- |
| 服务端权威时间与双时区一致 | TIME-01～TIME-02、TIME-05～TIME-12、MIG-01～MIG-04 | 双时区 CI、API/查询断言、schema 与旧数据对账 | Backend/DBA/测试 |
| Edge 偏差诊断不影响在线 | TIME-03～TIME-04、REG-03 | WS 心跳、告警、在线状态和指标 | Edge/Backend/测试 |
| 旧数据不猜时区、N−1 可读写 | TIME-08～TIME-09、MIG-01～MIG-06、RB-03～RB-05 | 只读对账、迁移报告、真实 N−1 读写 | DBA/Backend/DevOps |
| N/N−1/N−2 制品保留及应用回滚 | RB-01～RB-10、REL-01～REL-07 | 不可变 digest、签名/扫描、回滚证明与单调 RTO | DevOps/安全/测试 |
| 90/365/730 天保留和保护条件 | RET-01～RET-14 | 两次 dry-run、ID 级差异、hold 审计、水位、容量指标 | 数据所有者/DBA/测试 |
| 清理后恢复能力 | REC-01～REC-04、REL-04～REL-06 | 物理恢复、WAL 链、RPO/RTO、恢复后业务探针 | DBA/DevOps/测试 |
| 站点隔离、天气、客户端与运行态回归 | REG-01～REG-06、REL-04～REL-05 | API/Playwright/Android、Compose 健康、指标/告警 | 安全/移动端/测试 |
| Gate 2 与 Gate 3 不混淆 | S0～S7 阶段记录、第 10 节签发、Gate 3 真实环境证据 | Gate 审核记录、已知限制、真实设备/手机报告 | 测试负责人/产品/安全 |

## 13. 执行登记与审阅页

本节留给实际测试周期填写。未执行前保持 `PENDING`，不得预填 `PASS`。

| 阶段 | 当前状态 | 运行/报告链接 | 阻断缺陷与说明 | 复核人/日期 |
| --- | --- | --- | --- | --- |
| S0 预检查与候选冻结 | PENDING | 待填 | 待填 | 待填 |
| S1 Quick CI 与发布契约 | PENDING | 待填 | 待填 | 待填 |
| S2 TIME/MIG 时间与迁移 | PENDING | 待填 | 待填 | 待填 |
| S3 RET 数据保留 | PENDING | 待填 | 待填 | 待填 |
| S4 RB 应用回滚 | PENDING | 待填 | 待填 | 待填 |
| S5 REC 物理恢复 | PENDING | 待填 | 待填 | 待填 |
| S6 REG/REL/容量回归 | PENDING | 待填 | 待填 | 待填 |
| S7 Gate 2 证据复核 | PENDING | 待填 | 待填 | 待填 |

| 最终结论字段 | 待填写内容 |
| --- | --- |
| 候选 SHA / release ID / 镜像 digest | 待填 |
| 59 个编号用例 PASS / FAIL / BLOCKED / SKIPPED 数 | 待填 |
| 开放 P0 / P1 / P2 缺陷与批准限制 | 待填 |
| N→N−1 应用 RTO；PITR RPO / RTO | 待填 |
| 数据 ID 对账、legacy 未知行和容量结论 | 待填 |
| 测试负责人、DBA、DevOps、安全、产品签署 | 待填 |
| Gate 2 / Gate 3 状态与下一步 | 待填 |
