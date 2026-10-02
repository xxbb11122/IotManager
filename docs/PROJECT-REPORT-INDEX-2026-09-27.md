# IoT Manager 全部报告与项目文档索引

> 盘点日期：2026-09-27（Asia/Shanghai）  
> 代码候选：`7675df84906732fa675e35c7520dfb7b75a5d1f7`  
> 范围：审核开始时，Git 已跟踪或未被忽略的项目 Markdown 共 **49 份**，其中 **46 份已跟踪、3 份未跟踪**。不包括依赖、构建产物、临时日志、聊天附件及本轮新报告。  
> 本轮结论入口：[项目综合审核报告](PROJECT-COMPREHENSIVE-AUDIT-2026-09-27.md)。

## 1. 怎么阅读

先读本轮综合审核报告，了解当前代码、CI、缺陷与验收缺口；再按下面的索引查看依据。**历史报告里的“当前”“已通过”只对它标注的日期、工作区或 SHA 有效。** 计划、审批、实施、测试、运行手册是不同类别，不互相替代。

本轮同时交付[全部报告原文汇编](PROJECT-REPORTS-FULL-COLLECTION-2026-09-27.md)：前部是本轮综合审核，后部包含下面 49 份文档的完整 Markdown 源文、相对路径、Git 状态、字节数和 SHA-256。源文使用代码围栏保存，以避免合并后同名标题、相对链接或 HTML 改变原文含义；需要原排版时打开本索引链接的源文件。汇编不是一份新的统一开发指令，也不会自动覆盖原审批关系。

三个未跟踪文件已纳入此次本地交付，但**纳入汇编不等于已提交 GitHub**。本轮不修改原始报告，也不改写其历史测试结果。

## 2. 分类总览

| 分类 | 数量 | 用途 |
| --- | ---: | --- |
| A 项目介绍、审批、路线图与综合进度 | 10 | 定位、范围、历史状态 |
| B P0/R1、三项可靠性与天气 | 11 | 专项开发依据、测试和整改 |
| C 客户端动效与预览 | 9 | 最新客户端设计、实施与验收边界 |
| D 部署、验证、安全与证据运维 | 12 | 实际执行入口和发布政策 |
| E Edge、固件与设备 Profile | 3 | 接入协议和模块使用 |
| F 早期移动端设计与实施计划 | 4 | 历史设计追溯 |
| **合计** | **49** | **46 已跟踪 + 3 未跟踪** |

日期和版本以文内声明为准；“未单列”不代表文件没有 Git 历史。下表“已跟踪”指盘点时已受 Git 管理，不是说文件中全部验收项已经通过。

## 3. A：项目介绍、审批、路线图与综合进度（10）

| 编号 | 源文档 | 文内日期/版本 | 当前阅读定位 | Git 状态 |
| --- | --- | --- | --- | --- |
| A01 | [项目介绍 / README](../README.md) | 滚动维护 | 入口介绍仍引用较早候选；最新事实先看本轮审核 | 已跟踪 |
| A02 | [早期项目评估](../PROJECT-EVALUATION.md) | 2026-08-20 | 历史评价，部分 API/完成状态已过时 | 已跟踪 |
| A03 | [严格审批意见](PROJECT-APPROVAL-REVIEW.md) | 2026-08-20 / v1.3 | 范围与 Gate 的最高优先级依据；不是当前 Gate 签发记录 | 已跟踪 |
| A04 | [整改与升级实施基线](PROJECT-IMPROVEMENT-PLAN.md) | 2026-08-21 / v1.6 | 审批对象；旧迁移编号规划须与当前 V25 对账 | 已跟踪 |
| A05 | [功能扩展评估与路线图](FEATURE-EXPANSION-EVALUATION-AND-ROADMAP.md) | 2026-08-20 / v1.3 | 范围补充提案，不能自动扩大 R1 | 已跟踪 |
| A06 | [早期实施状态](IMPLEMENTATION-STATUS.md) | 2026-08-21 快照 | 已明确归档，不能当最新测试结果 | 已跟踪 |
| A07 | [项目进度介绍](PROJECT-PROGRESS-OVERVIEW.md) | 2026-08-30 | 历史进度说明 | 已跟踪 |
| A08 | [8月30日严格审计](PROJECT-AUDIT-2026-08-30.md) | 2026-08-30 | 历史审核与当时阻断项 | 已跟踪 |
| A09 | [9月1日全维度审计](CURRENT-PROJECT-REPORT-2026-09-01.md) | 2026-09-01 / v1.1 | 历史 SHA 的综合审计，不自动继承到最新候选 | 已跟踪 |
| A10 | [9月2日进度评价](PROJECT-PROGRESS-EVALUATION-2026-09-02.md) | 2026-09-02 / v1.0 | 旧测试数、旧迁移和百分比不用于当前放行 | 已跟踪 |

## 4. B：P0/R1、三项可靠性与天气（11）

| 编号 | 源文档 | 文内日期/版本 | 当前阅读定位 | Git 状态 |
| --- | --- | --- | --- | --- |
| B01 | [P0 Docker 全链路开发方案](P0-DOCKER-FULL-CHAIN-DEVELOPMENT-PLAN.md) | 2026-08-30 / v1.3 | 全链路工程方案；当前普通 Runtime 成功不等于正式发布批准 | 已跟踪 |
| B02 | [R1 收敛开发文档](R1-COMPLETION-DEVELOPMENT-PLAN.md) | 2026-08-25 / v1.0 | R1 实施补充，验收须绑定当前候选 | 已跟踪 |
| B03 | [R1 收尾实施状态](R1-COMPLETION-IMPLEMENTATION-STATUS.md) | 2026-08-30 / v1.2 | 8月实施快照，部分阻断状态已被后续代码推进 | 已跟踪 |
| B04 | [可靠性与发布闭环方案](R1-RELIABILITY-AND-RELEASE-CLOSURE-PLAN.md) | 2026-09-21 / v1.0 | 三工作包的上层收敛方向 | 已跟踪 |
| B05 | [时间/回滚/保留增补 v1.0](R1-RELIABILITY-ADDENDUM-TIME-ROLLBACK-RETENTION.md) | 2026-09-22 / v1.0 | 原始提案；与修订稿区分阅读 | 已跟踪 |
| B06 | [时间/回滚/保留增补 v1.1](R1-RELIABILITY-ADDENDUM-TIME-ROLLBACK-RETENTION-v1.1.md) | 2026-09-22 / v1.1 | 修订开发依据；文首“待实施”不是当前实现状态 | 已跟踪 |
| B07 | [可靠性测试方案与执行标准](R1-RELIABILITY-TEST-PLAN-AND-ACCEPTANCE-v1.0.md) | 2026-09-24 / v1.0 | 59 编号用例、S0～S7 门禁；尚缺当前候选逐项闭环 | **未跟踪** |
| B08 | [可靠性测试整改方案](R1-RELIABILITY-TEST-REMEDIATION-PLAN-v1.0.md) | 2026-09-24 / v1.0 | 依据旧失败报告制定；修复与剩余项看本轮映射 | **未跟踪** |
| B09 | [9月24日专项测试报告](R1-RELIABILITY-TEST-REPORT-2026-09-24.md) | 2026-09-24 | `609c9f0`：0 PASS / 5 FAIL / 54 BLOCKED，保留历史原值 | 已跟踪 |
| B10 | [9月25日阶段性复测报告](R1-RELIABILITY-TEST-REPORT-2026-09-25.md) | 2026-09-25 | `ee036dd`：1 PASS / 3 FAIL / 55 BLOCKED，非当前 SHA 完整复测 | **未跟踪** |
| B11 | [天气与环境状态开发文档](weather-feature-development.md) | 历史设计稿 | 原始规则与界面需求；不替代供应商审查、真机或现场环境验收 | 已跟踪 |

## 5. C：客户端动效与预览（9）

| 编号 | 源文档 | 文内日期/版本 | 当前阅读定位 | Git 状态 |
| --- | --- | --- | --- | --- |
| C01 | [动效覆盖登记册](CLIENT-MOTION-COVERAGE-REGISTER.md) | 2026-09-27 | 42 设计场景的登记；登记不等于逐项验收 | 已跟踪 |
| C02 | [早期动效框架](CLIENT-MOTION-DESIGN-FRAMEWORK.md) | 草案 v1 | 历史草案，完整范围以全覆盖框架 v3 为准 | 已跟踪 |
| C03 | [Android/PDA 基础动效设计](CLIENT-MOTION-DESIGN-PLAN.md) | 2026-09-24 / v3 | 基础阶段记录，不代替全 App 全平台验收 | 已跟踪 |
| C04 | [全 App 动效开发方案](CLIENT-MOTION-DEVELOPMENT-PLAN.md) | 2026-09-27 / v1.1 | 当前实施计划与流程 | 已跟踪 |
| C05 | [全 App 动效覆盖框架](CLIENT-MOTION-FULL-COVERAGE-FRAMEWORK.md) | 2026-09-27 / v3 | 当前设计基线，实施前差距列不能当最新进度 | 已跟踪 |
| C06 | [动效实施与自检报告](CLIENT-MOTION-IMPLEMENTATION-REPORT.md) | 2026-09-27 | 159 单元/27 指定浏览器用例为本地报告；当前 CI 选择范围另见本轮审核 | 已跟踪 |
| C07 | [动效前置条件与验收工作表](CLIENT-MOTION-PREFLIGHT-AND-ACCEPTANCE.md) | 2026-09-27 | 保留真实平台、硬件、可访问性和性能门禁 | 已跟踪 |
| C08 | [启动动画历史设计](CLIENT-STARTUP-ANIMATION-DESIGN.md) | 未单列 | 历史视觉候选；当前采用 ready-first 静态提示，不是强制动画等待 | 已跟踪 |
| C09 | [开发态合成预览使用说明](../client/src/dev/motion-preview/README.md) | 未单列 | serve-only 合成预览；不接真实网络/GPS/BLE，不是生产页面 | 已跟踪 |

## 6. D：部署、验证、安全与证据运维（12）

| 编号 | 源文档 | 文内日期/版本 | 当前阅读定位 | Git 状态 |
| --- | --- | --- | --- | --- |
| D01 | [P0/R1 Docker 运行手册](../deploy/DEPLOYMENT.md) | 未单列 | 部署主手册；执行前确认环境与授权，不能由阅读触发启动/清理 | 已跟踪 |
| D02 | [部署入口](../deploy/README.md) | 未单列 | 指向唯一运行手册 | 已跟踪 |
| D03 | [CI 与 Release 运行手册](CI-RELEASE-RUNBOOK.md) | 未单列 | 区分 Quick CI 与受保护发布路径 | 已跟踪 |
| D04 | [数据保留运行手册](DATA-RETENTION-RUNBOOK.md) | 未单列 | 开关、dry-run、hold、归档与启用条件 | 已跟踪 |
| D05 | [证据交接与可信生产者](EVIDENCE-HANDOFF.md) | 未单列 | 同候选、摘要与生产者身份的证据合同 | 已跟踪 |
| D06 | [运行镜像安全状态](IMAGE-SECURITY-STATUS.md) | 2026-09-01 / v1.1 | 历史镜像安全快照，不能当今日扫描计数 | 已跟踪 |
| D07 | [不可变镜像供应链](IMAGE-SUPPLY-CHAIN.md) | 未单列 | 8 制品/12 服务/恢复并集等交付边界 | 已跟踪 |
| D08 | [镜像与发布证据保留](REGISTRY-RETENTION.md) | 未单列 | N/N−1/N−2 与长期证据保留政策，需实际读回验收 | 已跟踪 |
| D09 | [Runner 可靠性与恢复](RUNNER-RECOVERY.md) | 未单列 | 基础设施失败分类、升级和恢复规则 | 已跟踪 |
| D10 | [9月1日安全基线证据](SECURITY-BASELINE-EVIDENCE-2026-09-01.md) | 2026-09-01 | 当时工具链/扫描/运行证据；不是当前发布批准 | 已跟踪 |
| D11 | [验证入口与工具链](VERIFICATION.md) | 未单列 | 指定工具链和执行命令；实际覆盖以脚本/工件为准 | 已跟踪 |
| D12 | [VEX 例外政策](VEX-POLICY.md) | 未单列 | 例外必须精确、有期限、有批准；不允许用文档代替扫描 | 已跟踪 |

## 7. E：Edge、固件与设备 Profile（3）

| 编号 | 源文档 | 文内日期/版本 | 当前阅读定位 | Git 状态 |
| --- | --- | --- | --- | --- |
| E01 | [Edge Agent 说明](../edge-agent/README.md) | 未单列 | Java 17 接入进程、身份与协议；真实设备仍需验证 | 已跟踪 |
| E02 | [nRF52840 参考固件](../firmware/nrf52840-reference-switch/README.md) | 工具链见文内 | NUS、token ACK、参考负载与编译说明；本轮未编译/烧录 | 已跟踪 |
| E03 | [设备 Profile 说明](../profiles/README.md) | 未单列 | 设备能力定义与前后端一致性来源 | 已跟踪 |

## 8. F：早期移动端设计与实施计划（4）

| 编号 | 源文档 | 文内日期/版本 | 当前阅读定位 | Git 状态 |
| --- | --- | --- | --- | --- |
| F01 | [企业移动端基础实施计划](superpowers/plans/2026-07-25-enterprise-mobile-client-foundation.md) | 2026-07-25 | 历史实施计划；步骤不是本轮执行授权 | 已跟踪 |
| F02 | [Capacitor Android 实施计划](superpowers/plans/2026-07-26-capacitor-android-client.md) | 2026-07-26 | 历史打包/平台方案，不代表当前 Release 验收 | 已跟踪 |
| F03 | [企业移动端 B 设计](superpowers/specs/2026-07-25-enterprise-mobile-client-b-design.md) | 2026-07-25 | 早期设计来源 | 已跟踪 |
| F04 | [Capacitor Android 设计](superpowers/specs/2026-07-26-capacitor-android-client-design.md) | 2026-07-26 | 早期原生壳与离线设计来源 | 已跟踪 |

## 9. 缺失的不是文件，而是尚未形成的验收结果

当前未找到能够对最新候选完整放行的以下报告，不能用上面的计划或历史记录充数：

- 当前 SHA 的 59 项可靠性用例逐项结案报告及同 SHA 连续两次普通 P0 成功记录。
- 当前不可变镜像全扫描、受保护 Release Gate、可信签名与长期证据读回通过报告。
- 真实同库 N→N−1 回滚、远端 WAL-G PITR、清理后恢复对账及 RPO/RTO 达标报告。
- Android 签名 Release 与真机 GPS/BLE/权限/升级回退/弱网长稳/可访问性验收报告。
- 1000 设备压力及容量、长期稳定性、多副本实时行为验收报告。

这些是“待补证据/待验收”，并不等于本轮已经复现了对应功能失败。具体优先级、负责人角色与关闭标准见[本轮综合审核第 5、13 节](PROJECT-COMPREHENSIVE-AUDIT-2026-09-27.md)。

## 10. 汇编核验规则

生成汇编时必须核对：清单无重复；49 份源文件全部存在；Git 状态为 46 已跟踪加 3 未跟踪；每份源文与读取时的 SHA-256 一致；输出不反过来进入源清单；本轮报告和索引的本地链接可解析。汇编附有完整摘要清单，便于发现后续内容变化。

本索引只新增分类与当前阅读提示，不重写任何源文档中的范围、审批或测试结果。
