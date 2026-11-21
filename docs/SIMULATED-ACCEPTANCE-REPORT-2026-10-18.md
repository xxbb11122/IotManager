# IoT Manager 模拟发布验收报告

日期：2026-10-18（Asia/Shanghai）

结论：**SIMULATED_ACCEPTANCE_PASS，模拟范围验收通过。`productionApproved=false`。**

根据用户“想办法完成测试”及“模拟”的授权，本轮使用专用 Android 模拟器、两日有效的实验签名证书、临时 CI 服务和 S3 API 模拟存储，补齐此前缺少环境而无法执行的验证。实际执行了编译、安装、原生交互、签名验证、数据库备份及 WAL 重放，没有用预设结果替代测试。

该结论支持继续开发、演示和隔离测试。正式发布仍需真实分发签名、目标手机/PDA/BLE、生产恢复环境及发布治理验收；本报告不签发生产发布批准。

## 1. 被测版本与证据归属

| 对象 | 精确版本 | 说明 |
| --- | --- | --- |
| 后端、CI、恢复脚本、固件 | `10b28d3a7a90ad6160583bc8b737a05acece095f` | 最终功能提交；6 次 CI 均成功 |
| Android 本地被测源码 | `03726f3ce06277a736749d0e936275504bbcc8c7` | 干净独立检出；已含连接设置超时修复 |
| Android 兼容旧业务源码 | `ac1e0a1e86ba3a44d7568650953d4bc7b2d4905c` | 独立兼容回退构建；不代表已批准的生产旧版本 |
| 当前 Glass 子树 | `aea3c068ab0a157bfa1dbe7d30c46fbe264f1c0e` | `03726f3` 与 `10b28d3` 完全一致 |
| 原客户端子树 | `6a9caa0946b99d88e6af30851953942220bf5462` | `03726f3` 与 `10b28d3` 完全一致 |

本地 APK 的内嵌源码仍明确记录为 `03726f3`，没有改写为 `10b28d3`。后续提交只记录本报告时，也不能把已完成的测试说成针对新的根提交重新运行。

本地证据根目录：`E:\CC_testP\iot-manager\artifacts\test-completion-20261018`。汇总核验程序 `verify-completion.mjs` 已检查 **13 组证据全部通过**；这表示证据核对组数，不是新增的 13 项业务测试。机器结果见同目录 `completion-summary.json`。原始日志、失败记录和最终结果均保留在本地，生成物和签名材料未提交 Git。

## 2. 最终测试矩阵

| 范围 | 最终结果 | 本次验证的实际能力 |
| --- | --- | --- |
| 后端严格测试 | 每时区 **194/194** | UTC、Asia/Shanghai 各执行一次，包含 PostgreSQL Testcontainers；零失败、零跳过 |
| Edge Agent 严格测试 | 每时区 **7/7** | 两个时区均零失败、零跳过 |
| 客户端 Node 测试 | 原客户端 **230/230**，Glass **247/247** | 启动、缓存、交互等回归；零跳过 |
| 严格浏览器测试 | **116/116** | Frontend 1、Console 1、原客户端 39、Glass 75；零跳过 |
| Glass Android JVM | **5/5** | 启动策略 4 项及基础示例 1 项 |
| Glass Android 仪器测试 | **4/4** | 在 API 36 专用模拟器执行，覆盖原生启动重试、迟到回调及 Activity 重建等 |
| 已安装 Debug APK 功能 | **16/16** | 原生网络、AI 交互、键盘、系统返回、生命周期、旋转、Browser 插件及代理导航防护 |
| 实验 Release 构建与身份 | **4 组通过** | 原客户端 code 6、Glass code 11、兼容旧版 code 12、恢复新版 code 13；均实际构建 APK/AAB 并核验 |
| 签名负向验证 | **5/5** | 错误证书、源码、版本、损坏 APK、含未签名新增内容的 AAB 均被拒绝 |
| Android 缓存来回升级 | **3 阶段通过** | 正常覆盖安装 11→12→13，不清数据、不强制降级；旧业务读写、新版再读均正确 |
| Release 安装与实际点击 | **3 阶段通过** | 11→12→13 均非 debuggable，页面显示且原生点击可打开连接表单 |
| 真实服务隔离演练 | **8 场景、10 次执行全部通过** | 认证/RBAC、AI 供应商 fixture、短时负载、同库 N→N−1→N 读写 |
| P0 Docker Runtime | **通过** | PG/后端重启持久性、PG 中断 readiness 503、12 秒依赖中断后的启动重试、逻辑恢复 |
| S3 fixture 物理恢复/PITR | **通过** | 真实 WAL-G 基础备份及 WAL 重放、命名恢复点、提升及恢复后写入 |
| nRF52840 固件 | **实际交叉编译通过** | Zephyr 3.7.2 + SDK 0.16.8，产生 HEX/BIN/ELF；4 份文件校验和复核一致 |
| 源码安全与构建配置 | **CI 通过** | 提交历史秘密扫描、源码/依赖扫描、SBOM、Compose/Caddy 与发布契约校验 |

以上数量按测试层分别报告，不能相加后称为互不重复的业务用例总数。模拟器、fixture 和普通集成任务的通过也不等同于正式发布模式通过。

## 3. 关键结果和限制

### 3.1 Android 原生功能与 Release 升级

专用 AVD 为 `IotTestCompletion`，序列号 `emulator-5588`，Android API 36；仅操作本任务创建的数据。原生功能烟测实际安装了 Debug APK，并使用隔离 AI 服务。16 项包括：三种材质及系统对比度、快速切换导航、快捷提问不立即发请求、原生 HTTP、答案文本安全、重连不重复 POST、软键盘及系统返回、4000 字 persona、后台停止轮询、进程重启 GET 恢复、旋转和外部 Browser 返回。

缓存测试在已安装 WebView 内执行各版本真实 `CacheRepository` 源码，使用独立 fixture 数据库。schema v3、绑定、用户分区和分页索引保留；兼容旧版写入 `rollback` 后，新版可读取 `rollback` 与 `new`。三个阶段 UID 均为 `10218`，首次安装时间均为 `2026-10-18 13:19:05`。这是 Debug WebView 驱动的原生缓存验证，没有把注入测试库称为完整生产业务数据库的黑盒验收。

另对真实非 debuggable Release APK 完成独立验证：code 11→12→13 正常 `adb install -r`，三个阶段 UID 均为 `10221`，首次安装时间均为 `2026-10-18 15:15:13`。每阶段等待原生启动预算后，检查设备页并执行实际坐标点击，确认出现 API 地址表单。只读取 WebView 可访问性树不足以证明原生遮罩已退场，因此最终测试额外要求点击成功。

Release 交互检查处于离线/default endpoint 场景，出现连接告警属于该测试环境的预期状态；它没有验证 Release 与真实生产 HTTPS/WSS 后端的整条连接链路。详细原生网络及 AI 烟测使用 Debug APK。已检查 Release 11、12、13 的截图，设备页可见；未把默认 HTTP/WS 地址在严格 HTTPS Release 中不可连接算作在线成功。

主要证据：`native-ai-final/native-ai-results.json`、`native-ai-final/native-ai-chat.png`、`native-cache-roundtrip.json`、`release-install-roundtrip.json`、`release-install/release-13.png` 及 `release-install/settings-13.xml`。

### 3.2 实验签名与真实 SDK 验证

使用两日有效、明确标注 `LAB TEST ONLY DO NOT DISTRIBUTE` 的实验 PKCS12 证书。证书 SHA256 为：

```text
14f6dd364ad71348440a9b80fae303473d13fc2c165297b2cf4d02dd707c1bc1
```

实际使用 `apksigner`、`jarsigner`、`aapt` 和包内 build-info 检查签名、包名、版本、源码、脏工作区和安全标志。四组构建均 `debuggable=false`、`cleartextTraffic=false`、`dirty=false`，`productionApproved` 均为 false。

| 已保留的实验 APK | SHA256 |
| --- | --- |
| Glass code 11 | `76f75caafe6a69ef1e948e98f8f4dbc8bd0223045c0a54c64d97f722479b467e` |
| 兼容旧业务 code 12 | `2ebac9ee45102ef78396468a1c77c7c931f7ff4e609cf0bfba59cd462126b159` |
| 恢复新版 code 13 | `18a923d25e71c5114f0da80405555146e16622a6627d48e13b8ca00ab1767be0` |

特别验证了一个容易漏检的情况：向已签名 AAB 添加未签名文件后，`jarsigner` 可返回 0，但会报告未签名内容；项目验证器仍正确拒绝该 AAB。临时私钥在测试结束后已删除，实验安装包仅供本地测试，不能分发为正式版本。重新构建需生成新的实验密钥并重新核验指纹。

主要证据：`glass-final-lab-signed-identity.json`、`client-final-lab-signed-identity.json`、`rollback-lab-signed-identity.json`、`glass-code13-lab-signed-identity.json`、`release-negative-cases.json`。

### 3.3 真实服务、负载与版本恢复

普通隔离演练实际创建 **1,000 台设备**，请求并发 **25**，打开 **100 条认证 WebSocket**，收到 **100,000 条消息**；设备创建与 WebSocket 错误均为 0。该 runner 中创建设备 p95 为 **958 ms**、p99 为 **1,262 ms**，创建吞吐约 **31.86/s**。测试后 1,000 台设备均归档，活跃残留为 0。

这些是短时实验数据，不是生产容量上限或长稳结论。扩展恢复任务也独立执行了同类边界场景，其负载指标属于另一次运行，不能与上面数据混用。

后端 N→N−1→N 使用不同开发提交构建的镜像，在同一 PostgreSQL 上验证新版写入、旧版读取及写入、新版恢复读取。迁移历史 SHA256 前后一致，恢复后的 N 镜像准确匹配原 N 镜像；旧读时间保持上海时区语义。旧版基线是开发提交 `e0977e77220773182df4e3a73741686cbb87c6d9`，并非已签发的生产旧版本。

AI 部分验证了真实应用到隔离供应商的调用链，`realProviderCalled=false`；不涉及真实模型效果、配额和计费验收。

### 3.4 备份恢复和命名恢复点

P0 逻辑备份已恢复到独立库，源库和恢复库 Flyway 版本均为 **28**；PG/后端重启后数据保持，PG 中断时 readiness 返回 503，依赖恢复后后端重新健康。

扩展实验通过固定摘要的 Moto S3 API 服务运行真实 WAL-G 流程。源项目与恢复项目分离，执行了如下可核验步骤：

1. 固定较早的基础备份，随后写入标记。
2. 创建命名恢复点，再写入恢复点之后的标记并归档 WAL。
3. 从基础备份和指定 WAL 恢复到独立 PGDATA，恢复到该命名点并提升。
4. 验证点前标记存在、点后标记不存在，Flyway 28 一致，恢复库可以写入。
5. 清理恢复容器和卷，恢复源测试配置，并继续完成其余隔离场景。

结果：`readWriteProof=true`、`promoted=true`、`postTargetMarkerExcluded=true`、`cleanupPassed=true`。基础备份为 `base_000000010000000000000007`，重放包含恢复点的 WAL 段 `000000010000000000000008`。本次标记年龄 **8 秒**（脚本阈值 900 秒），恢复耗时 **8 秒**（阈值 3,600 秒）。标记年龄属于本轮演练的观察值，不能当作生产持续 RPO 保证；8 秒恢复来自小型实验库，不能外推至生产数据量。

Moto 只提供实验 S3 API。本次没有验证生产对象存储 IAM、跨地域副本、保留策略、生产带宽和故障域。脚本参数及 WAL-G `backup-fetch` 用法按[官方 PostgreSQL 文档](https://github.com/wal-g/wal-g/blob/v3.0.7/docs/PostgreSQL.md)核对。

主要证据：`ci-10b/physical/physical-lab.json`、`ci-10b/physical/summary.json`，以及 `ci-10b/p0` 下的逻辑恢复报告和 `resilience-summary.txt`。

### 3.5 固件

实际交叉编译目标为 `firmware/nrf52840-reference-switch`，板型 `nrf52840dk/nrf52840`。Zephyr 固定到官方 v3.7.2 对应提交 `bbbf8b30094dacd0d6830946ba206bcec8af6b0c`，SDK 0.16.8 下载包先核对官方校验和，再编译。

最终产物 `zephyr.hex`、`zephyr.bin`、`zephyr.elf`、`zephyr.config` 的 4 份 SHA256 已在本地逐一复核。没有连接开发板、烧录或测试无线链路；`hardwareTested=false`。证据位于 `ci-10b/extended/lab-firmware-10b28d3a7a90ad6160583bc8b737a05acece095f`。

## 4. 测试发现及修复闭环

| 发现 | 修复 | 验证 |
| --- | --- | --- |
| 启动读取连接配置超时/失败时，默认值可能覆盖用户已保存配置 | 仅已确认完成的读取允许启动持久化；失败默认值留在内存；手动保存保持可用 | 先复现失败；新增覆盖 timeout/rejected/cancelled/fulfilled 的实际 bootstrap 回归，Glass 247 项通过 |
| 调度器与手动派发并发时，已 SENT 的命令仍可能再次取得发送资格 | 在事务行锁内增加仅 PENDING 可成功的原子认领，调用方只在认领成功时发送 | 8 个并发争抢者仅 1 个成功；重复/终态/非 Edge 场景拒绝；相关 19 项及双时区全量 CI 通过 |
| 物理恢复脚本此前缺少正向实跑，暴露 psql 变量展开、backup-fetch 顺序、恢复用户和网络问题 | SQL 改 stdin，校正参数顺序，恢复进程匹配 UID 999，并允许恢复侧访问对象存储 | 最终真实基础备份及 WAL 重放通过 |
| WAL 恢复凭据目录归属与 PostgreSQL 恢复时的凭据挂载不匹配；export 会掩盖秘密读取失败 | 最小范围挂载恢复凭据；赋值成功后再 export，缺失/空凭据立即失败 | 真实 Bash 负向用例由 4 失败转为 5/5 通过；最终物理恢复通过 |
| 固件实验首次无法解析全 SHA，以及冻结未拉取模块失败 | 固定提交精确 fetch，导出已解析 manifest | 真实交叉编译及产物校验通过 |
| 原生安装复测曾未完成，测试驱动吞掉 dump 错误且仅树可见不足以证明可点击 | 在专用 AVD 重启后记录诊断与失败状态，等待启动预算并要求真实点击 | 最终 11→12→13 三阶段全部通过；早期失败日志保留 |

早期失败及中途取消的 CI 没有计入最终通过数。源码修复后的最终判断只使用精确版本对应的成功运行和最终本地结果。

## 5. 可复核的 CI 运行

以下 6 次运行的 `headSha` 均核对为 `10b28d3a7a90ad6160583bc8b737a05acece095f`，状态均 `completed/success`：

| 运行 | 链接 |
| --- | --- |
| Quick CI push | [39132567159](https://github.com/xxbb11122/IotManager/actions/runs/39132567159) |
| Quick CI PR | [39132570125](https://github.com/xxbb11122/IotManager/actions/runs/39132570125) |
| P0 Docker Runtime push | [39132567141](https://github.com/xxbb11122/IotManager/actions/runs/39132567141) |
| P0 Docker Runtime PR | [39132570123](https://github.com/xxbb11122/IotManager/actions/runs/39132570123) |
| Eight isolated runtime boundaries | [39132567173](https://github.com/xxbb11122/IotManager/actions/runs/39132567173) |
| Extended isolated lab：固件和 S3 物理恢复 | [39132567167](https://github.com/xxbb11122/IotManager/actions/runs/39132567167) |

可以从这些运行下载结构化 artifact。CI artifact 有保留期限；本地已下载并核验，归档时应一并保存 JSON/CSV、固件校验和和报告。可重复入口为 `.github/workflows/extended-isolated-lab.yml`、`scripts/testing/extended-lab/firmware.sh`、`scripts/testing/extended-lab/wal-lab.sh`、`scripts/testing/runtime-eight/run.sh`。本地汇总可用 Node 22 运行：

```powershell
node E:/CC_testP/iot-manager/artifacts/test-completion-20261018/verify-completion.mjs
```

该命令核对既有证据，不会重新运行完整测试；需要本地 artifact 与 GitHub 只读访问能力。

## 6. 清理和正式发布边界

临时 CI 恢复容器和卷已验证清理；普通隔离任务清理报告显示容器、卷残留均为 0。专用 Android 模拟器已发出退出命令，实验私钥已删除，证明保存在 `local-cleanup.json`。保留测试源码、日志和 AVD 数据供追溯；未清理其他工作文件，也没有合并 PR 或部署生产。

只读治理预检仍为 **FAIL**：默认分支保护、必需检查、独立审批环境和专用恢复 runner 尚不齐全。普通 P0 任务未替代不可变 12 服务的正式发布模式。正式上线前还应完成：

1. 配置仓库和发布环境保护，使用受控 runner 运行不可变候选版本的正式发布门禁。
2. 使用正式分发密钥验证实际发放的 APK/AAB、商店分发证书和覆盖升级。
3. 在目标手机/PDA/BLE 设备完成安装、控制、弱网、权限、后台及长稳验收，并验证 Release 的生产 HTTPS/WSS 链路。
4. 在真实恢复环境、接近生产的数据量和存储策略下复做逻辑恢复、PITR 及已批准版本回退。
5. 验证真实 AI 服务的质量、计费和限额，并按生产容量目标补充长时间负载测试。

以上属于真实发布环境验收，不影响本轮约定的模拟验收通过结论。
