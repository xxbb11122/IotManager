# IoT Manager 当前问题最小修复说明

日期：2026-11-17（Asia/Shanghai）。对应[2026-11-16 审核报告](PROJECT-AUDIT-2026-11-16.md)。

本轮遵循“不要大改，只完成目前问题”：保留现有页面、动效、刷新节奏、API 路径和响应结构；不重构架构，不新增业务模块，不改数据库结构，不覆盖此前未提交的 UI 工作。

## 1. 修复范围

| 审核项 | 本轮改动 | 验收边界 |
| --- | --- | --- |
| AUD-01 后端编译失败 | 恢复 `LanDiscoveryService` 的 `ObjectMapper` 构造注入 | 当前源码重新编译及后端回归；不复用旧类规避编译 |
| AUD-02 温度来源越权 | 绑定前验证设备属于当前站点、未归档，Profile 的字段必须为数值型摄氏温度；非法站点/设备统一 404，能力不符 400 | 历史错误关联在读取时再次拦截，不返回外站设备 ID，不读取其遥测 |
| AUD-03 生产演示设备回退 | 新增 `iot.discovery.demo-enabled`，根配置默认关闭；只有显式启用、`dev/test`、未启用安全隔离且无 `prod` 的环境可用 | 安全 API 无真实 Edge 时返回空列表，伪候选认领 404；真实 Edge 分支保持不变 |
| AUD-06 构建依赖中危 | 仅更新两个客户端锁文件中的兼容上游链：`rimraf 6.1.4 → glob 14.0.6 → minimatch 11.0.8` | 没有强制跨版本 override，也未升级业务框架；完整 npm 审计与 Node 22 回归 |
| AUD-07 错误成功 ACK | 新增执行器就绪标志；配置失败、失去就绪和 GPIO 写入失败均返回错误 4；成功写入后才更新 `power_state` | 保持 10 字节协议、CRC、token 和既有错误码；主机模拟不替代真实 BLE/电气验收 |
| AUD-08 过期温度参与结露 | 使用最新 UTC 接收时间的有效遥测；禁止使用设备默认温度或按旧 `sampled_at` 选择数据 | 缺失、过期、离线、时钟异常和非数值均为 `UNAVAILABLE`，不会作为当前绿色“适宜” |

演示模式同时检查安全隔离和 profile，单独在生产设置 `demo-enabled=true` 不能绕过限制。开发启动方式不变；真实现场调试建议显式设为 `false`。

## 2. 结露温度的确定规则

1. 绑定和读取都检查同站点、未归档；设备迁站或归档后，已有绑定不会继续读取温度。
2. Profile 必须启用，字段类型为 `number`、单位为 `C` 或 `°C`。未指定字段时使用 `temperature`；支持 Profile 中显式定义的其他摄氏温度字段，不隐式把湿度/电压或华氏温度作为摄氏温度。
3. 设备状态仅接受 `ONLINE` / `WARNING`；`OFFLINE` / `MAINTENANCE` 不参与当前风险评估。
4. 只查询 `received_at` 非空的最新遥测，要求 `0 ≤ now - received_at ≤ 300 秒`。300 秒仍有效，301 秒不可用；未来接收时间不可用。旧本地时间列不作为回退。
5. 来源时间为 `SKEWED`、`LEGACY_UNKNOWN` 或缺少信任标记时不可用。合法的 `UNKNOWN + observed_at=null` 使用服务端接收时间，兼容没有设备时钟的实时采集；`UNKNOWN + observed_at有值`、未来观测时间均不可用。
6. 选定字段必须实际存在于当前样本且是有限数值；不使用 `device.temperature` 的默认 0，也不把字符串转为数值。
7. 天气已停用或超过既有 6 小时过期边界时，结露指标同样不可用。有效数据仍沿用原来的红/黄/绿阈值。

这些判断只决定当前指标可否计算，不删除历史关联、遥测或天气快照。历史数据仍由既有查询/留存机制管理；本轮没有增加刷新轮询。

## 3. 回归结果

验证使用 JDK 17 / Maven 3.9.11、Node 22.23.5。Node 只解压在本地证据目录，已校验官方 SHA256，未更改系统默认 Node/JAVA_HOME。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 首轮后端定向回归 | 47 项通过，0 失败/错误/跳过 | [日志](../artifacts/audit-20261116/remediation-backend-targeted.log) |
| 后端完整回归 | 238 项：219 通过、19 跳过，0 失败/错误 | [完整日志](../artifacts/audit-20261116/remediation-backend-full.log) |
| 最终边界定向复测 | 74 项通过，0 失败/错误/跳过；其中天气服务 40 项，含后补的 6 项边界用例 | [日志](../artifacts/audit-20261116/remediation-backend-final-boundaries.log) |
| 后端打包 | 当前源码 JAR 打包通过；此步骤 `-DskipTests`，测试结论取上两行 | [日志](../artifacts/audit-20261116/remediation-backend-package.log) |
| H2 迁移/测试启动 | 27 个迁移执行通过，版本到 V28（编号按既有分配）；不是 PostgreSQL 结果 | 同后端完整回归日志 |
| 原客户端单元测试 | 252 项通过，0 失败/跳过 | [日志](../artifacts/audit-20261116/remediation-client-unit.log) |
| Glass 单元测试 | 258 项通过，0 失败/跳过 | [日志](../artifacts/audit-20261116/remediation-glass-unit.log) |
| 两客户端生产 Web 构建 | 均通过，开发预览隔离检查通过 | [原客户端](../artifacts/audit-20261116/remediation-client-build.log)、[Glass](../artifacts/audit-20261116/remediation-glass-build.log) |
| Capacitor CLI / Android 插件识别 | 两端均正常，6 个插件；不是 Gradle/APK 验收 | [原客户端](../artifacts/audit-20261116/remediation-client-capacitor.log)、[Glass](../artifacts/audit-20261116/remediation-glass-capacitor.log) |
| Glass 刷新/离线/天气/连接页面浏览器回归 | 19 项通过，0 失败/跳过/不稳定 | [JSON](../artifacts/audit-20261116/remediation-glass-e2e.json)、[日志](../artifacts/audit-20261116/remediation-glass-e2e.log) |
| 两客户端完整 npm 审计 | 各 0 漏洞（包含开发依赖） | [原客户端](../artifacts/audit-20261116/remediation-client-npm-audit.json)、[Glass](../artifacts/audit-20261116/remediation-glass-npm-audit.json) |
| 固件实际回调的 GPIO/ACK 主机模拟 | 16 项通过，MSVC C11 `/W4 /WX` | [日志](../artifacts/audit-20261116/remediation-firmware-host.log) |
| 固件 CI 脚本语法 | `bash -n` 通过；已有 Zephyr 构建前增加同一主机回归 | [脚本](../scripts/testing/extended-lab/firmware.sh)、[用例说明](../firmware/nrf52840-reference-switch/tests/host/README.md) |

浏览器检查使用隔离 API/WS 夹具，不能证明手机当前 GPS、实物 BLE、正式登录或付费 AI 已完成全链路验证。npm 零漏洞也不等于 Java/所有镜像没有漏洞。

最终 Surefire 各类结果去重汇总为 **57 个测试类 / 244 项：225 通过、19 跳过、0 失败/错误**。这是完整回归与后续同一生产源码的边界复测合并结果，不是将 238 与 74 简单相加。后端没有在第一次全套后再改生产实现，只补充了 6 个测试边界。

19 项跳过全部源于 Docker 不可用，未被计为通过：

| PostgreSQL 测试类 | 跳过数 |
| --- | --- |
| `AiRequestRecoveryPostgresIntegrationTest` | 13 |
| `AiVectorPostgresIntegrationTest` | 1 |
| `AiUpgradePostgresIntegrationTest` | 1 |
| `PostgresFlywaySmokeTest` | 1 |
| `LegacyTimePostgresIntegrationTest` | 2 |
| `RetentionServicePostgresIntegrationTest` | 1 |

本地新 JAR 为 `backend/target/iot-manager-1.0.0.jar`。它来自当前有未提交修改的工作区，不标记为已批准正式发行；没有拿旧 JAR、旧 APK 或历史 CI 代替本轮结果。

## 4. 本轮不擅自关闭的事项

- **AUD-04 交付身份/独立审批**：本轮修复留在当前工作区；没有推送、合并 PR、自行批准或绕过主分支保护。
- **AUD-05 正式发布治理**：独立审核人、保护环境、隔离恢复 runner、真实签名和远端恢复条件仍需相应人员与环境落实。保留失败关闭，不用假签名或模拟证据替代正式 Gate。
- Docker Engine 当前不可用，依赖 PostgreSQL 容器的用例不计为通过；本轮不启动或修改已有生产数据库。
- 未重新构建/安装 APK，未进行当前代码的 Zephyr 交叉编译、实体 nRF52840/BLE、电气负载、GPS 或正式签名验收。固件错误分支修复有主机回归，但硬件关闭条件仍保留。

因此，本轮交付是**当前已确认代码缺陷的最小修复及相应回归**，不是正式生产发布批准；项目仍按 R1 受控试点候选管理。
