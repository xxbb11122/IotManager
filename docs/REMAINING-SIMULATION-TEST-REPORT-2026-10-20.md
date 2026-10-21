# 未完成测试的模拟补测与发布评估

执行日期：2026-10-20，Asia/Shanghai。证据目录：`artifacts/remaining-simulation-20261020/`。

**当前结论：NO_GO。** 本轮已补测原生存储异常、浏览器取消、实验签名、覆盖升级、低性能启动、服务故障、不可变镜像及内部告警。旧客户端仍存在配置读取失败后误清会话的 P1 缺陷；8 个镜像中 7 个未通过漏洞门禁。模拟通过不能替代正式证书、目标硬件、生产存储及独立发布批准。

**补测状态：已完成本轮已识别缺口中可在隔离环境执行的模拟，结果包含失败。** 未将真实设备、正式签名、生产 IAM 或正式批准改记为通过；机器汇总保持 `allTestsPassed=false`、`productionApproved=false`。

失败调用链、镜像包版本、潜在误识别、整改顺序和复测关闭标准见[测试失败根因与整改方案](TEST-FAILURE-ROOT-CAUSE-AND-REMEDIATION-2026-10-20.md)。其中待研判项目尚未批准，不改变本报告的失败门禁结论。

## 1. 被测对象与身份

| 对象 | 精确身份与边界 |
| --- | --- |
| 两端 App 业务基线 | `de263fa58a1d282a2d56e9e0594e73bd0c697a8c`；本轮生产 App 的 JS、Java 主程序和构建配置未改动 |
| App 兼容旧版 | `928b72345b8f65dbfa18a042a99eaf0901cda6ad`；用于模拟业务版本回退，未冒充已批准生产版本 |
| 不可变镜像候选 | `62b0938abdde6591489d2e4a912b709a33f5a1fa`，ID `r1-rc-simulation-20261020-62b0938abdde` |
| 镜像清单 SHA-256 | `e80a36a30f134425e0514dd0dda97fd008b60a09575871e771e2150262fc64e2` |
| 最终实验驱动及严格 CI | `37d2fb704a973fafe9f64a1d788366e51526fbad`；后续本报告归档不重新标记已有产物身份 |
| 原生异常包 | `com.iot.manager.glassnext.simlab`；独立 Debug 副本，仅该副本添加 Java Preferences 故障注入 |
| 安装环境 | 专用 Android API 36 模拟器 `IotRemainingTests / emulator-5562`，与用户设备分开 |
| 签名环境 | 两日有效的临时实验 RSA 证书；APK/AAB 的 `productionApproved` 均为 `false` |

测试驱动和发布工具的后续提交另行记录，不把旧 APK、旧镜像标成后来提交构建。仓库内保留诊断与实验流程；密钥、安装包、原始日志及模拟器数据不提交 Git。

## 2. 已识别缺口的补测结果

| 缺口 | 本轮执行结果 | 仍需真实验收的部分 |
| --- | --- | --- |
| Android 存储延迟、拒绝读取 | **通过**：真实插件桥接注入 3,000 ms 延迟/读取拒绝；配置未确认时保留加密会话、无平台请求，迟到结果不激活端点，公开重读入口恢复认证访问 | 实体设备存储和操作系统差异 |
| 用户关闭登录浏览器 | **通过**：两次真实登录入口打开 Chrome，分别一次 Android 返回键取消；事务清理、无令牌交换、可再次登录 | 目标设备浏览器、首次提示及正式 HTTPS/身份提供方组合 |
| 原生权限拒绝 | **通过**：模拟器系统固定拒绝定位权限，插件返回 `OS-PLUG-GLOC-0003` | 实际 GPS/BLE 信号、配对、权限策略和现场设备联调 |
| 低性能及模块加载异常 | **4 项通过**：4×/8× CPU 降速、模块迟到、模块加载失败；恢复入口可见，重新加载成功 | PDA 实际 CPU/GPU、温升、长时运行和厂商 WebView |
| 两端可信构建校验 | **通过**：实际 SDK/JDK 验证 APK/AAB；源码、版本、证书、不可调试及禁止明文网络均满足实验信任配置 | 正式证书、正式分发与应用商店流程 |
| 正常覆盖升级与兼容回退 | **通过**：Glass code 20→21→22；旧客户端 20→21→22，另以 22→23→24 补齐旧版写入后返回新版读取 | 真实分发渠道、正式签名与目标硬件升级 |
| 签名及包完整性负向检查 | **9 项通过**：两端各验证信任指纹不符、另一有效签名者、APK 篡改、AAB 篡改；另验证 Debug APK 不能作为发布包 | 正式密钥保管与批准流程 |
| 服务、认证、负载与回退 | **通过**：新跑 8 场景/10 次执行，含实际 Keycloak/SQL、四角色、生命周期、短时负载及同库不同开发镜像 N→N−1→N | 生产身份、批准的容量/SLO 和正式已批准版本回退 |
| 不可变运行态 | **12/12 通过**；实际拉取清单中的 digest，验证每个运行服务及一次性初始化任务；错误来源 SHA、清单摘要变化均被拒绝 | 扫描通过及完整正式 Release Gate |
| 物理恢复与清理后恢复 | **通过**：小库恢复及 64 MiB/32,768 行清理后 PITR；数据指纹一致、源/候选/恢复 Flyway 28，运行与恢复服务合并 **13/13**；已有卷与损坏备份均拒绝 | 生产存储 IAM、代表性容量、完整业务恢复计时与批准的 RPO/RTO |
| 内部告警生命周期 | **6 项通过**：原 R1 配置加载、活动告警、静默、静默到期、恢复状态及错误时间格式拒绝 | 真实值班人员响应与运维签认 |
| 固件构建 | **通过**：Zephyr 3.7.2 / SDK 0.16.8，nRF52840 交叉编译与 4 份产物校验 | 烧录、射频、功耗和实体设备行为 |
| 镜像漏洞扫描 | **已执行，未通过**：8 项均完成扫描，7 FAIL、1 PASS；不是“扫描未运行” | 修复或经批准、带期限的有效 VEX；重新构建并扫描 |
| 旧客户端配置失败恢复 | **已执行，未通过**：真实 `main.js` 和 OIDC 管理器的对照复现确认有效会话被清除 | 整改旧客户端后补对应集成及原生回归 |

不同层级存在重复覆盖，不将这些数字累加成“业务总通过数”。此前已完成的 Glass 257 项单元、严格页面 77 项及两轮各 18 项原生检查保留其原始身份；本轮新增项目单独列示。

### 原生与构建细节

原生补测共 7 项通过。3 秒延迟时约 **3,943 ms** 显示配置恢复状态；拒绝读取时约 **2,231 ms**。保留原有可选读取和原生启动时限，未延长预算取得通过。HTTP/OIDC fixture 仅在回环地址运行，匿名业务请求仍拒绝；没有调用真实 AI 供应商。

浏览器 4×/8× 降速启动约 **1,444/3,435 ms**；模块迟到约 **7,578 ms** 显示重载入口，模块失败约 **73 ms** 显示恢复入口。此为桌面 Chromium 降速实验，不作为实际 PDA 性能数据。

Release 数据回归使用与目标包相同实验签名的**独立仪器测试 APK**，访问未改动、不可调试的发布版 WebView；没有打开 CDP 或加入生产测试入口。Android 正常更新保持 UID 和首次安装时间。Glass 的实际 N/N−1 `CacheRepository` 在独立测试数据库验证 schema 3 和读写连续性；旧客户端验证实际 Preferences/Keystore，并额外验证旧业务代码写入后新版读取。

| 最终实验产物 | APK SHA-256 | 网页资源核对 |
| --- | --- | --- |
| Glass `1.1.4-glass.6-simulation / code 22` | `8b5e523b87e268a276618817939e89d01e0bda42a736e3a032a76d61dfffb5a3` | 14 个 dist 文件 + 2 个 Capacitor 生成文件逐一匹配 |
| 原客户端 `1.1.4-simulation / code 24` | `5a75721fa744de85e5b96768eeb6b2489ddbae32cc6f100c3e8ce9b83b28f032` | 12 个 dist 文件 + 2 个 Capacitor 生成文件逐一匹配 |

两端内嵌源码均为 `de263fa...`、`dirty=false`；实验签名指纹为 `78110d572fd41ab722c182391217f9b667248c2336d93ee26b75f326226a9094`。系统实际拒绝换证书覆盖安装、版本号降级和发布包 `run-as` 调试。没有清空数据或使用强制降级完成往返测试。

### 服务、负载及恢复

新跑短时负载：1,000 台设备、25 请求并发、100 条认证 WebSocket、100,000 条消息；创建和 WebSocket 错误均为 0。创建 p50/p95/p99 为 **767/921/1,240 ms**，约 **33.23 次/秒**；1,000 台测试设备均归档，临时容器/卷清理通过。

小库 S3 实验实际完成基础备份、WAL 重放、点前标记恢复、点后标记排除及提升后 SQL 写入，源/恢复 Flyway 均为 28。标记年龄 **8 秒**、数据库恢复 **9 秒**；不是生产持续 RPO 或整套业务 RTO 保证。

64 MiB 扩展恢复前两轮均失败：取回基础备份后缺少起始 WAL，180 秒内未就绪。根因是 **integration 测试覆盖层将归档硬编码到文件仓库，手工基础备份却写入 S3**，单纯修改环境变量不能覆盖该 YAML 配置。最终实验在源 PostgreSQL 初始化前建立同一 S3 仓库，显式将 integration 覆盖层的三处文件模式改为 S3，校验运行容器的实际存储参数，并等待首份定时备份后建立新 WAL 边界。`storage-fixture.json` 保存修改前后摘要；这是明确改动的测试 fixture，未改冻结镜像、生产 Compose 或恢复算法。

最终运行 [39390895513](https://github.com/xxbb11122/IotManager/actions/runs/39390895513) 实际执行了以下检查：

1. 写入 **32,768 行、67,108,864 字节逻辑负载**，生成基础备份和 WAL；初次 PITR 的源/候选/恢复 Flyway 均为 **28**，点后标记被排除，提升后 SQL 写入通过。标记年龄 **9 秒**，数据库恢复 **9 秒**。
2. 将源表 `TRUNCATE` 至 **0 行**，在第二个全新目标卷恢复到此前的点，恢复 **32,768 行**，字节数及数据指纹 `804d89e53fc43e8c6954330974e2c80e` 与清理前完全一致；此次数据库恢复约 **9.80 秒**。
3. 实际容器摘要核对为运行态 **12/12**、新增恢复服务 **1/1**、合并 **13/13**，无缺失、未知或无效服务。S3 对象清单同时包含选定基础备份和重放所需的 `00000001000000000000000B` WAL。
4. 对已有恢复卷再次执行演练被拒绝；损坏选定备份 sentinel 元数据后，全新目标恢复失败且检出解析错误，随后恢复原元数据。错误来源 SHA 和篡改镜像清单两项负向检查也通过。
5. 源服务、S3 fixture、三个恢复项目及所属卷/网络清理通过。内部告警 6 项亦在该运行重新通过。

这些数据来自 GitHub 临时 runner、Moto S3 和合成负载；**9/9.80 秒仅为数据库实验计时**，不代表生产容量、持续 RPO 或全业务 RTO。前两轮失败原始证据继续保留。

## 3. 两项已确认的发布阻断

### 旧客户端仍会误清登录会话

新增诊断直接执行旧客户端 `client/src/main.js` 的实际函数体和实际 `OidcSessionManager`，只替换存储、网络和 UI 边界，不访问真实账号。

| 已保存配置读取 | 会话保留 | 删除的 key | 连接配置写入 |
| --- | --- | --- | --- |
| 成功 | 是，正常恢复认证 | 无 | 1 次 |
| 拒绝/失败 | **否** | session、transaction 两个 key | **1 次默认端点保存** |

保留会话的预期断言失败，诊断 exit 1。**Glass 对应修复没有自动覆盖旧客户端。** 旧客户端若在发布范围内，必须修复“配置未确认”门控、禁止默认配置覆盖、公开重试及迟到结果隔离，并保持真实身份变更时原有的会话清理。

复现入口：

```powershell
node scripts/validation/legacy-session-probe.mjs --output artifacts/remaining-simulation-20261020/legacy-session-final-probe.json
```

当前预期出现会话保留断言失败，不能将“诊断成功发现问题”计为产品测试通过。

### 镜像安全门禁未通过

| 镜像 | HIGH 条目 | CRITICAL 条目 | 状态 |
| --- | ---: | ---: | --- |
| IMG-R01 Backend | 3 | 7 | FAIL |
| IMG-R02 Caddy | 6 | 0 | FAIL |
| IMG-R03 Keycloak | 19 | 4 | FAIL |
| IMG-R04 PostgreSQL/WAL-G | 98 | 15 | FAIL |
| IMG-R05 Prometheus | 10 | 0 | FAIL |
| IMG-R06 Alertmanager | 9 | 0 | FAIL |
| IMG-R07 逻辑备份镜像 | 115 | 16 | FAIL |
| IMG-R08 卷初始化镜像 | 0 | 0 | PASS |

共 **260 个 HIGH、42 个 CRITICAL 扫描条目**，跨镜像去重后 **81 个阻断 CVE ID**。条目数量与唯一漏洞数是不同口径。8 个扫描进程均正常完成，门禁根据报告判定失败；没有降低严重性阈值、禁用扫描或伪造 VEX。

整改应先按报告中的包、运行路径与修复版本更新基础镜像、运行时和工具链，再重新固定 digest、构建 SBOM/provenance 并扫描全部 8 项。确实不受影响或需要临时接受的项目，走已有带依据、批准人和期限的 VEX 流程。当前结果不能由源码安全扫描通过覆盖。

## 4. 为实际执行测试修复的工具问题

| 问题 | 修复及验证 |
| --- | --- |
| 默认 Buildx 驱动不支持所需 attestations | 显式创建 `docker-container` builder，保留 provenance/SBOM；6 个构建随后实际推送成功。[Docker 官方说明](https://docs.docker.com/build/metadata/attestations/) |
| 首次构建没有元数据父目录 | 调用 Buildx 前创建目录；增加实际 CLI 子进程边界回归，真实构建已通过 |
| 复用工作流用 `event_name=workflow_call` 选错分支 | 改用必需的布尔 `release_mode`；按实际调用方 push/dispatch 事件校验，并保留来源、工作流、调用方与运行绑定。[GitHub 官方说明](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations) |
| producer 身份误用调用方及独立运行被标成编排 | 固定本地复用工作流自身路径与对应工作流 SHA；独立 dispatch 标为 fallback；正式门禁继续拒绝独立 fallback 冒充编排证据 |
| `--verify` 直接执行无执行位的脚本 | 改为显式 Bash 调用；冻结的旧候选实验只补执行位，不改脚本内容 |
| digest 检查漏启用 application/observability profiles | 检查器显式启用两个 profile；冻结旧候选实验通过对应 Compose 环境配置验证实际 12 个服务 |
| 扩展恢复基础备份与 WAL 分属两个仓库 | 修正实验 integration 覆盖层的存储选择，记录前后摘要并检查实际容器环境；64 MiB 清理后恢复及两项恢复拒绝检查实跑通过 |

发布工具回归 **16 个 Node runner 条目通过、零跳过**，其中包括脚本包装条目；工作流 actionlint 及 Bash/Node 语法检查通过。事件矩阵属于本地条件与信任校验模拟，未冒充正式 Release Gate 已运行。

8 项扫描来自独立实验 dispatch；早期逐镜像 JSON 的 invocationMode 字段仍为旧标签，后续代码已修正。它们没有正式调用方/最终 stage 交接且扫描失败，不能作为正式编排发布证据。

## 5. CI 与本地证据

| 执行 | 结果 | 证据 |
| --- | --- | --- |
| 新跑 Extended lab，App 基线 de263 | success | [39381980442](https://github.com/xxbb11122/IotManager/actions/runs/39381980442) |
| 新跑普通完整 P0，de263 | success，正式不可变分支 skipped | [39381984937](https://github.com/xxbb11122/IotManager/actions/runs/39381984937)；同 SHA 的 [39379496523](https://github.com/xxbb11122/IotManager/actions/runs/39379496523) 亦成功 |
| 8 项实际镜像扫描，62b0938 | **failure：7 项漏洞门禁失败** | [39384244657](https://github.com/xxbb11122/IotManager/actions/runs/39384244657) |
| 12 服务及内部告警，驱动 d0e1a7b | success | [39387793740](https://github.com/xxbb11122/IotManager/actions/runs/39387793740) |
| 扩展物理恢复首轮，驱动 db3211e | failure，起始 WAL 缺失 | [39388630662](https://github.com/xxbb11122/IotManager/actions/runs/39388630662) |
| 扩展物理恢复第二轮，驱动 b74e1aa | failure，integration 覆盖层仍指定文件仓库 | [39390090071](https://github.com/xxbb11122/IotManager/actions/runs/39390090071) |
| 最终不可变恢复与告警，驱动 37d2fb7 | **success**，12+1 服务、64 MiB 清理后 PITR、拒绝检查及告警均通过 | [39390895513](https://github.com/xxbb11122/IotManager/actions/runs/39390895513) |
| 最终严格 Quick CI，37d2fb7 | **success** | [39390902269](https://github.com/xxbb11122/IotManager/actions/runs/39390902269) |
| 最终普通 P0 push / PR，37d2fb7 | **success / success**，正式不可变分支均 skipped | [39390895467](https://github.com/xxbb11122/IotManager/actions/runs/39390895467)、[39390902436](https://github.com/xxbb11122/IotManager/actions/runs/39390902436) |

最终 Quick CI 的结构化结果：Glass 单元 **257**、旧客户端单元 **230**；严格 Playwright **118**（frontend 1、console 1、旧客户端 39、Glass 77），均零失败、零错误、零跳过。Backend **194**、Edge **7** 在 UTC 和 Asia/Shanghai 两个矩阵分别通过。其 PR 合并预览 `fa79f4d50ea839c1f66ad77d325d05153fc112b8` 与被测驱动 `37d2fb7` 的 Git tree 均为 `583d5d57d5b1144c10330ca7938edf7309aefcd0`，已核对一致。已有单元和页面套件未覆盖本轮新增的旧客户端配置失败对照，故 CI 绿色不能关闭该 P1。

本地关键文件：

- `native-fault-results.json`：7 项原生异常和取消检查。
- `browser-startup-stress.json`：4 项降速/加载恢复检查。
- `glass-final-release-identity.json`、`client-final-release-identity.json`、`final-release-assets.json`：SDK 身份与全部网页资源摘要。
- `glass-signed-roundtrip.json`、`client-signed-roundtrip.json`、`client-rollback-write-supplement.json`：正常更新、系统拒绝与数据连续性。
- `android-signature-negative.json`：9 项 SDK/JDK 负向检查。
- `legacy-session-final-probe.json/.log`：旧客户端的失败对照与源码摘要。
- `image-security-final.json`、`image-security-ci/`：全部 8 项安全报告及清单身份。
- `extended-ci/`、`p0-ci/`、`immutable-pass-ci/`：服务、固件、恢复、负载、运行态及告警原始结构化证据。
- `immutable-recovery-first-ci/`：扩展恢复首轮失败、恢复日志和清理结果。
- `immutable-recovery-second-ci/`、`immutable-recovery-final-ci/`：第二轮失败及最终 S3 fixture、64 MiB 数据/恢复、13 服务、负向和清理证据。
- `quick-final-ci/`、`p0-final-ci/`、`final-ci-runs.json`：最终严格 CI、普通 P0 与运行身份快照。
- `simulation-summary.json`、`simulation-evidence-index.json`、`finalize-simulation.mjs`：断言核验后的汇总、公开证据摘要及生成入口；记录一致性通过不等于产品全绿。
- `governance.json`、`local-cleanup.json`：只读治理状态和本地清理边界。

首次原生驱动也保留了模拟器 CRLF、窗口焦点查询及原生缺失值表示的准备错误；签名仪器日志曾将 System.out 误当标准输出，已改从 logcat 提取。产物资源核对也区分 dist 与 Capacitor 自动生成文件。以上均修复测试读取方式后重新执行，没有修改产品断言或把未执行项计为通过。

## 6. 正式发布前仍未闭环

治理预检仍为 **5 FAIL、3 UNKNOWN、0 PASS**。未知项保持未知，不当作已不存在，也不当作已通过。

必须关闭：旧客户端 P1（若纳入交付）、7 项镜像安全失败、默认分支独立评审和保护、正式不可变发布证据、可信正式签名/分发、目标手机/PDA/BLE 验收，以及生产存储 IAM、批准数据规模与完整业务恢复、灰度/停止条件和运维签认。

本轮使用原 R1 的内部告警查看配置，未增加外部通知要求。AI/知识库保持生产关闭时可在发布单明确其范围；本轮 fixture 不替代真实供应商验收。R2 的 24 小时、Redis/mTLS 等项目未被额外设为 R1 门槛。

专用模拟器和本机 fixture 端口已关闭。自动审批两次拒绝删除临时实验 keystore 和口令文件，工具仅返回 **`blocked by policy`**；未绕过拦截。两份文件仍留在 `artifacts/remaining-simulation-20261020/private/`，目录关闭继承、仅当前用户与 SYSTEM 可访问，未提交或上传；另已添加目录内 `.gitignore` 并验证两份文件均被 Git 忽略。公钥证书已单独保留。该清理项保持未完成。
