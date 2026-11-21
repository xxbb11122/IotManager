# 发布门禁模拟测试方案

日期：2026-10-29，Asia/Shanghai。状态：独立方案审核通过，实施及最终复核完成；见[实施验收报告](RELEASE-GOVERNANCE-SIMULATION-ACCEPTANCE-2026-10-29.md)。

## 目标和范围

针对尚未配置完成的三个发布环境、独立审批、专用 runner，使用合成 GitHub API 快照验证项目现有门禁及调度代码的判断。测试直接调用 `evaluatePreflight`、`buildPlan`、`dispatch`，禁止另写一份门禁算法作为被测对象。

测试中的“审批”指审批保护配置是否满足项目要求。GitHub 平台实际阻止自批、人工批准、身份权限、runner 注册上线、正式签名和生产恢复均不由这些快照证明。

现有函数的能力边界：审核人数组非空不证明实际存在可批准的独立人员；runner 的 online 状态及标签不证明宿主隔离、实际系统或资源容量；签名 PRESENT 只核对 Secret 名称与变量格式；两个不同摘要只满足回滚调度的输入条件，其制品真实性与 attestation 由后续正式工作流验证。模拟报告必须保留这些限制。

此外，现有预检不验证 quick-gate 的 GitHub App 来源 ID 或 require_last_push_approval；本方案不声称覆盖这两项保护，也不因既有实现未校验就认定其已经通过。

本轮新开发离线门禁模拟与 JSON 报告，复跑已有真实临时密钥测试及源码策略测试。此前 Linux 迁移/PITR 及设备模拟作为历史证据引用，本轮不重新宣称其已执行；不改动现有生产门禁，不降低审批要求。

## 场景与预期

| 场景组 | 输入变化 | 必须观察到的结果 |
| --- | --- | --- |
| 合格配置 | Client、Glass 各自完整治理、签名元数据、不同 N/N-1 摘要 | 四阶段均允许提交到内存请求记录器；精确核对 workflow、默认分支及输入；结果始终 PENDING、productionApproved=false |
| 三个发布环境 | 对每个环境分别测试不存在/API 不可读、无审批规则、无审核人、允许自批、管理员绕过、允许非受保护分支 | 对应环境控制项 FAIL 或 UNKNOWN；全部阶段阻断；请求记录器调用次数为 0 |
| 分支保护 | 保护不存在、quick-gate 缺失或非严格、管理员绕过、强推/删除允许、无需 PR 批准、旧审批不失效 | 指定控制项失败，全部阶段阻断 |
| Ruleset 路径 | 等效规则集完整；含 bypass actor；规则集元数据无法读取 | 完整时可计划调度；旁路或不可读时阻断 |
| Runner | 无 runner、离线、API 不可读、缺少三个必需标签中的任意一个；多个 runner 中有一个合格 | 无合格 runner 时阻断；存在合格 runner 时可计划调度 |
| 源码身份 | 默认分支 HEAD 已变化或不可读 | reviewed-source 失败，全部阶段阻断；候选禁止使用分支名替代完整 SHA |
| 签名元数据 | 每个 App 缺少任一 Secret 名称、指纹不合法、版本复用/回退、版本基线不合法、只有另一个 App 的配置 | Android 阶段阻断且无请求；其他阶段按其自身条件判断；不把元数据存在声称为签名已验证 |
| 回滚输入 | N 或 N-1 缺少、两者相同、摘要格式不合法 | 缺少时仅回滚阻断；相同/非法时计划构建直接拒绝；不把占位摘要当作已批准证据 |
| 请求失败 | 内存请求记录器抛出拒绝错误 | 错误传播，不返回成功或发布批准 |
| 已知缺口回放 | 合成复现 10 月 27 日的 4 PASS / 2 FAIL / 2 UNKNOWN 配置 | 全部阶段阻断；标记历史合成回放，不用于描述今天真实 GitHub 状态 |

## 实现及隔离

1. 新增 `scripts/testing/release-governance-simulation.mjs`：内置固定的虚构仓库、合成 SHA、证书指纹及摘要；以全新对象执行各场景，防止状态串扰。
2. `dispatch` 必须显式传入内存请求记录器，每次检查完整请求。模拟程序不调用 `collectSnapshot`、`gh`、网络接口或正式签名配置入口，不读取任何凭据。在独立模拟进程内、导入被测模块之前禁用子进程及常规网络入口；任何尝试均记为模拟失败。这是回归误调用防护，不声称替代操作系统沙箱。
3. 程序无生产模式或真实请求适配器选项。只允许指定本地 JSON 输出位置；报告包含 `simulation=true`、`productionApproved=false`、被测源码文件 SHA256、逐场景预期/实测/断言错误、总数及通过/失败/跳过数。任一断言失败返回非零退出码；允许调度只记录为 SIMULATED_REQUEST_PENDING。
4. Quick CI 增加同一离线脚本运行与模拟报告上传；本轮只本地执行与验证工作流语法，若未提交触发云端则明确记为未运行。
5. 复跑现有四个 Node 测试文件及 actionlint、Git whitespace 检查。签名只执行临时实验 keystore 的 check 路径，禁止 configure 模式，避免真实 GitHub 读取或上传。Windows 的 Linux 专用注册协议跳过如实记录，不能计为本次通过。

命令：

```powershell
node scripts/testing/release-governance-simulation.mjs --output artifacts/release-governance-simulation-20261029/summary.json
# 使用 JDK 17 和 Node 22 执行签名及运维既有测试
node --test scripts/ci/tests/release-readiness-preflight.test.mjs scripts/ci/tests/release-operations.test.mjs scripts/ci/tests/android-signing-setup.test.mjs scripts/ci/tests/recovery-runner-setup.test.mjs
```

## 审核与验收标准

独立审核必须确认：场景使用真实项目函数；所有正/反路径都验证请求次数及内容；拒绝原因对准对应控制项；不存在真实 GitHub 写入或生产资源访问；报告不会把模拟结果标成正式发布批准。

出现审核问题先修订方案；通过后实施。若测试暴露现有门禁缺陷，保留失败证据并单独说明，不修改模拟预期掩盖失败。代码完成后再次独立审查与执行验证。

验收要求：新模拟全部通过且 0 跳过；既有本地测试 0 失败，平台限制单列；actionlint、whitespace 检查通过；提供运行报告和可复现命令。正式上线结论继续以真实保护配置及正式验收证据为准。

## 方案审核记录

独立审查 `ci_review` 已对照三个生产函数和既有测试，结论为无阻断项。实施约束：Ruleset 用例关闭经典分支保护，防止备用路径掩盖问题；正向请求的期望值从固定场景独立构造，不拿计划输出自我比对；反向场景实际调用 dispatch 并断言抛错及零请求。另一只读审查 `local_checks` 补充的身份、主机、签名、摘要、检查来源及最后推送审批限制已纳入本文。
