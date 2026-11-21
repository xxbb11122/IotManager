# IoT Manager 全项目测试与正式发布评估

评估日期：2026-10-18（Asia/Shanghai）。

评估对象：`fb0ac983048ee4d10d42e82d06427b878c76e100`，分支 `codex/glass5-remediation`，对应 [PR #2](https://github.com/xxbb11122/IotManager/pull/2)。评估期间没有修改业务源码、依赖锁或部署配置，也没有执行正式发布、现场设备指令或生产库操作。

**发布结论：NO-GO，当前不具备整体正式生产发布条件。**

已有多层自动化回归，基础测试与构建通过，但当前提交的后端回滚实测失败；Glass 降版存在已复现的数据库版本限制；正式签名包、不可变发布/灾备证据及目标设备验收尚未闭环。当前适合继续开发和隔离集成测试。

## 1. 本轮验证范围与证据

覆盖 Backend、Edge Agent、监控前端、操作控制台、原客户端、Glass Next、Android 发布签名、依赖审计、Compose、CI、回滚和发布治理；固件及现场硬件明确列为未验收。

同时使用本地复测与同一源码的 GitHub CI，不把重复运行、两个时区或已有专项重复相加。主要证据：

- [Quick CI：通过](https://github.com/xxbb11122/IotManager/actions/runs/39108415002)。Push 工作流检出本次准确提交。
- [P0 Docker Runtime：通过](https://github.com/xxbb11122/IotManager/actions/runs/39108417307)。工作流检出 PR 合并提交 `4d4cb7db9dc339a3b01b8af5c27b00952082c74e`；已通过 GitHub API 核对其源码 tree 与本地提交相同，均为 `7cb0ef1ece0d517e62d1358337a0b5be4c54f7d0`。
- [本轮手动执行的八项隔离集成：失败](https://github.com/xxbb11122/IotManager/actions/runs/39108854171)，准确提交为 `fb0ac98`；已下载结构化测试、负载、回滚与清理证据。
- 本机完整证据目录：`artifacts/project-release-audit-20261018/`。包含 `release-readiness.json`、`local-summary.json`、本地日志、CI 摘要、依赖审计和回滚探针结果。

## 2. 基础测试与构建结果

| 范围 | 本轮结果 | 说明 |
| --- | --- | --- |
| Backend 单元/集成 | CI 两个时区分别 189/189 通过，0 跳过 | JDK 17；包含 PostgreSQL Testcontainers，非仅 H2。 |
| Backend 本地补测 | 172 通过、17 跳过，0 失败；打包成功 | 本机 Docker Engine 不可用，17 个依赖 Docker 的测试按既有条件跳过；不计为本地通过。 |
| Edge Agent | 本地 7/7 通过并打包；CI 两个时区分别 7/7 通过 | 不等同于实体 Shelly/现场网络验收。 |
| 监控前端 | 2 项单元、1 项浏览器通过；生产构建成功 | Node.js 22.23.3。 |
| 操作控制台 | 1 项单元、1 项浏览器通过；生产构建成功 | 同上。 |
| 原客户端 | 230 项单元、52 项浏览器通过；8 项浏览器跳过；生产构建成功 | 使用隔离服务端口，未接入现场环境。 |
| Glass Next | 240 项单元、75 项浏览器通过；8 项浏览器跳过；生产构建成功 | 包含启动、材质、200% 字体、离线、控制与历史分页。 |
| 发布工具契约 | `release-tools`、`release-workflows` 两套契约脚本通过 | 在固定 Node 22 下直接执行；是工具契约测试，不是实际生产发布。 |
| 环境与 Compose | 公开构建环境检查、Compose 配置检查通过 | Compose 静态验证不需要 Docker Engine。Caddy 运行态及安全检查另由 P0 CI 验证。 |
| Android Debug | 原客户端与 Glass 的准确源码 CI 构建均通过 | Debug 构建不提供正式签名发布证据。 |
| Android Release 签名 | 两个客户端的 `validateReleaseSigning` 均失败 | 当前本机未提供有效的外部签名输入；详见第 5 节。 |

本地四端单元合计 **473 通过**；浏览器合计 **129 通过、16 跳过、0 失败、0 flaky**。两个客户端各自保留的 8 个真实环境开关用例重复统计为 16 个执行条目，不代表 16 类独立场景。

CI 中 Backend 与 Edge Agent 合计 196 个用例在 UTC、Asia/Shanghai 两个时区各执行一轮；不把它们加成 392 个独立用例。结合四端本地单元，可确认 669 个单元/集成用例通过，但该数量不表示发布门禁已通过。

本轮浏览器测试使用独立端口 56173/56174/56188/56190、合成响应及明确关闭的真实 OIDC 配置。未启用的本地真实认证、AI、负载、回滚用例，不能因另一层隔离集成通过就改记为通过。

## 3. 真实服务隔离集成

### 3.1 P0 Runtime 已通过

在 GitHub 临时运行器上使用实际 PostgreSQL、Keycloak、Backend、Caddy：

- HTTPS/WSS、PKCE、JWT、四角色 RBAC、会话生命周期、Edge 凭据轮换/撤销通过。
- 非 root、数据库应用角色不能 DDL、敏感接口边界通过。
- PostgreSQL 与 Backend 重启后数据保留通过。
- 数据库中断时 readiness 返回 HTTP 503，恢复后重新健康；依赖短时不可用时 Backend 能重试启动。
- 逻辑备份在独立 Compose 项目中恢复，Flyway 版本均为 28，恢复报告为 PASS。
- 篡改逻辑备份被拒绝；运行器证据与临时环境按工作流清理。

这份 P0 证据来自集成构建模式。工作流中的不可变 12 服务运行态项为跳过，不能将其替代正式发布的 digest、签名来源和受保护 PITR 证据。

### 3.2 八项场景复测：7 类通过、1 类失败

八类场景包含回滚的 write/read 两个阶段，因此实际执行 9 个 Playwright 用例：**8 通过、1 失败、0 跳过**。

| 场景 | 结果 | 边界 |
| --- | --- | --- |
| OWNER PKCE/API/WSS | 通过 | 临时 Keycloak、合成账号及数据。 |
| VIEWER 只读 | 通过 | 受保护读取与写入拒绝。 |
| 四角色与跨站点隔离 | 通过 | 使用实际 Backend 授权。 |
| 授权码/刷新令牌重放与退出 | 通过 | 实际 Keycloak 会话交易。 |
| Edge 凭据轮换/撤销 | 通过 | 合成协议客户端，实际 Caddy/Backend。 |
| 站点 AI、知识库关闭 | 通过 | 内部 HTTPS 模拟供应商，Chat 1 次、Embedding 0 次；未调用真实供应商。 |
| 1000 设备、100 WebSocket | 通过 | 短时合成负载；详见下表。 |
| N→N−1 数据兼容 | **失败** | 新版写入通过，旧版读取断言失败；出现约 8 小时命令时间偏差。 |

本次负载记录：

| 指标 | 值 |
| --- | --- |
| 虚拟设备创建成功/失败 | 1000 / 0 |
| 创建并发 | 25 |
| 创建吞吐 | 31.7 次/秒 |
| 创建延迟 p50 / p95 / p99 | 786 / 1035 / 1287ms |
| 列表读取 | 1534ms，返回 1000 个目标设备 |
| WebSocket | 100 条连接，共收到 100000 条消息，错误 0 |
| 数据清理 | 1000 项归档，活跃残留 0；本次临时容器/卷残留 0 |

这些是一次 GitHub 运行器上的短时结果。尚无业务确认的生产 SLA，也没有长期稳定性、生产网络与现场设备负载验收，不能据此宣称可支持生产规模或已满足 p95 指标。

## 4. 已确认的两类回滚问题

### 4.1 后端跨版本命令时间兼容失败——P0

本轮 N 为 `fb0ac98`，N−1 为方案指定的真实开发提交 `e0977e77220773182df4e3a73741686cbb87c6d9`。测试实际切换两个不同镜像，使用同一 PostgreSQL 数据库；迁移记录摘要未改变。

观察结果：

- N 提交/回读的命令时间约为 `2026-10-18T15:55:27.460578`。
- N−1 回读同一命令为 `2026-10-18T07:55:27.460578`。
- N−1 按 `+08:00` 解释时，和当前时间相差 **28,817,832ms，约 8 小时 18 秒**。
- 两个进程的环境 TZ 与实际 JVM 默认时区均记录为 Asia/Shanghai，不能仅用“没设置 TZ”解释。
- N−1 新增设备 HTTP 200、新增命令 HTTP 202，但跨版本读取用例仍失败。写入可用不足以证明旧数据和命令时间语义正确。

影响：应用回退后，命令有效期、历史时间及状态判定存在兼容风险。具体映射/持久化根因需继续定位；本报告不将其归因为已确定的某个驱动或单行代码。

关闭标准：修复或限定经过批准的兼容回滚基线，在保留同一数据库及迁移历史的情况下，通过 N 写、N−1 读/写、时间容差和命令生命周期断言。当前开发源码演练也不能替代两个正式不可变发布版本之间的受保护回滚证明。

证据：`current-eight/summary.json`、`rollback-evidence.json`、`rollback-read-probe.json`、`rollback-read.json`。

### 4.2 Glass 本地库降版不兼容——P0（移动端回退路径）

Glass 当前将 IndexedDB 从 v2 升至 v3。使用实际 `CacheRepository` 与隔离内存 IndexedDB 复现：

1. 创建 v2 数据库及一条本地历史。
2. 用当前实现升级为 v3，历史保留且分页可读取。
3. 关闭当前连接，再按旧版 v2 打开，得到 **VersionError**。

因此，“新版本升级成功”与“旧 APK 可直接覆盖回退”是两件需要分别验收的行为。当前未兼容 v3 的旧 APK 不具备这条直接回退能力；关闭启动实验开关也不会降库版本。

关闭标准：提供可读取 v3 的兼容回退包、桥接迁移或经过验证的数据恢复策略，并在保留真实应用数据的目标 APK 升降级中复测。证据：`app-rollback-probe.json`。探针仅使用内存数据库，没有读取或修改用户本地数据。

## 5. 正式发布与运维门槛

| 门槛 | 当前实测/查询结果 | 发布影响 |
| --- | --- | --- |
| 主分支与必选检查 | GitHub main protected=false；仓库 rulesets=[] | 不符合项目 Runbook 要求的受保护发布入口。 |
| 恢复环境审批 | `r1-recovery-drill` 的 protection_rules=[] | 没有配置所需审批规则。 |
| 恢复运行器 | 自托管运行器数量 0 | 当前无法完成设计中的受保护恢复执行链。 |
| Release Integrity Gate | 该工作流查询记录 0 次，无当前源码 PASS | 缺少同一候选的正式发布闭环证明。 |
| 不可变镜像安全 | 独立 Image Security 工作流无执行记录 | 源码扫描不能替代 8 个准确镜像 digest 的扫描、SBOM 与来源校验。 |
| 物理恢复/PITR | 恢复历史仅见取消记录；未取得有效 PASS | 逻辑恢复虽通过，远端 WAL-G PITR、生产 RPO/RTO 仍未验收。 |
| 正式应用回滚 | 历史 rollback 工作流仅见失败；本轮开发回滚仍失败 | 未获得批准生产版本之间的回退证明。 |
| Android 正式签名 | 两个客户端校验均报缺少外部签名输入；CI 仅构建 Debug | 尚无可验证的正式签名 APK/AAB 和签名升级链。 |
| 实体设备 | 现有 Native 证据来自模拟器 | 目标手机/PDA、现场 BLE/LAN、系统证书信任与原生冷回调尚未验收。 |

以上治理状态由本轮 GitHub API 查询确认，完整快照见 `github-state.json`。这些是当前可验证的证据状态；本地未配置密钥不代表能够证明所有其他发布环境也没有密钥，但仍不能据此认定正式签名发布已经完成。

Android 校验按既有防护正确拒绝缺少签名的 Release 输入，并非应绕过的构建失败。正式流水线应安全注入签名配置、生成签名产物、验证证书连续性和版本号，并在目标硬件完成升级验证；本轮没有生成或替换签名密钥。

项目已经有发布工具和 fail-closed 契约测试。要关闭发布门槛，仍需在同一候选 SHA 上实际执行：镜像构建一次、8 个制品 digest 扫描、不可变 12 服务运行态、恢复新增服务及受保护恢复、最终 Gate。仅配置文件存在或契约脚本通过不能填入这些 PASS。

## 6. 依赖安全审计

本轮通过 npm 官方 registry 执行完整依赖与 `--omit=dev` 两种审计：

| 工程 | 全依赖 high / moderate | 生产依赖审计 |
| --- | --- | --- |
| frontend | 4 / 1 | 0 |
| console | 4 / 1 | 0 |
| client | 5 / 1 | 0 |
| Glass Next | 5 / 1 | 0 |

这是每个工程依赖树中的包级审计结果，不能将四行简单相加当作不同漏洞数量。发现项位于开发/构建链，包括 Vite 5.4.21、esbuild 0.21.5、nanoid、source-map-js、部分 PostCSS，以及客户端工具链中的 xmldom/brace-expansion。

已核对维护者的一手公告：

- [Vite：Windows 路径导致 server.fs.deny 绕过](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)。影响有特定网络暴露和文件系统条件的开发服务器；不据此推断已部署静态站点存在同一远程入口。
- [xmldom：HTML 模式的输出放大](https://github.com/xmldom/xmldom/security/advisories/GHSA-6mj3-qw4j-hgrw)。其影响有 HTML 解析模式等前提；本轮未证明实际客户端构建流程触达全部报告路径。
- [esbuild：开发服务器跨源读取](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99)。

生产依赖审计为 0 是当前 registry 检查结果，不是整个产品或全部镜像“无漏洞”的证明。构建工具漏洞应按兼容升级方案修复并重跑回归，或走项目既有的精确、限时、经审批例外流程。当前评估将其列为 **P1 工具链风险**，不与生产运行时暴露混为一谈。

原配置的 npm mirror 不支持 audit API，初次审计返回 404；本轮已使用官方 registry 重做，最终没有把该接口错误当作“0 漏洞”。未执行自动依赖升级，也未修改项目 registry 配置。

## 7. 尚未覆盖的产品验收

- 目标手机/PDA 的冷/温启动、帧表现、200% 字体、横屏、读屏、前后台、升级保留数据与回退。
- 现场 BLE 设备、参考固件、真实 Shelly/LAN、断连重连、ACK 与设备实际状态的一致性。
- 生产证书链、部署域名和实际原生 PKCE 回调；隔离测试账号不能代替生产身份审批。
- 符合业务 SLA 的持续负载、长期稳定性及报警到处置链；本轮短时千设备测试不构成这些证据。
- `firmware/nrf52840-reference-switch` 未在本机执行 Zephyr 编译或烧录，当前 Quick CI 也未覆盖该固件构建；客户端协议测试不等于固件或物理设备通过。
- 真实 AI 模型质量、费用及供应商接入验收未执行。AI 与知识库仍默认关闭；如果正式版本继续关闭这些能力，可按关闭范围发布验收，无需把未启用的 AI 当作核心功能已经通过。

既有 Glass 启动专项记录中的 5 个 Native 单元测试、4 个仪器测试及模拟器证据仍可作为对应源码的功能证据；本轮没有重复生成真机通过记录，也没有将 Debug 模拟器测试改记为正式包验收。

## 8. 正式发布前的执行顺序

1. **先修回滚：** 后端跨版本时间兼容、Glass 本地库回退策略分别关闭；保留同库、原数据和旧版本读写的实测证据。
2. **补发布控制：** 启用主分支必选检查和恢复环境审批，配置受保护恢复运行器与运维责任人。
3. **修工具链安全项：** 对确定受影响的依赖执行兼容升级，重跑四端、Android 和依赖审计。
4. **出正式产物：** 冻结候选 SHA，形成准确镜像 digest 与正式签名 Android 包；验证产物来源、证书、升级和数据兼容。
5. **跑正式发布链：** 完成不可变运行态、远端物理恢复/PITR、经约定的 RPO/RTO，以及最终 Release Integrity Gate；再补目标手机/PDA 和现场链路验收。

全部阻断项关闭后，应对新的修复提交重新评估。当前候选的结论维持 **NO-GO**；本报告没有批准生产部署，也没有变更仓库保护或生产环境。

## 9. 本机复现与执行说明

详细入口、命令、退出码和 JSON 报告保存在本机证据目录：

```text
local-summary.json / local-web-results.json / root-tests.json
backend-verify-cached-maven.log / edge-verify.log
frontend-unit.log / console-unit.log / client-unit.log / glass-unit.log
frontend-e2e.json / console-e2e.json / client-e2e.json / glass-e2e.json
*-build.log / compose-config.log
npm-audit-results.json / *-audit-all.json / *-audit-production.json
client-release-signing.log / glass-release-signing.log
ci-quick/ / ci-p0/ / current-eight/
app-rollback-probe.json / github-state.json / release-readiness.json
```

本地使用 Node.js 22.23.3、JDK 17、Maven 3.9.10；Android 签名校验分别使用 JDK 21 与 23。Windows Maven Wrapper 的缓存移动失败后，改用已有同版本 Maven 缓存执行 verify，没有修改 Wrapper 源码。Docker Desktop 启动尝试未使 Engine 可用；本地 Docker 条件测试保持跳过，完整 PostgreSQL 与运行态证据来自明确列出的 CI。

源代码在评估前后保持同一提交，未执行依赖修复、数据库修复、生产发布或自动合并。本轮新增文件仅为本机测试产物和本评估文档。
