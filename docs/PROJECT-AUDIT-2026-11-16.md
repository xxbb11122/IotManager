# IoT Manager 当前项目审核报告

审核日期：2026-11-16（Asia/Shanghai）。审核方式：当前工作区静态审查、针对性构建与回归、官方 npm 安全审计、GitHub 只读核验。本文记录当前状态与整改要求，不修改业务代码，不构成发布批准。

后续状态：本文保留整改前的审核证据；2026-11-17 已按最小范围实施代码修复，当前结果与尚未关闭的验收条件见[最小修复说明](PROJECT-AUDIT-MINIMAL-FIX-2026-11-17.md)。以下失败、行号与版本信息属于审核时快照，不应当作修复后的最新结果。

## 1. 审核结论

**当前工作区的交付审核不通过。** 已实际复现后端编译失败，并确认天气结露来源的跨站点关联校验缺口，以及生产发现接口可进入演示认领逻辑的问题。默认主分支、整改分支和本地未提交版本之间也有明显差异。

项目已经具备单组织多站点 IoT 运维平台的主体结构：设备能力、命令回执、身份与站点隔离、天气、移动端、可选 AI，以及备份与发布工具均有实际实现。当前合理定位仍为 **R1 受控试点候选**。客户端界面回归通过，不能抵消后端构建和授权边界的问题。

本次列出 **8 项问题：P0 1 项、P1 4 项、P2 3 项**。其中既有代码缺陷，也有交付和发布条件未闭环；二者在各条目中明确区分。P0 表示阻断当前工作区构建，不表示发现了 CVSS 严重漏洞。

## 2. 审核对象和版本身份

| 对象 | 本次核实的状态 |
| --- | --- |
| 本地当前分支 | `codex/glass5-remediation` |
| 本地 HEAD / 远端整改分支 | `93bc58af32a9fc78a2da4421fbb01d1d5c5d9fea` |
| GitHub 默认 `main` | `1bb5075e3077b29ffc750700fe0b8b6ca0c31121` |
| 两分支关系 | `main` 是当前 HEAD 的祖先；整改分支比 `main` 多 67 个提交 |
| 本地未提交改动 | 审核开始时有 26 个已跟踪文件修改，另有新增 UI 源码、测试、测量脚本和本地报告 |
| 当前 Glass 版本 | `1.1.4-glass.7`，Android 默认 `versionCode=12` |
| 本轮 Web 构建身份 | `commit=93bc58a...`、`dirty=true`，因此不是该 SHA 的干净源码构建 |
| 合并状态 | [PR #2](https://github.com/xxbb11122/IotManager/pull/2) 可合并但被审核要求阻断；审核记录为空，状态为 `REVIEW_REQUIRED` |

因此，普通克隆默认 `main`，克隆整改分支，以及使用当前工作区，会得到三个不同的代码集合。此次没有合并 PR、推送 GitHub 或调整仓库保护。

## 3. 本次实际执行的检查

| 检查 | 结果 | 范围与证据 |
| --- | --- | --- |
| Backend 编译 | **失败**，1 个编译错误 | JDK 17、Maven 3.9.11、离线依赖；[日志](../artifacts/audit-20261116/backend-compile.log) |
| Edge Agent `verify` | 7 项通过，0 失败/错误/跳过，打包成功 | 模拟驱动/协议测试；[日志](../artifacts/audit-20261116/edge-verify.log) |
| Glass 单元测试 | 258 项通过，0 失败/跳过 | [日志](../artifacts/audit-20261116/glass-unit.log) |
| 原客户端单元测试 | 252 项通过，0 失败/跳过 | [日志](../artifacts/audit-20261116/client-unit.log) |
| Frontend / Console 单元测试 | 分别 2 / 1 项通过 | [Frontend](../artifacts/audit-20261116/frontend-unit.log)、[Console](../artifacts/audit-20261116/console-unit.log) |
| 发布相关定向单元测试 | 20 项通过，0 失败/跳过 | 治理、签名校验、WAL-G 环境、VEX、PG16 ABI；[日志](../artifacts/audit-20261116/release-unit.log) |
| Glass 浏览器回归 | **89 项通过**，0 失败/跳过/不稳定 | 15 个界面测试文件；[机器报告](../artifacts/audit-20261116/glass-e2e.json)、[日志](../artifacts/audit-20261116/glass-e2e.log) |
| 四个 Web 工程生产构建 | 全部通过 | Glass、原客户端、Frontend、Console；两个 App 的开发预览隔离检查通过 |
| npm 完整依赖审计 | Frontend / Console 为 0；两个移动客户端各 3 项 moderate | 使用官方 npm registry；无 HIGH/CRITICAL，详见 AUD-06 |
| GitHub 治理预检 | **FAIL：4 PASS、2 FAIL、2 UNKNOWN** | [JSON](../artifacts/audit-20261116/governance-preflight.json) |
| 本机 Docker 运行态 | 未能检查 | Docker Desktop Linux Engine 管道不存在；本轮未启动或重配 Docker |

本轮 JavaScript 实际使用本机 Node **24.14.0**；仓库 `.nvmrc` 和严格验证要求 **22**。因此上述本地 JavaScript 结果应与 Node 22 CI 分开记录。本机默认 `JAVA_HOME` 仍为 Java 8；本次 Java 检查显式选择 JDK 17，避免把工具链错误混同为代码错误。

89 项浏览器检查覆盖 AI 问答/历史/性格、输入与滚动、材质和高对比度、设备页面、离线恢复、下拉刷新、实时局部更新、底栏、动效中断、预览及启动恢复。它们使用隔离网络/硬件边界。日志中 `127.0.0.1:9` 的 WS 拒绝是测试配置的隔离代理，不是正式后端故障。此轮选择的用例集合不同于旧报告的 91/92 项，不能混用计数。

后端因编译失败未继续执行其完整测试；没有重新构建 APK、安装真机、调用付费 AI、执行物理设备控制、数据库恢复或生产压测。

## 4. 问题明细

### AUD-01 / P0：本地后端源码无法重新编译

**类型：已复现的本地未提交代码缺陷。**

[LanDiscoveryService](../backend/src/main/java/com/iot/manager/service/LanDiscoveryService.java#L67) 的 `private final ObjectMapper objectMapper` 被注释，但第 212 行仍调用 `objectMapper.writeValueAsString(value)`。JDK 17 编译实际返回 `cannot find symbol: variable objectMapper`。

这会阻断 Maven 构建、从当前源码重建 Backend 镜像和依赖重新编译的 IDEA 启动。已有旧 JAR 或旧容器即使能启动，也不能证明当前源码可用。该行未提交到 `93bc58a`，因此旧 CI 通过不与本轮失败矛盾。

**修复要求：**恢复正确的 `tools.jackson.databind.ObjectMapper` 依赖注入，并检查构造器一致性。

**关闭条件：**当前工作区 JDK 17 编译通过，后端测试及 H2/PostgreSQL 迁移和启动回归通过；不能通过复用旧 `target/classes` 规避。

### AUD-02 / P1：结露温度来源可关联未授权站点的设备

**类型：静态代码确认的站点边界缺陷；本轮没有执行真实 HTTP 利用。**

[SiteWeatherController](../backend/src/main/java/com/iot/manager/controller/SiteWeatherController.java#L58) 校验请求目标站点后，[SiteWeatherService.updateSettings](../backend/src/main/java/com/iot/manager/weather/SiteWeatherService.java#L162) 直接按 `condensationTemperatureDeviceId` 执行 `deviceRepository.findById`，没有校验该设备是否属于已授权的目标站点。

后续 [surfaceTemperature](../backend/src/main/java/com/iot/manager/weather/SiteWeatherService.java#L507) 会读取关联设备的温度或遥测，参与当前站点风险计算。拥有站点 A 写权限、没有站点 B 权限的用户，如果提交 B 的有效设备 ID，代码路径允许形成跨站点关联；风险说明还会返回露点温差，可间接暴露 B 的温度信息。

**修复要求：**来源设备必须归属当前站点，并完成相应访问校验；拒绝越站、归档或无有效温度能力的来源。对已有异常关联做只读盘点后再处理。

**关闭条件：**同站有效设备允许；仅授权 A 的用户引用 B 时返回明确的 403/404；关联不写入、无外部调用、不产生 B 温度派生结果。覆盖四角色、设备迁站和已有错误关联。

### AUD-03 / P1：生产发现/认领路径可使用演示设备

**类型：静态代码确认的生产数据真实性缺陷。**

[DiscoveryController](../backend/src/main/java/com/iot/manager/controller/DiscoveryController.java#L32) 在指定站点没有已连接 Edge Agent 时调用 `LanDiscoveryService`，该服务没有仅限 dev 的条件。[演示目录](../backend/src/main/java/com/iot/manager/service/LanDiscoveryService.java#L44) 固定为六个 `lan-demo-sensor-*` 候选。

列表只会在站点代码匹配演示站点时显示它们；但认领端点对非 Edge 候选直接进入 [claim](../backend/src/main/java/com/iot/manager/service/LanDiscoveryService.java#L81)，没有把候选的站点与请求站点绑定。知道演示 ID 的合法写用户可将其认领到有权限的站点，并持久化 `CONNECTED`，无需真实发现或现场握手。

这会混淆演示状态、真实发现与实际在线状态，不能作为现场设备接入证明。

**修复要求：**将演示目录和认领路径限制为显式开发/模拟模式。生产无 Agent 时返回无真实候选或明确不可用状态；真实认领必须验证候选所属站点、Agent 和有效期。

**关闭条件：**prod 下六个演示 ID 均不能创建设备；断开的 Agent 不触发演示回退；重新连接后真实候选仍可认领；跨站点认领和重复认领被拒绝。

### AUD-04 / P1：默认拉取版本不包含当前整改和本地 UI

**类型：交付阻断，不是要求绕过审核合并。**

GitHub `main=1bb5075`，整改分支 `93bc58a` 比它多 67 个提交；当前还有 26 个已跟踪文件修改和新增源码未提交。玻璃界面、AI 底部输入、16ms 非遥测合批等本地实现不能由克隆某个现有 SHA 完整重现。

PR #2 处于 `REVIEW_REQUIRED` 且审核记录为空。其主分支保护实际生效，应完成独立审核，而非直接强推。

**修复要求：**先关闭构建和站点边界问题，将本地源码及适合公开的报告整理为明确提交，更新 PR 并完成独立审核。对正式候选冻结 SHA、依赖、构建参数与产物身份。

**关闭条件：**干净克隆候选 SHA 能复现构建与测试；PR 审核合并后默认 `main` 包含获批内容；说明与实际版本一致，安装包可追溯到对应源码和签名。

### AUD-05 / P1：正式发布、恢复和签名治理条件尚未闭环

**类型：实时配置和正式验收阻断。**

本轮治理预检的四项主分支保护检查均 PASS；另外：

| 控制 | 当前结果 |
| --- | --- |
| `r1-recovery-drill` | FAIL：没有保护规则，`can_admins_bypass=true`，部署分支策略为空 |
| `r1-rollback-drill` | UNKNOWN：API 未取得可确认配置，不能按通过处理 |
| `android-release` | UNKNOWN：API 未取得可确认配置，不能按通过处理 |
| 专用恢复 runner | FAIL：GitHub API 返回 `total_count=0` |

默认分支的 Release Integrity Gate 运行总数为 0；查询到的回滚运行只有两条历史 failure。最近普通 P0 成功作业中的 `Immutable 12-service runtime evidence` 为 skipped。[最近整改分支 Quick CI](https://github.com/xxbb11122/IotManager/actions/runs/40974086389) 与 [P0](https://github.com/xxbb11122/IotManager/actions/runs/40974086438) 均属于干净提交 `93bc58a`，不是当前未提交源码。

正式 Android 签名工作流已存在于整改分支，但当前默认分支的 GitHub 工作流列表中未出现它，不能宣称正式签名流程已交付并通过。

**修复要求：**按已批准要求配置独立审核与保护环境，注册隔离恢复 runner，接入真实发布签名及远端存储，在获批候选 SHA 上完成正式不可变 Gate、签名、PITR 和 N/N-1 回滚验收。

**关闭条件：**治理预检全部可确认通过；同一候选身份的正式证据齐全，跳过/取消/历史模拟不计 PASS。保留当前失败关闭策略。

### AUD-06 / P2：两个移动工程各报告三项构建依赖中危

**类型：2026-11-16 官方 npm 审计结果，不是已证明的 App 运行时利用。**

`client` 与 `apps/client-glass-next` 的完整审计各返回 3 项 moderate、0 HIGH/CRITICAL；两个锁文件均包含 `glob 13.0.6`、`minimatch 10.2.5` 和 `rimraf 6.1.3`，且标记为 `dev=true`。`rimraf` 是继承依赖影响，不能将两个项目合并说成六种独立漏洞。

上游公开说明：glob 取消后仍可能继续遍历文件系统，见[维护者公告](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4)；minimatch 模式展开可能放大资源消耗，见[维护者公告](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249)。本地受影响范围判定取自此次 npm 数据库结果，未执行漏洞利用。

**修复要求：**沿兼容的上游依赖链升级并重新锁定，检查 Node 22 兼容性；保留完整审计，不只审计生产依赖。不要未经验证直接跨大版本覆盖整个链路。

**关闭条件：**两个完整审计不再报告相关条目，或有经过审查的适用性处置；Web、Capacitor、Gradle 构建和对应回归仍通过。

证据：[原客户端](../artifacts/audit-20261116/client-npm-audit.json)、[Glass](../artifacts/audit-20261116/apps-client-glass-next-npm-audit.json)。本轮没有重新扫描 Java 依赖及全部容器镜像，不能宣称全项目当前漏洞为零。

### AUD-07 / P2：参考固件在 GPIO 不可用时仍可能回成功 ACK

**类型：静态控制流缺陷；未在实体 nRF52840 上复现。**

[参考固件](../firmware/nrf52840-reference-switch/src/main.c#L54) 将 `result` 初始化为 0，并先把 `power_state` 改为请求值；只有 GPIO ready 且写入失败时才设置错误。当 GPIO 不 ready 时会跳过写入，仍发送成功状态。初始化配置 GPIO 失败时也只记录日志并继续运行。

**修复要求：**维护明确的执行器初始化状态；未就绪或配置失败时拒绝命令。仅在物理写入成功后提交已报告状态，不能让请求值替代硬件结果。

**关闭条件：**模拟 GPIO 未就绪、初始化失败和写入失败均返回失败 ACK，状态不错误前移；正常帧、CRC、token 匹配及实体 LED/负载回读通过。当前代码是参考固件，不能外推为完整工业控制固件。

### AUD-08 / P2：结露风险未验证温度来源的新鲜度

**类型：静态数据质量缺陷。**

[surfaceTemperature](../backend/src/main/java/com/iot/manager/weather/SiteWeatherService.java#L507) 直接取 `device.temperature` 或最后一条遥测，没有检查来源设备是否在线、观测时间是否可信及是否过期。[风险评估器](../backend/src/main/java/com/iot/manager/weather/EnvironmentStatusEvaluator.java#L69) 只要温度非空即可计算，并可能给出绿色“适宜”。

因此，室外天气有效并不代表结露计算所用的现场表面温度有效。设备离线后的旧值仍可能影响当前颜色判断。

**修复要求：**使用来源设备的可信观测时间、质量和时效策略；无有效来源时显示“不可评估/数据过期”，保留旧值及时间供查看。与 AUD-02 分开验证，授权正确不等于数据有效。

**关闭条件：**新鲜、过期、无时间、时钟异常和设备离线场景均有确定结果；来源不可用时不得展示当前“适宜”结论。

## 5. 各方面完成度判断

| 方面 | 当前已有能力 | 仍需关闭的边界 |
| --- | --- | --- |
| 产品定位 | 单组织多站点运维，角色、设备、命令、告警与审计主线清晰 | 继续按试点定位交付；多租户、高可用不是当前已完成能力 |
| 后端与业务 | Profile、命令幂等/ACK、批量操作、遥测和站点访问服务 | 先修 AUD-01；之后重跑完整后端测试与数据库验证 |
| 身份与权限 | OIDC/PKCE、JWT、站点访问校验、原生安全会话存储 | AUD-02 关联边界；真实手机的浏览器登录、深链、退出及网络切换仍需当前包验收 |
| 天气与位置 | Open-Meteo、一次前台定位、缓存/失败保留、环境规则 | AUD-02/AUD-08；真实 GPS、弱网和供应商/备用源条件仍需验收 |
| AI Chat | 后端托管密钥、站点和本人会话、幂等/结果恢复、分页、性格版本、限流/预算 | 当前后端未通过编译；本轮没有调用真实模型，不能将界面模拟当作当前端到端通过 |
| AI 知识库 | 文档、入库及向量迁移代码存在，生产默认关闭 | Embedding 供应商、索引生命周期、真实检索质量、权限/恢复尚未形成正式验收闭环 |
| UI 与刷新 | 89 项页面回归通过；局部补丁、遥测节奏控制、下拉刷新、输入节点保留、动效恢复已有验证 | 本次未做真机刷新闪屏观测、Android 系统键盘及当前 APK 验收；不使用“完全无闪屏”结论 |
| 数据时间与留存 | UTC 时间、兼容迁移、留存 dry-run、锁/续租和 hold 代码存在 | 本轮未重验完整后端、真实历史数据迁移和长期留存；旧模拟不能替代当前库验收 |
| 恢复与发布 | 不可变证据、逻辑/WAL-G 恢复、ABI 迁移与门禁工具较完整 | AUD-04/AUD-05；正式签名、远端 PITR、RPO/RTO 和 N/N-1 回滚证据未关闭 |
| Edge / BLE / 固件 | Edge 7 项测试通过；Shelly 有读回确认；BLE Profile 与参考固件存在 | AUD-03/AUD-07；真实硬件、设备掉电/重启和持续负载需要现场验证 |
| 安全与依赖 | 当前分支有安全扫描与 SBOM；主分支保护实时检查通过 | AUD-06；本轮没有全量镜像/Java 漏洞重扫、渗透或密钥历史扫描 |
| 可维护性与文档 | README 对试点、默认关闭 AI、正式 Gate 有明确说明 | 两套移动端大量复制代码，需持续检查修复一致性；历史验证文档不能作为最新版本总索引 |

关于时区：本次核对了已修复的 `Z` / `+00:00` 归一化代码与客户端回归；还检查了 Java 的带前缀固定偏移。实际公开 Open-Meteo 请求中，`UTC+08:00` 与 `Asia/Shanghai` 均返回 HTTP 200，因此没有将“所有带前缀偏移都会 400”列为缺陷。该只读供应商探测不等于手机定位全链路验收。

关于容量：历史合成负载、CPU 限速和 1,000 条设备数据的页面测量支持继续优化，但不能单独证明 1,000 台真实设备的持续遥测、命令成功率、存储增长、GPU、功耗和全天弱网稳定性。

## 6. 整改优先级和执行标准

| 顺序 | 工作 | 建议负责人角色 | 本阶段完成标准 |
| --- | --- | --- | --- |
| 1 | 关闭 AUD-01，校准开发 JDK/Node | 后端 / 构建维护者 | 当前源码可干净构建，明确使用 JDK 17、Node 22 |
| 2 | 关闭 AUD-02、AUD-03 | 后端 / 安全 | 跨站点设备来源被拒绝，prod 无演示设备认领；有允许/拒绝回归 |
| 3 | 关闭 AUD-08、AUD-07 | 天气后端 / 固件 | 过期来源不报当前适宜，硬件失败不报成功 ACK |
| 4 | 处理 AUD-06，冻结可复现源码 | 依赖 / 客户端 | 审计处置明确，四端构建与针对性回归通过，产物身份可追溯 |
| 5 | 当前 APK 和业务集成验收 | Android / QA | 当前版本的身份、深链、键盘、后台、刷新、GPS/BLE 与弱网结果齐备；模拟与真机分开记录 |
| 6 | 关闭 AUD-04 / AUD-05 | 仓库维护者 / 独立审核人 / 运维 | 获批 PR 合并，保护环境和 runner 就绪，同候选正式 Gate、签名与恢复/回滚证据齐全 |

执行中保留现有权限、签名和发布门禁，不通过关闭检查、复用旧包或把 skipped 计为通过来关闭问题。此次仅完成审核与证据采集，以上整改尚未实施。

## 7. 证据入口和复核边界

本轮原始输出均在 `artifacts/audit-20261116/`，包括构建失败、四端单元和构建、89 项浏览器结果、npm 审计及治理预检。该目录是本地审核产物，不代表已公开到 GitHub。

主要复核入口：

```powershell
# 显式选择 JDK 17 后，仓库根目录执行；当前应复现 AUD-01：
.\mvnw.cmd -f backend/pom.xml -DskipTests compile

# Glass 目录内的本地基础检查：
node --test
npm run build

# 根目录只读查询实际 GitHub 治理：
node scripts/ci/release-readiness-preflight.mjs --repository xxbb11122/IotManager

# 对四个 Web 工程分别执行完整依赖审计：
npm audit --json --registry=https://registry.npmjs.org
```

本次审查没有穷举所有输入、全部接口和全部部署组合，也没有执行付费模型请求、生产数据写入或恢复。静态确认的问题与本轮复现问题已经分别标识；未覆盖项保留为待验收，不补写通过结论。
