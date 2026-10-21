# 剩余发布整改与模拟验收报告

日期：2026-10-21，Asia/Shanghai。本报告承接 2026-10-20 整改报告与[本轮开发、迁移说明](REMAINING-RELEASE-FIXES-DEVELOPMENT-2026-10-20.md)。硬件相关项目遵照用户要求采用模拟；本轮服务、数据库及镜像在隔离 GitHub runner 内执行。

**本轮代码整改与模拟验收通过，八镜像 HIGH/CRITICAL 原始条目由 110 降至 0。正式发布仍为 NO_GO：受保护发布/恢复环境、独立审批及专用恢复 runner 尚未闭环。**

## 1. 已完成的修复

- 后端整体迁移到 Boot 4.0.8 / Framework 7.0.9 / Spring AI 2.0.1，保持 Java 17。同步更新模块化 starter、测试 API、JSON 代码与配置，保留现有 Flyway 文件和外部业务 API。
- 真实 SDK 使用应用配置的模型与接口路径；无额外重试，有连接/请求期限，429、503 和超时只返回脱敏错误。模拟供应商测试覆盖单次请求、超时、凭据/响应体脱敏与非法路径。
- PostgreSQL 16 与 PG16 逻辑备份镜像迁移到 Alpine 3.24 musl，保持 UID/GID 999、pgvector 0.8.6；WAL-G 更新到固定 v3.0.9 源码，遵循上游 JSON v2 构建要求，校验真实 Go 模块版本。
- 只在初始化新集群时写 ABI 标记；已有 glibc、未知 ABI 或错误主版本的数据卷返回 78，不修改其标记或控制文件。新增固定 digest 的实际逻辑迁移演练与限定标签的资源清理。
- 默认分支保护已生效：严格 quick-gate、至少一名 PR 审核人、过期审批作废、最后提交需他人批准、管理员遵守保护、禁止强推/删除并要求解决讨论。

第一次完整镜像扫描从原先 110 条降到 15 条：R04/R07 全部条目消失；剩余来自 Boot 默认的 Tomcat/Jackson 版本和两个 Go 压缩库。补丁候选进一步统一 Tomcat 11.0.27、Jackson 3.1.8 / 2.21.8、compress 1.18.7。SDK 仍需要 Jackson 2，因此两个代际均通过 BOM 管理，不能只修应用的 Jackson 3。

构建中发现并修复了 LLVM 21/22 混用、遗漏上游 GOEXPERIMENT=jsonv2，以及误填未发布 JWT 版本的问题；最终使用官方存在的 JWT v4.5.2。失败运行保留原记录，不计为通过。

## 2. 同源候选与安全扫描

最终补丁候选源码：89b7ddf2900d5d62754f59060e5d837920377d55。

候选 ID：r1-rc-remainingfix-20261021-89b7ddf2900d。

[镜像构建与扫描运行](https://github.com/xxbb11122/IotManager/actions/runs/39549931270)：8/8 PASS，原始 HIGH=0、CRITICAL=0，八次扫描退出码均为 0，全部 VEX 为 NOT_REQUIRED。未用豁免、忽略规则或扫描失败冒充清零。

manifest SHA-256：4a3bfe6b997af06e8abcb32d6d0ea7bb9a5970273fb1cefcbf431a624d4fd0d6。已重新计算下载文件哈希并与八份扫描结果核对。

| 镜像 | HIGH / CRITICAL | 结果 |
| --- | --- | --- |
| R01 Backend | 0 / 0 | PASS |
| R02 Caddy | 0 / 0 | PASS |
| R03 Keycloak | 0 / 0 | PASS |
| R04 PostgreSQL / WAL-G | 0 / 0 | PASS |
| R05 Prometheus | 0 / 0 | PASS |
| R06 Alertmanager | 0 / 0 | PASS |
| R07 逻辑备份 | 0 / 0 | PASS |
| R08 卷初始化 | 0 / 0 | PASS |

原始报告、构建元数据、清单及扫描汇总保存在该运行的 release-evidence-r1-rc-remainingfix-20261021-89b7ddf2900d artifact。此运行是开发侧独立 dispatch，stage 明确 trustedProducer=false，不冒充受保护 release-gate 的正式批准。

首次迁移候选 774226c 的[原始扫描](https://github.com/xxbb11122/IotManager/actions/runs/39548846213)为 5 PASS、3 FAIL，12 HIGH / 3 CRITICAL；其中 PostgreSQL/WAL-G、逻辑备份均为 0。该候选没有被当成安全门禁通过。

## 3. 回归与模拟验收证据

| 项目 | 已确认结果 | 原始证据 |
| --- | --- | --- |
| 后端与 Edge Agent，最终补丁候选 | 两个时区各 201 / 7，失败与跳过均为 0 | [Quick CI](https://github.com/xxbb11122/IotManager/actions/runs/39549874464) |
| Web，最终补丁候选 | 旧客户端 252 单元/54 浏览器；Glass 257/77；Frontend、Console 各 1 浏览器用例，无失败/跳过 | 同一 Quick CI |
| Android 构建 | 两客户端 debug APK 在 CI 构建成功；不等于生产签名或实机通过 | 同一 Quick CI |
| 八类运行边界，最终补丁候选 | 8 场景、10 次执行通过；四角色、内部 HTTPS AI、负载、N→N-1→N | [运行边界](https://github.com/xxbb11122/IotManager/actions/runs/39549867471) |
| 跨 libc 迁移模拟，最终 digest | 300 条 Unicode/JSON/时间/向量数据指纹一致，旧卷拒绝且控制文件不变，索引/写入/重启成功，清理后资源 0 | [迁移演练](https://github.com/xxbb11122/IotManager/actions/runs/39551092679)的 postgres-abi-lab |
| 完整 P0 | 非 root、权限边界、PKCE/JWT/四角色/WSS、数据库故障恢复、逻辑恢复、篡改拒绝、Secret 证据拒绝全部通过 | [P0 Runtime](https://github.com/xxbb11122/IotManager/actions/runs/39549867550) |
| 不可变运行 / 恢复摘要 | 正常服务 12/12，恢复新增 1，并集 13/13；错误 source 与篡改 manifest 拒绝 | [最终模拟验收](https://github.com/xxbb11122/IotManager/actions/runs/39551092679) |
| 清除后 PITR | 64 MiB / 32768 行清除为 0 后，从实际备份/WAL 恢复全部行，指纹一致；拒绝已有恢复目标与损坏备份 | 同一最终模拟验收 |
| WAL-G 加密拒绝 | 修复提交祖先核对、内联 libsodium key 与 key 文件拒绝，3 项通过 | 同一最终模拟验收 |
| 内部告警生命周期 | 6 项通过，外部通知 0，清理成功 | 同一最终模拟验收 |

运行边界的合成负载为 1000 设备、100 WebSocket、100000 条消息；测得指标只适用于该 runner。N→N-1→N 使用两个开发提交和同一测试数据库，Flyway 指纹不变，验证双向读写及时间解释，不能称为正式已批准发布间的回滚。

P0 实际观察 PostgreSQL 不可用时 readiness 为 HTTP 503；数据库恢复健康，Backend 在依赖未就绪时持续运行并重试，定时任务未产生数据库错误。逻辑恢复保留 Flyway v28。该 P0 是同源本地构建支路，工作流中的正式 immutable-release 支路按设计不执行；精确 digest 的 12/13 服务与恢复由上表独立模拟运行验证。

最终 PITR 的数据库恢复步骤耗时 10.25 秒，只针对 64 MiB 合成数据，不是生产容量或端到端业务 RTO。原始报告明确 productionApproved=false。已在本地重算八份报告的 SHA-256，并交叉核对扫描、运行并集、迁移和恢复证据的源码与 manifest 哈希；各实验清理均通过。

迁移夹具说明：最初 774226c 候选使用未修改的旧镜像，在该 runner 上通过。第二次最终候选演练的旧镜像于 CREATE EXTENSION vector 触发 SIGILL，日志保留在[失败运行](https://github.com/xxbb11122/IotManager/actions/runs/39550484836)。最终迁移测试以固定旧 glibc 镜像为基底，仅重编译同一 pgvector 0.8.6 源码的通用指令集版本；记录实际夹具 ID、源码/构建文件哈希与 CPU 信息。该结果验证兼容旧 libc/数据格式的逻辑迁移，不声称未修改的历史镜像适用于所有 CPU。最终发布的 musl 镜像本身已经使用可移植编译选项。

候选应用源码固定为 89b7ddf；最终实验驱动为 1c2827e，之后的文档提交不改变被测应用。首次失败未被覆盖，使用新驱动的完整模拟工作流三个任务均 PASS。

## 4. 数据与发布边界

旧 glibc 卷必须通过逻辑迁移进入新卷；旧物理备份用旧 digest 保留恢复能力，musl 集群建立新的备份/WAL 链。合成迁移采用 C locale 和测试角色，不能替代所有生产 locale、扩展与授权的迁移清单；具体步骤见开发说明。

本轮未触碰生产数据库、未部署正式服务、未合并 PR、未打正式 tag。之前的 Android 模拟器故障/覆盖升级/实验签名证据继续保持其模拟边界，本轮没有声称重新完成实机测试。

2026-10-21 13:36 的实际 GitHub 治理检查为 4 PASS / 2 FAIL / 2 UNKNOWN，较整改前已补齐默认分支的四项保护。

| 未满足项目 | 状态 | 后续要求 |
| --- | --- | --- |
| r1-recovery-drill 环境 | FAIL | 独立审核人、禁止自批/管理员绕过、仅保护分支 |
| r1-rollback-drill / android-release 环境 | UNKNOWN | 提供可读取且满足同等保护的环境配置；正式签名交付单独受控 |
| 专用恢复 runner | FAIL | 在线、隔离且具备 self-hosted / linux / iot-manager-recovery 标签的受控 runner |

当前仓库只有原管理员，独立发布审核人尚未提供。模拟恢复不会把以上项目改写为生产 PASS；无需为本次测试提供真实手机/PDA，但实际审批、正式签名与恢复设施的治理不能由实验记录代替。

正式放行顺序：补齐独立审核人与三个受保护环境，准备符合要求的恢复执行环境及签名流程，在保护分支合入已审代码后，由受保护 release-gate 对新候选生成可信生产证据。此前保留 NO_GO，不自动合并或发布。

后续第 3～6 项已补齐可执行的 runner、签名、调度及逻辑迁移工具，并完成新备份链和恢复后双库核对的隔离验收，见[发布运维验收报告](RELEASE-OPERATIONS-ACCEPTANCE-2026-10-21.md)与[操作手册](RELEASE-OPERATIONS-DEVELOPMENT-AND-RUNBOOK-2026-10-21.md)。该开发交付不改变本节真实治理未满足的状态。
