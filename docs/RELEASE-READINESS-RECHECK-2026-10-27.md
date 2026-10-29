# 发布就绪状态复检

检测日期：2026-10-27，Asia/Shanghai。对象：`xxbb11122/IotManager`，重点复核此前第 2 项“三个受保护发布环境”，并检查相关发布工具与 CI 证据。

**结论：第 2 项仍未完成，正式发布仍为 NO_GO。** 本次实时读取未发现保护环境、独立审核人或专用 runner 已补齐。现有开发与模拟测试记录不能代替这些接入条件。

## 实时 GitHub 状态

治理预检：2026-10-27 09:56:58（UTC+8），8 项检查结果为 **4 PASS / 2 FAIL / 2 UNKNOWN**，`productionApproved=false`。随后 09:58 的 API 快照确认以下配置。

| 检查项 | 本次结果 | 证据与影响 |
| --- | --- | --- |
| 默认分支保护 | PASS | `main` 有效保护；严格要求 `quick-gate`；管理员受约束；禁止强推和删除 |
| PR 审核规则 | PASS（规则存在） | 至少 1 次批准、代码变更使旧批准失效、最后一次推送须获批准、要求解决讨论。规则存在不等于当前 PR 已获批准 |
| `r1-recovery-drill` | FAIL | 已存在，但 `protection_rules=[]`、`can_admins_bypass=true`，无发布分支限制 |
| `r1-rollback-drill` | 未创建 | 完整环境列表不包含此项，单项 API 返回 404；预检工具保守标记 UNKNOWN |
| `android-release` | 未创建 | 同上；对应保护环境及其正式签名配置接入未完成 |
| 独立审核人 | 未补齐 | 协作者列表仍只有 `xxbb11122`，角色 admin；未看到新增独立审核人 |
| 专用恢复 runner | FAIL | 仓库注册 runner 总数为 0 |
| 正式 GitHub Release | 未发布 | API 列表为空；此项本身不用于断言所有 OCI 证据均不存在 |

本地 HEAD：`0cd5b44d9fd0e201a2d0334df3f706e14158aef3`。
默认分支 HEAD：`1bb5075e3077b29ffc750700fe0b8b6ca0c31121`。
两者不同，当前修复分支仍需完成审核合并，才能满足发布工具要求的“候选等于受保护默认分支 HEAD”。

原始治理预检 JSON 和 GitHub 配置快照保留在本地 `artifacts/recheck-20261027/`，该目录不纳入 Git。

## 本次重新执行的测试

在 Windows 本机使用 Node v22.23.3、JDK 17 重新执行以下四个现有测试文件：`release-readiness-preflight.test.mjs`、`release-operations.test.mjs`、`android-signing-setup.test.mjs`、`recovery-runner-setup.test.mjs`。

结果：**12 项，11 PASS / 0 FAIL / 1 SKIP**。跳过项为仅支持 Linux 的 runner 注册协议；未将其计为通过。签名测试创建临时实验密钥，实际验证私钥与错误密码拒绝，不接触正式密钥。治理测试覆盖缺少审批、管理员绕过等条件时阻止发布；测试通过不代表真实 GitHub 配置合格。

`git diff --check` 和 actionlint 1.7.12 均退出 0，工作流静态检查无诊断。开始检测时已跟踪源码无未提交修改，保留工作区原有未跟踪文件；本轮只新增本报告及检测证据。

Node TAP、actionlint 和 Git whitespace 日志保留在本地 `artifacts/recheck-20261027/local/`。

## 最新 CI 与正式验收记录

2026-10-27 09:59 起重新读取 GitHub API，以下是**已存在运行记录的复核，不是今天重跑远程 CI**。

| 检查 | 被测提交 / 实际运行日期 | 结果与范围 |
| --- | --- | --- |
| [PR Quick CI](https://github.com/xxbb11122/IotManager/actions/runs/39577950680) | 当前 HEAD `0cd5b44`，10 月 21 日 | success，8 个 job 全部通过 |
| [分支 Quick CI](https://github.com/xxbb11122/IotManager/actions/runs/39577943293) | 当前 HEAD `0cd5b44`，10 月 21 日 | success |
| [PR P0 Docker Runtime](https://github.com/xxbb11122/IotManager/actions/runs/39577950722) | 当前 HEAD `0cd5b44`，10 月 21 日 | success，普通 Compose 集成通过；正式 Immutable 12-service job 为 SKIPPED，不能视作正式发布验收 |
| [运维模拟](https://github.com/xxbb11122/IotManager/actions/runs/39574579331) | `c95fb44`，10 月 21 日 | success；该提交至当前 HEAD 仅四份文档变化。双库迁移、新备份链/PITR 及 Linux 注册协议的范围见原验收报告 |

[PR #2](https://github.com/xxbb11122/IotManager/pull/2) 仍为 OPEN、未合并，`REVIEW_REQUIRED`、`mergeStateStatus=BLOCKED`，审核列表为空。`mergeable=true` 仅表示没有合并冲突，不能视为审批通过。

正式工作流读取结果：Release Integrity Gate 的运行总数为 0；Android Release 不在当前工作流列表，对应运行查询返回 404；恢复演练只有一条 10 月 1 日的 cancelled 记录；回滚演练只有两条 9 月 24 日的 failure 记录。**没有发现新的正式 Gate、正式 Android 签名、受保护恢复或回滚成功记录。** 旧取消和失败记录不归因于当前修复提交。

CI 原始数据与摘要保留在本地 `artifacts/recheck-20261027/ci/summary.json`。

本次没有重新执行完整镜像构建、漏洞数据库扫描、远程全套集成或数据库迁移/PITR；不能由本次检查宣称截至今日新增漏洞为零，也不更新历史模拟容量与恢复时间结论。

## 整改顺序

1. 确定审核方式。保留当前独立审核标准时，补充可信审核人；单人维护方案此前仅作备选讨论，本轮未收到选择或降低规则的授权。
2. 配置三个环境：指定审核人、禁止自批、禁止管理员绕过、仅允许受保护分支。配置完成后重新执行治理预检。
3. 注册并启动隔离 Linux 恢复 runner，使其具备要求的标签及在线状态。
4. 在保护环境下接入两个 App 各自已有的正式签名配置，完成修复 PR 审核合并。
5. 对同一受保护默认分支提交执行正式 Gate、签名、恢复及具备合格 N-1 证据的回滚验收，再决定上线。

本轮不修改 GitHub 保护策略，不合并 PR，不触发正式部署。手机/PDA 延续模拟验收范围；不将模拟审批或实验密钥当作正式发布证据。
