# 登录会话恢复整改与复测记录

日期：2026-10-20，Asia/Shanghai。

**会话误清除缺陷的隔离回归已关闭，发布结论仍为 NO_GO。** 已完成“启动读取连接设置失败会清除有效登录会话”的代码修复，新增真实认证管理器集成及页面回归，最终相同驱动的两轮原生 18 项套件均通过。正式签名、目标硬件、不可变产物、生产恢复和发布治理仍需验收；隔离测试通过不能代替正式批准。

本文补充 [2026-10-18 全项目发布复评](PROJECT-RELEASE-REASSESSMENT-2026-10-18.md)，历史失败及原始报告保留。

## 1. 修复行为

启动读取端点超时、失败或取消时，进入“连接设置未确认”：

- 保留加密登录会话，不读取并恢复它，也不创建使用默认地址的 API/WebSocket 适配器。
- 页面可以显示并导航，平台控制保持不可用；操作员可重新读取已保存设置，或明确确认另一份连接设置。
- 读取成功后，按保存的 issuer/client ID 恢复会话；恢复后请求必须携带原会话的认证头。
- 操作员明确切换到另一身份时，仍清除旧身份的会话；没有放宽 OIDC 身份绑定。
- 迟到的配置读取或旧会话恢复不能覆盖新选择，失败重试不会清除会话。

保持可选读取 1,800 ms、原生启动 8,000 ms、网页补救 9,500 ms 的原有预算。未增加生产测试后门。

主要实现为 `apps/client-glass-next/src/main.js`、`src/js/ui.js`；回归位于 `test/runtime-presentation.test.js`、`e2e/startup-session-recovery.spec.js`，严格验证脚本已显式纳入新增页面用例。

## 2. 版本与安装包身份

| 对象 | 身份 |
| --- | --- |
| 功能修复 | `88b2a5501d4d2189b771003a67c68302a2d6d257` |
| 严格页面用例纳入 CI | `fd18a8990f06586a4b9c71684507f4b6001bfac4` |
| 最终被测源码与驱动 | `d895e40d253dc0ee478f51c0a4ba9d620bbe14b5`；驱动 SHA-256 `ee701a7e802f532ccd4903094eab4b2ff1f3b2770595d2a80569509e64d96f0f` |
| 实际安装 Debug APK | `1.1.4-glass.6 / code 11`，包名 `com.iot.manager.glassnext` |
| APK 内嵌源码 | `88b2a5501d4d2189b771003a67c68302a2d6d257`，`dirty=false` |
| APK SHA-256 | `ea037b452ab58cbb4acf42c24611532b7218e33984a6af006cb7d02a7df0da58` |
| 资源与签名 | 14 个网页资源与构建目录逐一摘要匹配；APK v2 签名验证通过，签名属于 Debug |

本地安装包与 CI 安装包使用不同构建环境，不混用其摘要或安装结果。后续改动涉及测试驱动、验证诊断及文档，应用运行时源码一致性由 Git 对象逐项校验，不把旧包标成新提交构建。

## 3. 已完成的复测

| 范围 | 结果与边界 |
| --- | --- |
| 修复前新增回归 | 2 通过、6 失败，确认原实现不能满足会话保留及恢复要求 |
| 实际 bootstrap + OIDC 管理器 | 修复后的完整 Glass Node 测试 257/257，零失败、零跳过；包含超时、失败、取消、明确换身份、空配置及迟到结果竞态 |
| 原始缺陷复现器 | 已保存端点读取成功与超时均保留会话；超时没有删除 key、没有持久化默认端点、没有恢复认证 |
| 本地完整 Glass 浏览器 | 77 通过，零失败、零重试通过；8 个需要真实服务的条件用例跳过，单独列示 |
| 严格浏览器 CI | 118/118，零跳过：Frontend 1、Console 1、原客户端 39、Glass 77 |
| 原客户端 Node CI | 230/230，零失败、零跳过 |
| Backend / Edge CI | Backend 194、Edge 7，在 UTC 与 Asia/Shanghai 均零失败、零跳过；包含 PostgreSQL Testcontainers |
| 四端构建与配置 | 严格 Quick CI 成功；两端 Android Debug 构建、部署配置和源码安全检查通过 |
| Android JVM | 5/5，显式重跑测试任务；不是只读取旧报告 |
| Android 仪器测试 | API 36 专用模拟器 4/4，零失败、零跳过 |
| 原生 18 项集成套件 | 相同驱动、相同安装摘要，两轮独立冷启动均 18/18，零失败、零跳过；每轮仅 2 次模拟聊天 POST，恢复通过 GET 完成 |
| 验证脚本负向检查 | Maven 版本探测失败时，保留原始诊断并立即退出；Bash/PowerShell 语法检查通过 |
| 发布治理预检 | FAIL：5 项 FAIL、3 项 UNKNOWN、0 项 PASS；`productionApproved=false` |

这些层级存在重复覆盖，不相加为一个业务总通过数。

### CI 证据

- 最终被测提交 `d895e40` 的 [Quick CI push](https://github.com/xxbb11122/IotManager/actions/runs/39378865790)、[Quick CI PR](https://github.com/xxbb11122/IotManager/actions/runs/39378871885) 均成功；已下载当前提交的双时区 Java 与页面计数，确认与上表一致。
- `fd18a89`：[Quick CI push](https://github.com/xxbb11122/IotManager/actions/runs/39375901194)、[Quick CI PR](https://github.com/xxbb11122/IotManager/actions/runs/39375905092) 均成功。
- 同提交的 [P0 Docker Runtime](https://github.com/xxbb11122/IotManager/actions/runs/39375905094) 普通集成成功，包含隔离服务边界与协议、重启持久性、数据库中断 readiness 503 及逻辑恢复；恢复 Flyway 版本 28。
- P0 实际检出合并预览 `b472ac8bbe26a2cdfe053a72f015b24717ea561d`；其 tree 与 `fd18a89` 均为 `6fead373a20e3d4a4cca4e5f4f97b94f50a0053e`。正式不可变 12 服务分支为 skipped。
- `4cde383` 的 [Quick CI push](https://github.com/xxbb11122/IotManager/actions/runs/39377828748) 成功；[PR Quick CI](https://github.com/xxbb11122/IotManager/actions/runs/39377832864) 的 UTC 任务在 Maven 初始化阶段失败，不能将该运行计作通过。原脚本捕获版本探测输出后直接退出，未显示失败原因；本轮补齐诊断，未将原因擅自归为网络或业务断言。

后续 P0 运行没有完成前不增加通过记录；本报告采用已完成的 `fd18a89` P0 证据，并核对其 Backend、Edge、部署及其他业务源码与最终被测提交一致。报告归档提交只修改文档，不改变安装包或被测业务源码。

## 4. 原生验证范围与失败保留

原生新增两项：损坏已保存配置后冷启动，核对加密会话仍在、默认端点无请求、原生遮罩完成退出；纠正配置后点击页面重读入口，核对恢复登录及所有业务请求的认证头。隔离 HTTP fixture 对匿名 API 请求返回 401，避免匿名测试服务造成假通过。

**原生使用损坏 JSON 触发读取失败，不声称注入了真实 Android 存储超时。** 超时及取消由实际认证管理器参与的集成回归覆盖。原生请求仅访问模拟器回环服务，未调用真实 AI 供应商，也不代替真实 Keycloak、现场 BLE/LAN、手机/PDA 验收。

原有检查继续覆盖材质与对比度、导航、草稿、HTTP 往返、回答文本安全、键盘、系统返回、性格版本、恢复元数据、后台停止轮询、进程重启 GET 恢复且不重复 POST、旋转、安全区域、Browser 插件及内部代理文档导航拦截。

| 失败记录 | 处理与结论 |
| --- | --- |
| 软件渲染下未在预算内完成启动 | 留存 COVERING/NATIVE_FALLBACK 及 WEB_FALLBACK 时序，未延长产品预算；硬件加速对照可完成关键启动路径。目标低端 PDA 冷启动性能仍须验收 |
| 故障配置被正常启动的延迟保存覆盖 | 测试先等待准备启动完成，再核对故障值及落盘、后台状态，随后执行真正的进程重启 |
| Wi-Fi 启用但未完成关联 | 测试等待系统启用状态后关联模拟 AP；准备阶段单独限时，不计入或延长 App 启动预算 |
| 16 项通过后 Chrome 返回检查失败 | 截图确认首次使用提示消费了返回键；提示还可能晚于无障碍快照出现。保留失败，不把一次 18 项通过当作连续稳定 |
| Chrome 无障碍快照未可靠落盘 | 最终使用 App 登录回调实际调用的原生 `Browser.close()` 验证桥接返回，并检查关闭事件、App 活跃状态与焦点。Chrome 提示出现时的系统返回取消流程仍是独立验收边界 |

最终套件不通过反复发送返回键、强制启动 App、放宽身份校验或延长启动时限来取得通过。早期失败日志和截图全部保留。

## 5. 正式发布前仍需完成

| 项目 | 关闭标准 |
| --- | --- |
| 仓库与环境治理 | 默认分支评审、必需检查、受保护发布环境及专用恢复 runner 全部取得可验证 PASS |
| 不可变发布 | 同一候选 SHA/release ID/digest 的镜像扫描、SBOM/provenance、完整运行态与最终 Release Gate |
| 正式签名与硬件 | 可信正式证书、分发升级；目标手机/PDA 完成真实 HTTPS/OIDC/WSS、权限、BLE、弱网、后台、冷启动与浏览器取消验收 |
| 恢复与运维 | 受控环境真实存储 IAM、代表性数据量、清理后 PITR、完整服务恢复计时及业务批准的 RPO/RTO；告警、灰度和回退签认 |

2026-10-18 的负载、物理恢复和固件编译结果作为历史模拟证据保留，本轮未将其冒称为重新执行。Backend、Edge、固件及恢复实现没有随本次会话整改发生业务变化。AI/知识库保持生产默认关闭时可列为 OUT_OF_SCOPE；启用时另做真实供应商验收。

## 6. 本地证据

根目录：`artifacts/session-recovery-20261020/`。

- `regression-before.log`、`glass-node-final.log`、`startup-session-probe.json`：修复前失败、完整回归及原始缺陷对照。
- `browser-results.json`、`ci-fd18/`、`p0-fd18/`：页面、严格 CI 及 P0 原始证据。
- `apk-identity.json`、`apk-signature.log`、Android 构建/仪器日志：安装包与测试身份。
- `native*.log`、对应结果 JSON 和截图：每次原生执行，失败与最终结果分开保存。
- `native-api-confirm-1/`、`native-api-confirm-2/`：最终两轮 18/18；`native-api-confirm-2-inputs.json` 记录干净的被测驱动提交，第一轮驱动副本的摘要与其相同。
- `governance-final.json`、`verify-version-probe.json`：只读治理检查及版本探测负向验证。
- `verification-summary.json`：最终机器汇总，核对源码、驱动摘要、安装摘要、资源、原生结果及发布结论。

源码和文档提交到现有整改分支及 PR；安装包、原始日志、设备截图和本地环境数据不进入 Git。没有合并 PR 或部署生产。
