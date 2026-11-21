# 发布门禁模拟实施与验收

日期：2026-10-29，Asia/Shanghai。执行顺序：编写方案 → 独立审核通过 → 实施 → 首轮测试与修正 → 独立代码审核与复跑。

**结论：离线发布门禁模拟验收通过，79/79 场景，0 失败、0 跳过、0 外部 I/O 尝试。** 这证明合成输入下现有门禁及调度行为符合方案，不表示 GitHub 环境、独立审核人、正式 runner 或生产发布已就绪。所有报告保持 `simulation=true`、`productionApproved=false`。

## 方案与审核

[完整方案及审核约束](RELEASE-GOVERNANCE-SIMULATION-PLAN-2026-10-29.md) 已在实现前由独立审查通过。核心要求是直接测试生产函数、精确验证拒绝原因、阻断时零请求、正向请求独立核对，以及区分模拟待执行与实际发布批准。

完成后第二次独立审核确认：外部调用守卫先于动态模块导入安装；全部 dispatch 显式传入内存请求记录器；请求期望从调用前复制的输入独立构造；所有阻断路径实际调用 dispatch 并验证拒绝及零请求；失败不能被报告成批准。独立复跑结果同为 79/79 通过，无阻断审查问题。

## 实施内容

- [模拟入口](../scripts/testing/release-governance-simulation.mjs)：调用现有 `evaluatePreflight`、`buildPlan`、`dispatch`，覆盖三个环境、经典分支保护/规则集、runner、源码、两个 App 签名元数据、版本、N/N-1 摘要及请求失败。
- 独立模拟进程内禁止常用子进程与网络入口。发生任何误调用尝试即使被业务代码捕获，仍会令整个模拟失败；它是回归防误调用措施，不替代操作系统沙箱。
- [Quick CI](../.github/workflows/ci.yml) 增加相同模拟及报告上传。此处记录的是本地运行及工作流静态检查；提交后的云端结果以该提交的 Actions 运行记录为准。
- 未改生产门禁算法、审批要求、GitHub 环境、正式密钥或部署状态。

## 实际结果

环境：Windows，Node v22.23.3；既有私钥测试另用 JDK 17 的独立进程执行。首次最终运行时间为 2026-10-29 23:33:36（UTC+8），独立复核为 23:34:43。

| 检测 | 结果 | 说明 |
| --- | --- | --- |
| 新增离线模拟 | 79 PASS / 0 FAIL / 0 SKIP | 按场景计数；每个可形成计划的场景分别验证四个阶段 |
| 阶段阻断断言 | 198 次，全部零请求 | 环境/治理/源码失败阻断全部阶段；签名和回滚缺项按相应阶段阻断 |
| 内存请求待执行 | 98 次 | 验证精确 endpoint、POST、ref 和 inputs；结果仅 SIMULATED_REQUEST_PENDING |
| 内存请求故障 | 4 次 | 每阶段分别抛出合成拒绝，错误必须传播 |
| 计划输入拒绝 | 4 个场景 | 非完整源码 SHA、两项非法摘要、相同 N/N-1；均在调度前拒绝 |
| 无效阶段拒绝 | 1 次 | 未调用请求记录器；不重复计入 79 个场景总数 |
| 独立复跑 | 79 PASS / 0 FAIL / 0 SKIP | 同一最终脚本，0 外部 I/O 尝试 |
| 既有回归 | 14 项，13 PASS / 0 FAIL / 1 SKIP | 四组原有门禁/运维/签名/runner 测试及两项文件级发布合约测试 |
| Windows 平台跳过 | 1 项 | Linux 专用注册协议未在本次执行，不计为通过 |
| 工作流与空白检查 | PASS | actionlint 1.7.12、git diff --check 均退出 0 |

阶段断言次数是场景中的子检查，不与 79 个场景相加。既有临时密钥测试真实调用 Java 私钥挑战验证，只使用实验 keystore 的 check 模式；没有上传任何 Secret，也没有创建正式签名密钥。

初轮 77/79，两个失败均来自模拟脚本预期 Node assert.match 的错误文案与实际版本不符。生产校验已正确拒绝非法摘要；将模拟断言改为识别摘要规则后两次完整执行均通过。未改变非法输入或生产校验；初轮失败证据保留。

## 证据与复现

- [公开的合成模拟报告](evidence/release-governance-simulation-20261029.json)：逐场景预期、实际控制项、虚构请求记录、断言结果及源码 SHA256。
- 独立复核、初次失败和回归日志保留在本地 `artifacts/release-governance-simulation-20261029/`，该目录不纳入 Git。后续云端运行的模拟报告由对应 Actions 工作流上传。

模拟入口 SHA256：`f8e633dd66b4a39f5425cfcdaf3dce7a48b5d2b079569000872c95a0f1824f89`。报告同时记录三个被测生产模块的内容散列，可核对未提交工作区的实际被测代码。

在项目根目录、Node 22 下运行：

```powershell
node scripts/testing/release-governance-simulation.mjs --output artifacts/release-governance-simulation-20261029/repeat.json

$env:JAVA_HOME='C:/Program Files/Java/jdk-17'
node --test --test-reporter=tap scripts/ci/tests/release-readiness-preflight.test.mjs scripts/ci/tests/release-operations.test.mjs scripts/ci/tests/android-signing-setup.test.mjs scripts/ci/tests/recovery-runner-setup.test.mjs scripts/ci/tests/release-tools.test.mjs scripts/ci/tests/release-workflows.test.mjs
```

## 仍需真实验证的边界

模拟只验证保护配置的判断逻辑，不执行 GitHub 平台的人工审批状态机；审核人数组非空不能证明有可实际批准的独立人员。runner 的状态/标签不能证明主机隔离、操作系统或容量。Secret 名称/变量不能证明正式密钥及成品签名正确。两个不同摘要不能证明可信 N-1 存在，后续正式流程仍须验证制品及 attestation。

现有预检没有检测 quick-gate 的 GitHub App ID 或 require_last_push_approval，本次不将这两项标成已覆盖。10 月 27 日缺口仅作标明日期的合成回放，不代替 10 月 29 日实时 GitHub 检测。

本轮未重跑数据库迁移/PITR、Android 模拟器或全栈/镜像扫描；原有模拟证据可见[第 3～6 项验收](RELEASE-OPERATIONS-ACCEPTANCE-2026-10-21.md)。本次完成了新增门禁模拟的开发与验收，未据此批准正式上线。
