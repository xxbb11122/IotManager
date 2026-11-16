# IoT Manager 上线整改交付与验证结果

日期：2026-10-18。最终整改源码：`4c0658f67a857f4f2c3f0ebd2c2f338ef027f4d8`；Git tree：`67d01d7095918acf042fb6c8ae77e29ec2662483`。业务修复提交为 `c6f673c`；`83e5248` 补齐演练阶段配置，`4c0658f` 修正原客户端回归时序及签名入口失败判定。

流程已执行：整改方案 → 方案自审与修订 → 开发文档 → 开发文档自审与修订 → 实施 → 验证。审核执行者为本轮开发代理，未声称外部独立审核。

- [整改方案](PRODUCTION-REMEDIATION-PLAN-2026-10-18.md)
- [两轮审核及追加修正](PRODUCTION-REMEDIATION-REVIEWS-2026-10-18.md)
- [开发文档](PRODUCTION-REMEDIATION-DEVELOPMENT-2026-10-18.md)
- [正式发布验收模板及管理员配置清单](PRODUCTION-ACCEPTANCE-TEMPLATE.md)
- [开发分支 PR #2](https://github.com/xxbb11122/IotManager/pull/2)

## 1. 已交付的整改

| 问题 | 实现结果 |
| --- | --- |
| 后端回滚相差 8 小时 | 移除对旧 LocalDateTime 二次转换的全局 JDBC UTC Calendar；Instant 保持权威 UTC；增加两套数据库的独立旧读、新读测试 |
| 新缓存阻止旧 App 回退 | 严格 v2/v3 兼容打开器、未知 schema 拒绝、旧代码补丁指纹验证、兼容回退源码生成器；保留真实索引分页 |
| 构建依赖漏洞 | 四端 Vite 7.3.7，修复 PostCSS/source-map-js/nanoid 等依赖，客户端 xmldom 0.9.12 / brace-expansion 5.0.12；保留原浏览器目标 |
| CI 汇总与覆盖遗漏 | Quick gate 纳入 Glass Android；严格验证加入 Glass 材质用例、完整 npm 安全审计及发布工具负例测试 |
| 发布配置缺少验证 | 新增只读 governance preflight，缺失或不可读都不能通过；不会修改仓库权限 |
| 无正式签名入口 | 受保护 Android 手动工作流；限定默认分支历史，校验证书、包名、版本、APK/AAB 签名、嵌入源码身份与哈希；密钥只在临时目录 |
| 验收混淆 | 新增统一验收模板，区分代码、模拟、隔离集成、真实签名与实机/恢复证据 |

## 2. 实际执行结果

| 检查 | 结果与范围 |
| --- | --- |
| 时间测试修复前 | 上海时区 2 项失败：旧 JDBC 读少 8h，旧写经新版读多 8h；日志保留，证明测试能捕获原缺陷 |
| 时间测试修复后 | H2 UTC / Asia/Shanghai 各 2 项通过；实际 PostgreSQL 由 CI 执行 |
| 本机四端 Node 单测 | 479/479：frontend 2、console 1、client 230、Glass 246；最后一项为真实运行配置覆盖检查 |
| 本机浏览器全量 | 129 通过、0 失败、0 flaky；16 项需要真实服务的用例按条件跳过，不记通过 |
| 严格 CI 浏览器 | 116/116，0 跳过：frontend 1、console 1、client 39、Glass 75 |
| 严格 CI Java | Backend 193、Edge 7；UTC 与 Asia/Shanghai 各自全部通过、0 跳过；PostgreSQL 会话另设 America/New_York |
| 本机 Java 打包 | Backend 174 通过 / 19 个需 Docker 用例跳过；Edge 7 通过；两者打包通过。本机跳过由上项真实 CI 补齐 |
| 依赖安全 | 四端完整审计 + 四端生产依赖审计，共 8 份报告均 0 漏洞；使用官方 npm registry，未修改全局镜像 |
| 缓存兼容 | fake-indexeddb 13 项相关回归通过；另在 Chromium 原生 IndexedDB 真实执行旧→新→兼容旧→新，绑定和活动完整 |
| 回退源码生成 | 已导出真实 Glass.5 源码并应用受限补丁；Web 和 Android Debug 构建通过，220 项旧业务单测通过；APK appId 不变、code 12；不是原始旧 APK，也不是正式签名产物 |
| Android 本机 | 原客户端与 Glass Debug 构建通过；Glass Native JVM 5 项通过，AndroidTest APK 编译通过；未将编译当作实机运行 |
| Android CI | 原客户端 JDK21、Glass JDK23 Debug 构建均通过；已下载两端最终源码 APK，内嵌 commit 均为 4c0658f、dirty=false，校验哈希与 CI sidecar 一致；仍是 Debug 签名 |
| 发布工具 | 9 项新增工具测试通过，含真实 Bash 默认分支入口正反例；既有两套 release 契约脚本通过；actionlint 1.7.12 检查三个变更工作流通过 |
| 断线重连测试时序 | 原客户端测试修正后连续 20 次通过，0 重试/失败/flaky；逐次验证三次重连冷却，保留一次 GET 的要求 |
| 实际签名拒绝验证 | 现有 Debug APK 经真实 apksigner 验签后，发布身份校验正确拒绝；两端缺少正式凭据时 Gradle 拒绝。临时测试证书的正向 APK/AAB 签名测试被自动审批审查拒绝，工具未提供具体理由，未执行、未计通过 |
| 治理预检 | 实际返回 FAIL，productionApproved=false；缺保护/环境/runner 或 API 不可读均未误判成功 |
| 服务端 N→N−1→N | 最终准确源码通过：8 个场景、10 次执行，0 失败/跳过；同数据库、不同镜像，恢复准确 N 镜像后读到 N−1 写入；迁移历史不变；清理后 0 容器/卷 |
| 短时合成负载 | 1000 个虚拟设备、25 并发请求、100 个认证 WS、100000 条消息，0 创建/WS 错误；创建 49.6/s、p95 686ms、p99 932ms；仅代表本次 runner，不是长稳或生产 SLA |
| P0 Docker Runtime | 准确源码通过；PG/Backend 重启持久性、PG 中断 readiness 503、12s 启动依赖重试、逻辑备份独立恢复均通过，恢复 Flyway 28；不可变 12 服务分支在本模式跳过，不能算正式发布/PITR 验收 |

最终 `4c0658f` 的 [Quick CI](https://github.com/xxbb11122/IotManager/actions/runs/39121017707)、[PR Quick CI](https://github.com/xxbb11122/IotManager/actions/runs/39121020136)、[Eight isolated runtime boundaries](https://github.com/xxbb11122/IotManager/actions/runs/39121082324)、[P0 Docker Runtime](https://github.com/xxbb11122/IotManager/actions/runs/39121017640) 与 [PR P0 Docker Runtime](https://github.com/xxbb11122/IotManager/actions/runs/39121020092) 均已通过。汇总归档于 2026-10-18 19:10（Asia/Shanghai）；没有仍在运行的本轮验证任务。

失败记录保留：首次隔离演练 [39118901449](https://github.com/xxbb11122/IotManager/actions/runs/39118901449) 的 resume 配置遗漏已修复；[39119756022](https://github.com/xxbb11122/IotManager/actions/runs/39119756022) 暴露原客户端初次 WS 时序假设，已修正并完成 20 次无重试验证。失败轮次未计完整通过。

最终源码的真实数据库记录示例：旧时间列 `2026-10-18 19:02:56.826074`，对应 UTC 列 `2026-10-18 11:02:56.826074+00`；N−1 返回 `19:02:56.826074`，恢复 N 后读取 N−1 写入的 `19:03:13.612728`。比较时保留原 90 分钟断言，未放宽容差。

## 3. 回退源码与历史数据的使用边界

兼容旧业务源码可按下列方式重新生成到新目录：

```powershell
node apps/client-glass-next/scripts/prepare-compatible-rollback.mjs --baseline 0c0ed0393f880d6483ce72632bdaa8980a3a4afe --output artifacts/compatible-rollback-new --version-code 12
```

code 12 仅适用于当前最高已安装 code 为 11 的测试条件；正式回退必须高于实际已分发最高 code，且使用相同正式证书。输出包含 baseline、补丁与锁文件哈希及未签名状态。导出物须放入独立 Git 仓库提交/审核后冻结源码，再走正式签名和设备验收；不得把所在父仓库的 SHA 当作该导出物的独立源码身份。

只读历史差异核对：`psql -v legacy_zone=Asia/Shanghai -f scripts/release/audit-legacy-time.sql`。先确认真实旧部署时区和访问范围；它只列出差异，不更新生产数据。没有权威 UTC 的历史行仍需人工追溯，不能统一平移八小时。

## 4. 当前上线判断与剩余事项

**本轮仓库整改完成后仍不能直接正式上线：NO-GO。** 以下条件必须取得真实证据：

1. 管理员落实默认分支、环境审核与专用恢复 runner；预检实际通过。
2. 提供既有正式 keystore、可信证书指纹与最高分发 code；受保护签名构建成功并核验真实产物。未生成或代用生产私钥。
3. 同候选不可变镜像、安全扫描、Release Integrity Gate、WAL/PITR、生产版本回退证明齐全。普通集成环境与开发版切换不代替这些证明。
4. 目标手机/PDA、BLE 固件、真实 LAN HTTPS/OIDC/WSS、升级和兼容回退的实机验收。
5. 批准设备规模、持续负载时长、成功率/延迟、RPO/RTO，并完成长稳、固件构建/设备及运维交接。AI 若启用再补真实供应商验收。

本轮没有合并 PR、部署生产、上架、改仓库访问权限、操作现场设备或修改生产历史数据。

原始证据位于工作区 `artifacts/release-remediation-20261018/`；[机器可读汇总](../artifacts/release-remediation-20261018/remediation-verification.json) 验证五个最终工作流均成功且属于准确源码，结论仍为 NO_GO。本报告是本地交付结果，源码和方案已提交到上述 PR；已保留其他原有未跟踪文件，已跟踪源码工作区无改动。
