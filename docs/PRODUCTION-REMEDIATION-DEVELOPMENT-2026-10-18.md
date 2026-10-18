# IoT Manager 上线整改开发文档

日期：2026-10-18。依赖：[已复审方案](PRODUCTION-REMEDIATION-PLAN-2026-10-18.md)、[审核记录](PRODUCTION-REMEDIATION-REVIEWS-2026-10-18.md)。本轮只修复和增加验证能力，不自动部署、上架或变更生产数据。

## 1. R1：时间兼容

修改 `backend/src/main/resources/application.yml`，移除全局 `hibernate.jdbc.time_zone`。注释说明旧 LocalDateTime 列必须保留无时区字面值，新的 Instant 继续使用 Hibernate TIMESTAMP_UTC 映射。

新增持久化回归测试，使用实际 `DeviceCommand` 和 `Device` 实体、应用配置与注入 TimeProvider：固定 UTC 瞬间、写入旧+新字段、flush/clear、直接 JDBC 以无 Calendar 的旧读法读取；断言旧字段等于 legacy-zone 的墙钟值，UTC 列仍等于原 Instant。覆盖请求、发送、完成、过期字段以及无 UTC 的旧写回读。H2 先运行；继承相同用例的 PostgreSQL Testcontainers 类在 UTC/Asia/Shanghai CI 矩阵运行。数据库连接时区与 JVM 时区交叉组合时仍比较实际列值。

先在未修复配置上执行新测试记录失败，再移除配置复测。测试不能显式覆盖正确的 JDBC 配置以掩盖应用配置问题。`scripts/testing/runtime-eight/run.sh` 保留原 N−1 SHA 和原时间断言，并增加恢复 N 后读取 N−1 写入的断言。迁移历史摘要、同数据库标识和不同镜像标识保留。

新增 `scripts/release/audit-legacy-time.sql`：只执行 SELECT，以 `psql -v legacy_zone=Asia/Shanghai -f ...` 使用；输出具有 UTC 对应值且旧列有差异的行及 expected 值。涉及命令、活动、事件、证书轮换和告警。无 UPDATE/DELETE，无自动修复。只有证明同一旧部署时区后才可解释核对结果。

## 2. R2：缓存兼容与可回退源码

新增 `apps/client-glass-next/src/js/platform/cache-schema.js`，导出 `openCompatibleCache(name, requestedVersion, callbacks)`。支持范围仅 2..3；调用正常 openDB 升级回调。只有 VersionError 才重试打开已有版本；成功后验证 stores、keyPath 和必要索引，v3 必须具有 bindingTime 三字段索引。关闭版本阻塞连接。任何 schema、权限或 I/O 错误向调用者抛出，禁止清库和静默忽略错误。CacheRepository 的失败 Promise 清除，允许显式重试。

兼容包生成器 `apps/client-glass-next/scripts/prepare-compatible-rollback.mjs` 输入完整 baseline SHA、全新输出目录、目标 versionCode；校验版本号大于当前发布 code，输出不能位于被导出的源目录，不覆盖已有目录。通过 git archive 导出旧 Glass 源码，仅修补 v2 打开器、带入已审计构建依赖和当前兼容模块；输出来源 SHA、补丁文件哈希、包名、目标版本信息与 `NOT_SIGNED_NOT_VALIDATED` 状态。不自动签名或安装。

自动测试使用来自真实 v2 实现的冻结夹具，标注来源 SHA；先证明未修补 v2 读 v3 得到 VersionError，再用同一变换后的旧实现读取与写入，最后新实现按索引分页验证新旧数据均在。另测未来版本、缺失索引、不同账号/站点隔离、连接关闭和生成器输入拒绝。回退包全量启动、升级安装与签名证据仍需真实构建和设备验证。

## 3. R3/R4：依赖与 CI

四个 package.json 使用精确 Vite 7.3.7，更新四个 package-lock 及兼容传递依赖。四个 Vite 配置显式保留 `['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14']`；Node 继续 22，审计使用官方 registry。`npm ci` 后执行完整 `npm audit --audit-level=high --registry=https://registry.npmjs.org`，任何 registry 错误也失败。四端完整审计与 `--omit=dev` 结果保留。

Quick CI gate 的 needs、结果变量及判断循环纳入 `android-glass-debug`；Bash/PowerShell 严格 Glass 浏览器集加入 material-contract。部署静态验证运行新发布工具测试。Eight runtime 对 backend、相关部署及运行测试变更触发，保留隔离和清理保护。配置和汇总使用统一阶段定义，启动脚本的每个阶段都须在自动测试中加载真实 Playwright 配置并验证独立报告路径。新增行为测试守住失败关闭，避免仅靠字符串存在就声称发布能力通过。

## 4. R5：仓库只读预检

`scripts/ci/release-readiness-preflight.mjs --repository owner/repo --output file.json` 通过已登录 gh 调用只读 API。检查默认分支保护（经典规则或适用的有效 ruleset）、必需的 Quick CI 汇总检查、管理员约束、禁止强推/删分支；检查 `r1-recovery-drill`、`r1-rollback-drill`、`android-release` 环境禁止自审的审核保护；检查在线且带 self-hosted/linux/iot-manager-recovery 标签的 runner。

结果使用独立 control 数组与 `PASS/FAIL/UNKNOWN`；API 不可读记 UNKNOWN，进程非零。只有全部 control 通过才返回 `PASS`，且字段明确 `productionApproved:false`。该工具不判断实机、签名和 PITR 是否通过，不以预检 PASS 代替 release-gate。

提供命令文档和管理员配置清单；测试包含完整合规样例、任一控制缺失、API 失败、伪装为在线但标签不符，以及 ruleset 等价保护。

## 5. R6：正式 Android 签名入口

新增手动 `android-release.yml`，独立 `android-release` 环境；只允许从默认分支运行，源码 SHA 必须完整且在默认分支历史上。原客户端/Glass 选项使用固定白名单映射路径、包名、Java 版本。两者共用严格身份核验脚本，源码中不接受任意命令。

受保护 secrets：`IOT_RELEASE_KEYSTORE_BASE64`、`IOT_RELEASE_STORE_PASSWORD`、`IOT_RELEASE_KEY_ALIAS`、`IOT_RELEASE_KEY_PASSWORD`；每个 app 另配可信 `ANDROID_*_CERT_SHA256` 与 `ANDROID_*_LAST_RELEASE_VERSION_CODE` variable。已分发最高版本必须由发布责任人维护，新 code 同时大于源码默认值和该记录。默认 token 无权读取治理配置时配置只读 `RELEASE_GOVERNANCE_READ_TOKEN`；无法预检时不得签名。缺少值提前失败。将 keystore 解码至 RUNNER_TEMP，不写入工作区；构建 APK 与 AAB，运行 apksigner verify 与 jarsigner verify，校验实际证书指纹、包名和输入 versionCode。

产物清单包含 source SHA、dirty 状态、appId、versionName/code、APK/AAB SHA256、APK signer SHA256。非默认信任来源、旧版本号、证书不匹配、debuggable 或 cleartext release manifest 一律失败。仅上传通过校验的产物和清单；always 清理私钥。既有 release Gradle 验证继续有效。

工作流使用固定 action SHA。不得在未知 PR 的脚本执行后注入私钥，不使用 `pull_request_target`，不授予发布权限。源码安全边界由受保护默认分支及环境审核共同保证；因此预检缺失时不能按流程生成正式产物。

## 6. R7/R8：验收交接

新增发布验收模板，所有未采集项初始为 PENDING；明确设备、BLE、LAN/TLS/OIDC、负载、长稳、固件、备份恢复、回退、RPO/RTO、责任人和证据地址。必须使用同一 candidate/source/APK 身份，测试时间须晚于构建。涉及数据恢复只在专用隔离环境执行。AI 未启用标记 OUT_OF_SCOPE，不能把模拟 provider 误记为真实供应商通过。

## 7. 验证命令与停止条件

建议 Node 22.23.3、JDK 17（Backend/Edge）、项目原定 Android JDK。按实际运行记录命令和退出码：

```powershell
# 从项目根目录；npm 命令分别在四个 Web 包中执行
npm ci --registry=https://registry.npmjs.org
npm audit --audit-level=high --registry=https://registry.npmjs.org
npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org
npm test
npm run build
npm run test:e2e

node scripts/ci/tests/release-tools.test.mjs
node scripts/ci/tests/release-workflows.test.mjs
node --test scripts/ci/tests/release-readiness-preflight.test.mjs scripts/ci/tests/android-release.test.mjs
node scripts/ci/release-readiness-preflight.mjs --repository xxbb11122/IotManager --output artifacts/release-remediation-20261018/preflight.json
```

Java 执行 `mvn -f backend/pom.xml clean verify` 与 Edge 对应命令；有 Docker 的严格 CI 必须零跳过。本机 Docker 不可用时保留跳过清单，不能以成功退出码隐藏。Android 无签名材料时只完成 Debug 构建及可用原生测试，正式签名明确 PENDING。

实现中若发现新设计缺陷，先在审核记录补充修正，再更新文档与代码。交付汇总必须区分已实现、已实际通过、尚待真实环境验证；当前缺失任一 P0 外部门槛时结论维持 NO-GO。
