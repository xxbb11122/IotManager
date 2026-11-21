# 第 3～6 项开发交付与模拟验收

日期：2026-10-21，Asia/Shanghai。执行说明见[开发与运维手册](RELEASE-OPERATIONS-DEVELOPMENT-AND-RUNBOOK-2026-10-21.md)。

**第 3～6 项的运维工具与工作流开发完成，隔离模拟验收通过。正式发布仍为 NO_GO：真实审批、受保护环境、在线专用 runner、正式签名密钥接入及正式版本 N-1 尚未闭环。** 本轮未合并 PR、未创建正式 tag、未切换业务流量，手机/PDA 继续采用模拟范围。

## 1. 开发交付

| 项目 | 已交付 | 本轮实际验证及范围 |
| --- | --- | --- |
| 3，专用 Linux runner | 主机依赖检查、官方包哈希校验、独立目录及单任务注册入口；主机仅接收管理端取得的短期 token | GitHub 托管 Linux 主机依赖检查通过；实际执行打包/校验/解包与注册参数测试，外部 config.sh 用合成夹具代替，不向 GitHub 注册真实 runner |
| 4，Android 签名 | Client/Glass Secret 分离、正式 keystore 检查与保护环境上传工具；私钥随机挑战签名验证 | 实际生成临时实验 keystore，校验私钥、两个密码、证书指纹和有效期；错误密码/证书拒绝，实验 key 不上传；正式 APK/AAB 签名仍需正式配置 |
| 5，最终验收调度 | plan/dispatch 实时检查与四阶段调用；恢复、回滚和 Release Gate 增加审核源码前置检查 | 未合并源码、非默认分支、无签名配置、版本复用、缺少 N-1 等均阻断；真实治理读取仍未满足，未投递正式发布或伪造批准 |
| 6，数据库迁移 | inspect/export/restore/verify、目标初始化 locale overlay、新 S3 备份链与 immutable PITR 衔接 | 真正执行 glibc PG16→新 musl PG16 的双数据库逻辑迁移；再执行新全量备份/WAL 重放，并比对恢复后的两个业务库及权限 |

迁移工具保留所有权及 ACL，核对完整数据库清单、角色/成员关系、列、函数、策略、索引有效性、序列语义状态及 large object；不使用 no-owner/no-acl。源/目标容器和 PGDATA 必须独立，目标为空且物理 system identifier 不同；旧卷与旧备份链不删除。导出目录 0700、文件 0600，完整 dump/清单留在私有路径，不作为公共 artifact 上传。

## 2. 验收身份与证据

被测运维工具源码：`c95fb447f95e46ec09e4d85061ff06b8d2f91e61`。后续文档更新不修改被测工具。

实验复用此前实际构建的八镜像候选 `r1-rc-remainingfix-20261021-89b7ddf2900d`，应用源码 `89b7ddf2900d5d62754f59060e5d837920377d55`，manifest SHA256 `4a3bfe6b997af06e8abcb32d6d0ea7bb9a5970273fb1cefcbf431a624d4fd0d6`。这是工具验收夹具，不能把它当作当前工具提交的新发布镜像或正式 Release Gate 批准。

| 验证 | 结果 | 原始证据 |
| --- | --- | --- |
| 运维重点测试 | Linux 7/7，失败 0，跳过 0，含注册协议、实际实验私钥及源码拒绝 | [最终运维模拟](https://github.com/xxbb11122/IotManager/actions/runs/39574579331) |
| Linux 主机依赖 | PASS，明确 registered=false，仅检查执行条件 | 同一运维模拟 |
| 双库迁移 | 300 条 Unicode/JSON/时间/向量业务数据、20 条认证数据、序列、大对象、角色及 ACL 一致 | 同一运维模拟 export/restore/verify.json |
| 拒绝测试 | dump 篡改、角色提权、重复恢复、目标数据损坏、App DDL 全部拒绝 | 同一运维模拟 summary.json |
| 新链 PITR | 新 S3 prefix 下创建全量备份，命名恢复点后 WAL 重放到独立卷，排除恢复点后的标记，提升为可读写库 | 同一运维模拟 new-chain/report.json |
| 恢复后业务核对 | businessDataVerified=true；再次核对两库完整清单，只排除工具保留的 r1_recovery_drill schema | 同一运维模拟 new-chain-summary.json |
| 镜像身份及清理 | 恢复使用实际 R04 digest；清理 status=0、ownedResourcesRemaining=0 | 同一运维模拟 service-digests.json / cleanup.json |
| 严格 CI，分支提交 | 所有任务及 quick-gate PASS | [push Quick CI](https://github.com/xxbb11122/IotManager/actions/runs/39574579212) |
| 严格 CI，PR 合并预览 | 所有任务及 quick-gate PASS | [PR Quick CI](https://github.com/xxbb11122/IotManager/actions/runs/39574588327) |
| 完整应用 P0，d978466 | 全栈、权限、故障恢复及逻辑恢复 PASS；正式 immutable 支路按设计未运行 | [分支 P0](https://github.com/xxbb11122/IotManager/actions/runs/39574118491) |
| 完整应用 P0，c95fb44 的 PR | 第二次执行 PASS，全栈与清理通过；正式 immutable 支路按设计未运行 | [PR P0，attempt 2](https://github.com/xxbb11122/IotManager/actions/runs/39574588248/attempts/2) |
| 静态检查 | actionlint、Bash 语法、Git whitespace 检查通过 | 本地执行；CI 同时验证工作流及 Compose 合约 |

严格 CI 的 UTC / Asia/Shanghai 各 Backend 201、Edge Agent 7，失败/错误/跳过均为 0。旧客户端 252 单元 / 54 浏览器，Glass 257 / 77，Frontend、Console 各 1 浏览器用例；两个 Android debug 构建通过。本地 Windows 的注册协议测试按平台不执行，其 Linux 对应测试已实际通过，未将 Windows 跳过计为 PASS。

分支完整 P0 使用 d97846697d3c8d73b0f2ec3c3ce9c90f8084e160；到 c95fb44 的差异仅为两个 ops 工具和一份文档，应用及镜像构建文件一致。实际观察 PostgreSQL 中断时 readiness=503、恢复后 healthy、Backend 依赖启动重试及持久化通过，定时任务错误为 none；逻辑恢复保持 Flyway 28。

最终新链报告记录 base_000000010000000000000003、随后 000000010000000000000004 WAL、Flyway 元数据 28 一致、恢复阶段 8 秒。这是小规模合成数据及 Flyway 标记夹具；不代表生产容量/RTO，也不声称重新执行了全部业务数据库迁移脚本。完整业务运行的既有证据仍见[前轮验收](REMAINING-RELEASE-FIXES-AND-ACCEPTANCE-2026-10-21.md)。

旧源明确使用固定历史 glibc 镜像加同一 pgvector 0.8.6 的通用 CPU 编译夹具；最终实际夹具 Image ID 为 `sha256:f33996aad614cc4074ce849a5a8438a7df2306286e1bf5d82de3b319c07f77a2`。本轮不声称未修改历史镜像适用于当前 runner CPU。

首次[运维演练失败](https://github.com/xxbb11122/IotManager/actions/runs/39573066979)发生于 S3 夹具启动：只启动 PostgreSQL 时 Compose 没创建 egress 网络。已经显式创建带本次项目标签的网络；首次失败资源清理为 0。修复后完整演练通过，最后补强恢复后业务指纹核对的上述最终运行也全部通过，失败记录保留。

额外 PR P0 的[第一次执行](https://github.com/xxbb11122/IotManager/actions/runs/39574588248/attempts/1)在镜像构建时发生 Maven 依赖解析失败；代表性同版本 jar 随后直接访问返回 HTTP 200。同一提交未修改依赖版本，在新 runner 重跑完整 P0 后通过。第一次的 GitHub 失败日志保留；为允许重试上传同名临时产物，先完整归档了原 artifact 12334590542，再清理该旧 artifact。原始 ZIP 在本地 `artifacts/release-operations-20261021/p0-first-attempt-original.zip`，SHA256 为 `1becc7e30a63c577a8690e0d2deec7cd90e82647bc551512956cb8bfdf5e1d12`，未用新产物改写首次失败结论。

## 3. 正式接入条件与使用限制

2026-10-21 17:10 的真实 GitHub 治理读取仍为 4 PASS / 2 FAIL / 2 UNKNOWN，productionApproved=false。默认分支四项保护生效；恢复环境保护不满足，另外两个环境未就绪，专用 runner 未在线。发布计划也会拒绝尚未合并到默认分支 HEAD 的提交。代码与模拟不会改变这些事实。

正式使用顺序：补齐独立审核人与三个受保护环境；在专用隔离 Linux VM 注册/启动 runner；通过工具接入已有正式签名；审核合并后对同一个默认分支提交运行 Gate/签名/恢复；存在两份已批准证据后执行 N→N-1。迁移完成、新链验收与应用冒烟后再由发布责任人批准切流。

数据库自动路径要求两侧 C/POSIX/C.UTF-8/C.utf8 libc locale 元数据一致；其他 locale/ICU 需要单独审核排序规则转换，工具会拒绝自动转换。多库恢复采用每库事务，发生中途失败保持流量关闭并换新目标，不自动删除现有目标。新库接受业务写入后的旧库回退需要数据同步，不把保留旧卷当成无损回退。

正式 APK/AAB、正式已批准 N-1、目标基础设施的恢复能力以及生产切换均未在本轮冒充通过。开发交付和模拟验收已完成，真实部署接入及批准仍按上述条件执行。
