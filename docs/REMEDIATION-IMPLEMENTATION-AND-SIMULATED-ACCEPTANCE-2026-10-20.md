# 整改实施与模拟验收报告

日期：2026-10-20（Asia/Shanghai）。承接《测试失败根因与整改方案》。用户要求所有实机项目采用模拟，本轮使用 Android 模拟器、实验签名、合成账号/设备、隔离容器和 Moto S3；不要求提供手机/PDA。

**已完成旧客户端会话修复、供应链升级、VEX 证据机制及模拟复测。正式发布结论仍为 NO_GO：3 项镜像安全门禁和发布治理尚未闭环。**

## 1. 已实施的开发

### 旧客户端会话与启动

配置读取现在区分成功、失败、超时及取消；启动读取使用 1800 ms 有界等待，并以只读方式加载配置。读取未确认时显示恢复入口，保留原加密会话，不保存默认端点，不按默认身份恢复登录，也不发起平台请求。

“重新读取已保存设置”可恢复原身份；配置切换、退出和页面销毁使过期操作失效。配置写入串行化，迟到读取不覆盖新配置；旧明文 token 在读取时剥离，迁移写入须经确认。安装标识读取失败不创建假标识，缓存蓝牙绑定不被当作当前已连接设备。

旧客户端新增启动辅助模块、实际 OIDC 会话组合回归及浏览器恢复用例。严格 CI 已纳入全部 54 项离线页面用例，避免新增用例被旧的文件清单遗漏。Android 仪器测试中的过时模板包名也已纠正。

### 服务与供应链

| 范围 | 实施结果 |
| --- | --- |
| Tomcat | 全部组件对齐 10.1.60，保持 Boot 3.5 兼容线 |
| MCP SDK | BOM 1.0.0，统一 core 与 Jackson 2 模块；AI 启动和模拟供应商契约已验证 |
| Go 工具链 | 1.26.10，重新编译 Caddy、WAL-G、监控及健康探针 |
| Go 模块 | x/crypto 0.57.0、x/net 0.60.0、gRPC 1.83.2；Alertmanager 同步 x/text 0.42.0、x/mod 0.41.0 |
| Prometheus | 保持官方 3.14.0 源码，核实官方模块标签 v0.314.0 对应同一提交；编译后断言真实模块版本 |
| Keycloak | 官方 26.8.1 固定摘要；没有手工替换供应商 JAR |
| Backend 基底 | 更新受维护 Temurin 17/Noble 摘要与系统包 |
| PostgreSQL | 保持 PG16，切换受维护 Trixie 基底，重新编译 pgvector |
| 逻辑备份 | 独立 PG16 客户端镜像，保留实际备份/恢复工具和所需动态库，以 UID 999 运行 |
| 初始化镜像 | Alpine 3.24.2 固定摘要，最终扫描不再报告 EOSL |

发布契约保持 8 个镜像、12 个正常运行服务、1 个恢复新增服务、13 个服务并集；因逻辑备份改为自建镜像，构建目标由 6 改为 7，schema、bake、清单、CI 和契约测试同步更新。

回退兼容模式允许历史候选的精确 6 构建/2 外部镜像来源映射；正常候选仍必须是 7 构建。已验证旧格式在默认模式拒绝、显式回退模式接受、错误来源映射拒绝，并用实际 `62b0938` 历史清单验证格式兼容。该历史样本自身扫描失败，不能把格式校验 PASS 解释为已批准的 known-good 发布。

### 恢复实验与安全证据

新增显式 `docker-compose.integration.s3.yml`，由 `IOT_INTEGRATION_STORAGE_MODE=s3` 选择，启动、验证和摘要检查一致应用该覆盖文件。普通 integration 默认仍使用 filesystem；S3 实验不再改写原 Compose 文件。

新增 VEX v2 schema 与证据校验，明确区分 `not_affected`、`fixed` 和原有风险接受。绑定源码、CVE、artifact、精确 digest、证据 SHA-256、有效期及独立评审引用。错误摘要、过期、自批、缺证据和失败检查均拒绝。具体边界见《SECURITY-VEX-EVIDENCE-DEVELOPMENT-2026-10-20》。没有创建任何已批准的生产 VEX。

新增 Spring 运行上下文检查，在 AI/知识库开启的配置下枚举实际路由、视图和 MCP Bean，验证接口 JSON/SSE 协商。另对最终 PostgreSQL 镜像增加 WAL-G 加密拒绝探针，结合上游修复祖先关系核查疑似版本误识别。

## 2. 已完成的客户端与本地验证

| 验证 | 结果与边界 |
| --- | --- |
| 旧客户端单元 | 252 PASS，0 FAIL，0 skipped |
| 原失败对照 | 配置成功时正常恢复；配置读取拒绝时会话保留、默认配置写入 0 次、删除 0 次；源码干净 |
| 本地浏览器全套 | 54 PASS、8 skipped；8 项需要隔离服务，不能计入本地通过 |
| 发布工具与 VEX | 17 个 Node runner 条目通过；额外 CLI 契约验证 v2 能接入扫描并拒绝错误源码 |
| Spring 适用性 | 新增 4 项 PASS；初次夹具缺 embedding model 名称，修正后通过 |
| MCP 升级兼容性 | 16 项 AI 配置/契约测试 PASS；完整 Backend 回归见 CI 记录 |
| Android 仪器 | API36 模拟器，旧客户端 1 项安装上下文检查通过 |
| Android 故障注入 | 7 项 PASS：读取延迟/拒绝各自保留会话并通过公开重试恢复；两次系统返回取消登录；定位权限拒绝 |
| 实验签名 Release | 干净源码 `42ab42bd62b5746e286a09748f60f59b5bd241eb`，APK/AAB 构建成功，SDK 验签通过 |
| 正常覆盖升级 | 24→25，UID、首次安装时间、Preferences 和 Keystore 数据保持，旧业务代码写入数据可读，未清数据/强制降级 |

故障注入 APK 使用独立包 `com.iot.manager.client.simlab`，仅隔离副本覆盖原生 Preferences 插件，生产业务 JS 不变。第一次驱动误用 Glass 的 HTML 启动属性，第二次注入注册顺序被自动插件覆盖；调整测试驱动和隔离注入时机后，上述 7 项完成。测试专用注入器未进入生产源码。

Release APK 的 SHA-256 为 `3a23a8b548353ac43027846d05d3595b9d5114c8d771f66696bb5a235fd74b28`，AAB 为 `0a6f388a5929fd07350b853adfe6dbf7c9f827544c8d1f4be06d7c80feb8d95e`。AAB 的 JAR 签名完整性及证书指纹也已核对；实验自签证书链不受系统信任，符合该模拟夹具的边界。两者是实验室证书签名、不可调试的正常 Release 构建，不是生产分发包。

## 3. 最终镜像扫描

候选源码：`0811f80ac849887b3a67e291d274e6e5a10e4d70`。候选 ID：`r1-rc-remediation-20261020-0811f80ac849`。

[镜像构建与扫描 39432044123](https://github.com/xxbb11122/IotManager/actions/runs/39432044123)：7/7 构建完成，8/8 扫描器正常退出；原始报告摘要、候选身份、清单摘要及目标 digest 均已校验。

| 镜像 | HIGH | CRITICAL | 有 FixedVersion | 无 FixedVersion | 门禁 |
| --- | ---: | ---: | ---: | ---: | --- |
| R01 Backend | 0 | 4 | 4 | 0 | FAIL |
| R02 Caddy | 0 | 0 | 0 | 0 | PASS |
| R03 Keycloak | 0 | 0 | 0 | 0 | PASS |
| R04 PostgreSQL/WAL-G | 62 | 1 | 1 | 62 | FAIL |
| R05 Prometheus | 0 | 0 | 0 | 0 | PASS |
| R06 Alertmanager | 0 | 0 | 0 | 0 | PASS |
| R07 逻辑备份 | 43 | 0 | 0 | 43 | FAIL |
| R08 初始化 | 0 | 0 | 0 | 0 | PASS |
| 合计 | 105 | 5 | 5 | 105 | 5 PASS / 3 FAIL |

原基线 302 条/81 个唯一 CVE，本轮为 **110 条/21 个唯一 CVE**。条目按“镜像/包/CVE”计数，不能当作 110 个独立漏洞。所有镜像 `EOSL=false`。没有降低扫描门槛、全局忽略 CVE 或删除扫描元数据。

剩余分为三组：

1. Backend 的 4 条对应 Spring 3 个 CVE：47884、47890、47892。运行上下文测试提供适用性证据，仍待独立审核。保留 Boot 3.5/Framework 6.2；没有强行混入 Framework 7。[Spring 公告](https://spring.io/security/cve-2026-47890/)列出的 6.2.20 为企业支持线，不能假设拥有该补丁来源。
2. WAL-G 的 1 条为 CVE-2021-38599，扫描器根据主模块伪版本识别。上游修复祖先和最终二进制的两种加密拒绝行为均已验证，通过的证据已形成草稿；没有独立批准，门禁继续 FAIL。另实际验证了这份未批准草稿被 VEX 校验器拒绝，不能仅凭技术测试或版本文本放行。[上游修复](https://github.com/wal-g/wal-g/pull/1062)
3. PostgreSQL/备份共 105 条没有该稳定发行版修复版本的 OS 条目，涉及 util-linux、systemd 库、libxml2、ncurses、ACL、GnuPG/Perl 等。不能视为已修复。例如 Debian 仍将 Trixie 的 [CVE-2026-76642](https://security-tracker.debian.org/tracker/CVE-2026-76642) 和 [CVE-2026-16742](https://security-tracker.debian.org/tracker/CVE-2026-16742) 标为 vulnerable；不把不稳定发行版的软件包混装到候选中。

## 4. CI、运行与恢复结果

| 运行 | 结果 |
| --- | --- |
| [Quick CI 39432721776](https://github.com/xxbb11122/IotManager/actions/runs/39432721776) | PASS。Backend 198、Edge 7 在 UTC/Asia-Shanghai 两个时区均 0 失败/错误/跳过；旧端 252、Glass 257 单元通过；严格页面共 133 项通过（旧端 54、Glass 77、前台/控制台各 1），0 skipped |
| [最终候选隔离实验 39432996157](https://github.com/xxbb11122/IotManager/actions/runs/39432996157) | PASS。使用扫描清单中的实际 digest，12 服务及 13 服务并集一致；64 MiB/32768 行清理后 PITR，行数和指纹一致，基础恢复读写及目标点隔离检查通过 |
| 同一隔离实验的拒绝与清理 | 错误源码、篡改清单、已有恢复卷、损坏备份均拒绝；容器/卷/网络清理通过 |
| 同一实验的 WAL-G 探针 | 最终 R04 digest 包含上游修复历史；实际 `wal-push` 对内联 key 和 key 文件均明确拒绝不支持的 libsodium，加密不静默降级 |
| 同一实验的 Alertmanager | 内部告警生命周期模拟 PASS，未发送外部通知 |
| [扩展运行 39431963312](https://github.com/xxbb11122/IotManager/actions/runs/39431963312) | PASS。8 场景/10 次执行，0 失败/跳过；PKCE/四角色/API/WSS、模拟 AI 供应商、1000 设备/100 条认证 WebSocket、实际 N→N-1→N 业务读写均通过 |
| 扩展负载及回退细节 | 共 100000 条 WebSocket 消息，1000 设备创建及清理均 0 失败；新旧后端使用同一数据库，迁移摘要不变，恢复 N 使用原来的 N 镜像 |

最终镜像清单 SHA-256：`219074d256f51bc3556c7d517c7db0621fc9cfc8133f5ffd9859c12a8d6c43c5`。模拟恢复时间约 9.85 秒，只适用于本次 64 MiB 实验，不作为生产 RTO 承诺。扩展回退使用不同开发提交，未冒充正式批准版本的回退验收。

Quick CI 的测试工具源码为 `832d1a5`，镜像/运行/恢复候选为 `0811f80`；后续差异为验证脚本。Release APK 源码为 `42ab42b`，已核实旧客户端业务及原生主源码与最终镜像候选检出一致。各证据保留自己的源码身份，没有把不同源码记录改成一个 SHA。

中间候选 `42ab42b` 的恢复组件也通过，但 [39431477554](https://github.com/xxbb11122/IotManager/actions/runs/39431477554) 整体 FAIL：最初加密探针误用不触发加密的 `backup-list`。改为 `wal-push` 后，最终候选完整工作流 PASS。构建早期的 x/net→x/crypto→x/text/x/mod 显式版本冲突也已按模块声明解决，并以最终构建和扫描结果复验。

[普通 P0 39431963265](https://github.com/xxbb11122/IotManager/actions/runs/39431963265) 也已 PASS：非 root/能力限制、数据库 DDL 拒绝、重启持久化、后端故障就绪保护、独立项目逻辑备份恢复及真实服务浏览器认证检查完成。正式模式专用任务不适用于本次独立模拟运行，其 skipped 不计通过；不可据此宣称正式 Release Gate 已运行。

## 5. 发布边界与后续处置

按用户要求，目标硬件、现场设备和存储相关验收本轮均采用模拟。模拟验证说明业务和保护逻辑在已测试环境中的行为；本轮正式发布的直接阻断是仍有 3 项镜像门禁 FAIL，以及真实发布治理证据不足。

本轮只读治理预检为 **5 FAIL、3 UNKNOWN**：默认分支保护、必需 quick-gate、独立评审、恢复环境和专用恢复 runner 尚未符合要求；管理员绕过与另两个保护环境证据不足。完整配置/拒绝行为已有合成快照测试，但不会用模拟 PASS 覆盖仓库真实状态。

剩余处置应按以下顺序进行：

1. 独立审核 Spring/WAL-G 的 digest 绑定证据；只有审核确认后才能在受保护流程中形成有效 VEX。
2. 对 105 条 OS 记录按实际功能逐 CVE 研判。能够证明不适用的准备证据；确实受影响的选择供应商补丁、受支持替代基底或明确限时风险接受，并重跑数据库/备份/恢复。不可只填审核人名字放行。
3. 仓库管理员落实 8 项治理控制：必需检查、禁止强推/删除和绕过、独立评审、保护环境、专用恢复 runner。当前权限与资源证据不足的项目保持 UNKNOWN/FAIL。
4. 以新的同一 SHA/候选/digest 执行正式发布链和独立批准。本轮没有合并 PR、发布版本或部署生产。

实验签名文件沿用已有受限本地目录，未上传。此前自动审批拒绝删除该目录中的签名文件，只有 `blocked by policy` 原因；本轮未绕过该限制或宣称已删除。Android 模拟器已停止。

## 6. 证据位置

本地根目录：`E:/CC_testP/iot-manager/artifacts/implementation-20261020/`。

关键文件：`legacy-session-after-fix.json`、`client-unit.log`、`client-browser.json`、`native-fault-results.json`、`client-release-update.json`、`spring-applicability.log`、`release-tools-final.log`、`vex-final.log`、`scan-summary-0811f8.json`、`scan-findings-0811f8.csv`、`images-0811f8/`、`scans-0811f8/`、`immutable-0811f8/`、`runtime-eight-0811f8/`、`quick-ci-832d1a/`、`vex-drafts/`、`legacy-rollback-manifest-validation.json`、`governance-preflight.json`、`acceptance-summary.json`。

本轮验收汇总和待审草稿明确 `productionApproved=false`；组件报告只表示对应测试的结果。工作流取消和 skipped 不计通过。GitHub 运行保留相应公开测试证据，私钥、口令、AVD 用户数据不进入仓库。
