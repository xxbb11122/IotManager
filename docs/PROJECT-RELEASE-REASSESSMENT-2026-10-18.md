# IoT Manager 全项目复测与正式发布复评

被测源码：`65d462d1a019c31061e74c0728fe3f6989d71edc`，分支 `codex/glass5-remediation`。

执行日期：2026-10-18，Asia/Shanghai；精确执行时间见证据文件中的 UTC 时间戳。

**结论：NO_GO，当前不能正式发布使用。** 本轮确认了一个新的 P1 登录恢复缺陷；同时，正式发布治理、不可变产物、真实签名/硬件和生产恢复证据仍未闭环。工程测试的大部分结果通过，不能覆盖这些阻断项。

本轮重新执行本地测试和隔离 CI，核对当前提交的严格 CI，并对原生失败继续定位。没有修改业务源码或部署配置，没有合并 PR、部署生产、变更仓库保护或操作现场设备。本报告是新的正式发布评估；上轮模拟验收报告保留为历史记录，其单次通过结果不能覆盖本轮失败。

## 1. 发布阻断项

| 编号 | 状态 | 证据与影响 | 关闭标准 |
| --- | --- | --- | --- |
| P1-SESSION | **新缺陷，已确认** | 端点配置读取超时后，用默认端点恢复已有会话；身份不匹配分支清除了原本有效的加密会话。原生复测出现退出登录及恢复遮罩阻挡导航 | 超时/失败/取消读取不能用未经确认的默认身份清除会话；补真实认证管理器集成回归及原生冷启动验证 |
| GOV | **FAIL** | 只读治理预检：5 项 FAIL、3 项 UNKNOWN，无 PASS；候选比默认分支领先 20 个提交 | 完成默认分支评审、必需检查、受保护发布环境和专用恢复 runner，预检全部 PASS |
| REL | **未验收** | 当前候选没有合格的 Image Security / Release Integrity Gate 完整证据；普通 P0 的不可变 12 服务分支为 skipped | 冻结同一候选 SHA/release ID/digest，执行全量镜像扫描、SBOM/provenance、不可变运行态和最终证据门禁 |
| APK/HW | **未验收** | 本轮使用 Debug APK；历史实验签名不能代替正式证书。正式 Android 签名工作流当前未注册；目标手机/PDA/BLE 和原生 HTTPS/OIDC/WSS 尚无本候选完整证据 | 正式可信签名及分发升级验证；目标设备完成登录、权限、控制、弱网、后台和生命周期验收 |
| REC | **模拟通过，正式未验收** | Moto S3、小型实验库的物理恢复通过；没有真实存储 IAM、清理后恢复、代表性数据量及完整服务恢复计时证明 | 在受控恢复环境完成真实备份/WAL、业务读写探针、清理后 PITR、业务批准的 RPO/RTO |
| OPS | **未签认** | 短时负载不能证明已批准的现场容量、清理期间性能和运维处置能力 | 冻结业务负载/SLO，补监控告警、恢复联系人、密钥轮换、灰度与停止/回退条件及相应实测 |

上述“未验收”表示没有足够证据，不能据此断言对应实现一定有缺陷。P1-SESSION 则已通过对照测试确定，属于代码需要整改的问题。

## 2. 本轮测试结果

| 范围 | 结果 | 证据边界 |
| --- | --- | --- |
| 四端 Node 单测 | **480/480**，零跳过 | Frontend 2、Console 1、原客户端 230、Glass 247；本轮重新执行 |
| 四端生产构建 | **4/4 成功** | 本地构建通过不代表生产配置或正式安装包已验收 |
| npm 依赖审计 | **8/8，已知漏洞数 0** | 四端各执行完整及生产依赖审计；使用官方 registry。不能替代全部 Java/容器镜像安全证明 |
| 后端严格 CI | **194/194 × 2 时区** | UTC、Asia/Shanghai，包含 PostgreSQL Testcontainers；零失败、零跳过 |
| Edge Agent 严格 CI | **7/7 × 2 时区** | 同上 |
| 严格浏览器 CI | **116/116**，零跳过 | Frontend 1、Console 1、原客户端 39、Glass 75 |
| 发布工具回归 | **通过** | Node runner 16 个条目，包含两份脚本包装条目；不计作 16 个独立业务场景 |
| 工作流语法 | **actionlint exit 0** | 对当前工作流执行检查 |
| Glass Android 构建 | **成功** | 当前源码构建 Debug/测试 APK；内嵌源码准确、dirty=false |
| Android JVM | **5/5** | 首次构建复用缓存后，已用 `--rerun` 明确重跑测试任务；不是只读取旧 XML |
| Android 仪器测试 | **4/4** | API 36 专用模拟器；零失败、零跳过 |
| 原生 AI 16 项套件 | **未通过** | 登录恢复及原生恢复遮罩阻断；另一次诊断在完成 4 项后模拟器离线。未执行项不算通过 |
| 缺失签名文件拦截 | **两端均通过** | 两端实际 Gradle 任务均按预期拒绝不存在的实验 keystore；属于负向验证 |
| 真实服务边界复测 | **8 场景、10 次执行通过** | 隔离服务、合成数据、AI fixture；同库 N→N−1→N 读写和清理通过 |
| P0 Runtime | **普通集成分支通过** | 重启、故障、逻辑恢复通过；不可变 12 服务正式分支 skipped |
| WAL-G/PITR | **模拟存储实跑通过** | 实际基础备份/WAL 重放及提升后 SQL 读写；不等于生产恢复批准 |
| 固件 | **实际编译通过** | Zephyr 3.7.2 / SDK 0.16.8 / nRF52840；4 份产物校验和复核一致，未烧录 |
| 正式发布治理 | **FAIL** | 不得因其他 CI 全绿记为通过 |

测试层存在重复覆盖，不汇总成一个“业务总通过数”，也不给出缺少依据的上线完成百分比。

## 3. 新发现：读取超时会清除有效登录会话

### 触发链路

1. 用户有已保存端点，以及与其 issuer/client ID 一致、尚未过期的登录会话。
2. 启动时 `snapshot.endpoint.status` 为 `timeout`，App 保留磁盘中的端点配置，但在内存里启用默认端点。
3. `activateEndpoint()` 仍调用 `configureAuthSession()`，使用默认端点的 OIDC 身份恢复原会话。
4. `OidcSessionManager.restore()` 发现身份不匹配，执行 `clear()`，删除会话和登录事务两个 key。

涉及代码：`apps/client-glass-next/src/main.js:1437` 的超时回退、同文件 `:665` 的认证恢复，以及 `apps/client-glass-next/src/js/auth/oidc-session.js:237` 的身份校验/清除。

**原有 `persistProfile=false` 只避免覆盖连接配置，没有阻止会话清除。** 清除不同真实身份的会话本身是正确保护；问题是一次读取超时不能证明身份真的发生了变化。

### 对照复现

本轮新增本地诊断程序，复用实际 `main.js` 函数体及实际 `OidcSessionManager`，仅替换平台/存储/网络边界，使用明确的虚假令牌，不访问真实账号。

| 条件 | 配置保存次数 | 有效会话保留 | 认证结果 |
| --- | --- | --- | --- |
| 已保存端点读取成功 | 1 | **是** | authenticated=true |
| 同一已保存端点读取超时 | 0 | **否** | authenticated=false，SESSION_CONTEXT_CHANGED |

超时场景实际删除 `iot-manager.oidc-session.v1` 和 `iot-manager.oidc-transaction.v1`。“超时不应删除有效会话”的断言失败，程序 exit 1；这是缺陷复现结果，不应转为测试通过。

原生确认运行中也观察到“本机连接设置读取失败，已使用默认连接”和“Stored session belongs to a different or unverified identity configuration”同时出现，随后进入“界面启动未完成，请重新加载”状态，AI 导航点击超时。网络诊断的 fixture API 返回 200，因此该次失败不能仅用后端不可达解释。

本地原生 APK SHA256：`b31ebba286df06e1bc708bf421d1e740a3d7d5399ad03d373523744dcb44d727`。源码为 `65d462d`、dirty=false，使用本地公开连接默认配置。该安装包与 CI 干净配置的 Debug APK 是不同构建产物；本报告没有把本地失败冒称为已安装 CI APK 的结果。

### 整改方向

- 端点读取超时/失败/取消时，认证状态进入“配置未确认”，保留加密会话但不使用它访问未经确认的端点。
- 仅在端点读取成功，或用户明确选择并确认新端点后，再按既有身份绑定规则恢复/清除会话；不能放宽 issuer/client ID 校验。
- 恢复必须服从当前启动代次和端点版本，迟到读取不能覆盖用户后续选择，也不能延长启动遮罩的固定预算。
- 增加真实认证管理器参与的 bootstrap 回归。当前相关端点保存测试把 `configureAuthSession` 替换为空行为，因此没有覆盖这个组合问题。
- 原生回归补冷启动、读取超时、立即重启与恢复操作；确认遮罩可退出、入口可点击、会话不误删，连续结果稳定后才能关闭此项。

本轮只做测试和评估，未修改该业务逻辑。

## 4. 原生失败记录

本轮没有通过重复重跑把失败记录覆盖成全绿：

| 执行 | 结果和归因 |
| --- | --- |
| 仪器测试后的第一次烟测 | 安装准备错误：Gradle 测试结束已移除目标 App，`run-as` 报 unknown package。重新安装后再测；不记为产品缺陷 |
| 安装正确后的原始烟测 | 0/16 检查完成，AI 输入框未出现，页面停留登录提示；保留失败日志 |
| 增加诊断的烟测 | 完成前 4 项并已发出模拟聊天 POST，随后模拟器 offline，套件未完成。不能据此断言 App 崩溃，也不能算通过 |
| 同一命令内维持模拟器并确认的冷启动 | 0/16 检查完成，配置读取失败、身份不匹配及启动恢复遮罩导致 AI 点击超时；对应 P1-SESSION 的诊断证据 |

环境中断与已确认代码问题分别记录。上轮 16/16 的历史结果不能关闭本轮缺陷。

## 5. 服务、负载、恢复与固件证据

本轮重新派发的隔离服务任务通过 8 场景、10 次执行。短时创建 1,000 台设备，请求并发 25，建立 100 条认证 WebSocket，接收 100,000 条消息；创建及 WebSocket 错误均为 0。创建 p50/p95/p99 为 **820/1024/1266 ms**，吞吐约 **30.69/s**。测试设备归档及容器/卷清理通过。

N→N−1→N 使用不同开发镜像和同一 PostgreSQL；迁移历史保持一致，恢复后的 N 镜像准确匹配原镜像。该演练使用开发基线，不是已批准生产发布之间的正式回退。

P0 普通集成任务验证了 PG/后端重启持久性、PG 中断 readiness 503、12 秒依赖中断后的启动重试及逻辑备份恢复，恢复库 Flyway 版本为 28。该任务的正式不可变分支明确 skipped。

新一轮物理恢复确认点前标记存在、点后标记排除、恢复库已提升且可写，源/恢复 Flyway 均为 28；标记年龄 **7 秒**、数据库恢复耗时 **9 秒**，清理通过。这里的标记年龄不是生产持续 RPO 保证，数据库恢复时间也没有包含完整业务服务恢复。Moto S3 API、实验数据量、fixture 凭据均不能替代生产存储/恢复验收。

固件在官方固定 Zephyr 3.7.2 提交与 SDK 0.16.8 下，对 `nrf52840dk/nrf52840` 实际交叉编译，HEX/BIN/ELF/config 的 4 份 SHA256 全部复核一致。未连接或烧录真实开发板。

按项目已有范围，R2 的“千设备、24 小时、Redis/mTLS”等要求不作为本次 R1 的额外隐含门槛。R1 仍需自身批准的负载/清理验证、真实回退和清理后恢复证据，不能由这次短时实验代替。

## 6. 候选身份与 CI 链接

| 任务 | 结果 | 链接 |
| --- | --- | --- |
| Quick CI push | success | [39140277748](https://github.com/xxbb11122/IotManager/actions/runs/39140277748) |
| Quick CI PR | success | [39140281159](https://github.com/xxbb11122/IotManager/actions/runs/39140281159) |
| P0 Docker Runtime PR | success，正式分支 skipped | [39140281096](https://github.com/xxbb11122/IotManager/actions/runs/39140281096) |
| Eight isolated runtime boundaries，本轮新派发 | success | [39141021953](https://github.com/xxbb11122/IotManager/actions/runs/39141021953) |
| Extended isolated lab，本轮新派发 | success | [39141031568](https://github.com/xxbb11122/IotManager/actions/runs/39141031568) |

以上运行的 headSha 均为 `65d462d1a019c31061e74c0728fe3f6989d71edc`。P0 实际检出 PR 合并预览 `bb8fca8b41f1de1961c526d14e401ffd46759439`，其 Git tree 与被测源码均为 `615375ce03f8b73e82355c322c2620c9eccc1602`；已核对文件树一致，没有混淆根提交身份。

治理快照显示候选相对默认分支 ahead 20、behind 0。签名工作流源码要求受保护默认分支及已合入候选，本轮不能绕过这些要求。GitHub 注册工作流列表没有 `android-release.yml`，该工作流历史查询返回 404；Release Gate / Image Security 未取得当前候选的正式成功证据。UNKNOWN 控制项保持未知，未假称它们一定不存在。

## 7. 证据文件与发布建议

证据根目录：`E:\CC_testP\iot-manager\artifacts\release-reassessment-20261018`。

| 文件 | 用途 |
| --- | --- |
| `assessment-summary.json` | 机器汇总；decision=NO_GO，productionApproved=false |
| `local-results.json` / `ci-summaries` / `ci-runs.json` | 本地 18 条命令、严格 CI 计数及工作流状态 |
| `startup-session-probe.mjs` / `.json` / `.log` | P1-SESSION 的实际函数对照复现；修复前断言失败 |
| `native-ai-final.log` / `native-ai-diagnostic.log` / `native-confirmation.log` | 三次业务烟测及环境中断原始记录 |
| `native-apk-identity.json` / `glass-unit-rerun.log` / `glass-instrumented.log` | 原生包身份与 JVM/仪器验证 |
| `governance.json` / `registered-workflows.jsonl` / `*.yml.runs.json` | 发布治理及正式工作流可用性证据 |
| `physical/physical-lab.json` / `eight` / `p0` / `firmware` | 新一轮服务、恢复、固件证据和校验和 |

`finalize-assessment.mjs` 已核验计数、当前源码、CI、物理恢复、产物校验和和缺陷对照结果；其“记录一致性通过”不等于测试全绿。专用模拟器已关闭，未发现连接设备残留；CI 临时容器/卷清理通过。原有非本轮工作文件保持原状。

当前可继续隔离开发和测试。完成 P1-SESSION 修复并复测后，再按上述关闭标准补正式门禁、签名、目标硬件与恢复验收，才有依据重新判断正式发布。AI 和知识库生产默认关闭；若保持关闭，可在发布单中列为 OUT_OF_SCOPE；若启用，需另补真实供应商质量、隐私、费用及异常验收，不以 fixture 代替。
