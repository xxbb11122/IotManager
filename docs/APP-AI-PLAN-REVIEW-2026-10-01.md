# App AI 开发方案审核报告

日期：2026-10-01。对象：[App AI 功能开发方案](/E:/CC_testP/iot-manager/docs/APP-AI-DEVELOPMENT-PLAN-2026-10-01.md)，原稿 1.0，现已修订为 1.1。

## 1. 审核结论与证据范围

沿用 Capacitor App、项目登录、Spring AI 和服务器 DeepSeek 的方向可行，知识库保持关闭符合当前范围。原方案对界面和一般错误已有覆盖，但请求事务、多设备会话并发、删除后恢复、原生异步授权等约束不足，不能直接据此宣称交付安全完成。

本次已将下表问题的整改要求写入方案 1.1，并交叉核对接口、状态、事务、保留期、兼容策略与测试条目。修订方案可作为开发依据；下表的“已修订”表示文档已修正，代码问题仍需实施并通过对应测试。

本轮使用当前工作树进行静态审核，没有调用真实 AI、改变 Docker 环境、修改业务代码或构建 APK。既有 Web / DeepSeek 成功记录只能作为原链路依据，不能充当本轮新增功能或 Android 验收证据。

## 2. 发现的问题与整改

P1：在相关流程交付前必须解决，涉及费用、数据一致性或登录可用性。P2：在对应功能验收前解决，涉及功能完整性和兼容性。所有条目均已补入方案，运行关闭条件尚待验证。

| 编号 | 级别 | 发现与触发条件 | 当前代码证据 | 方案整改位置 |
| --- | --- | --- | --- | --- |
| A01 | P1 | 只规定幂等键，未规定额度和结果事务。断网重放可能再次消耗额度；写入失败可能只保存半轮。当前无效会话查询前已经预占额度。 | [AiChatService.java:76](/E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiChatService.java:76)、[消息写入:160](/E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiChatService.java:160)、[额度事务:393](/E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiRepository.java:393) | 第 4.4 节：鉴权 / 重放优先、短事务登记与原子完成；区分每日尝试和供应商用量。 |
| A02 | P1 | 页面防连点不能阻止另一台手机或 Web 同时追问。不同键可能使用同一份旧上下文生成并交错保存消息。 | [全局信号量:62](/E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiChatService.java:62)、[会话查询:331](/E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiRepository.java:331)、[独立消息写入:346](/E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiRepository.java:346) | 第 4.4、4.5 节：数据库会话任务槽、持有者约束、统一锁顺序和消息序号。 |
| A03 | P1 | 新结果表可能绕过历史删除继续返回正文；生成期间删除或进程崩溃，未规定任务终结和迟到写入边界。 | [本人删除:355](/E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiRepository.java:355)、[定期清理:361](/E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiRepository.java:361)；新增请求表尚不存在 | 第 4.3～4.5 节：有限期限、UNKNOWN、失效持有者、正文同步删除、最小墓碑与 410 / 404。 |
| A04 | P1 | 仅接入 Browser 插件不足以处理登录：现有 navigate 调用不等待 Promise。原生浏览器打开失败可能留下待完成 PKCE 事务；关闭事件可能与成功回调竞争。 | [登录导航:275](/E:/CC_testP/iot-manager/client/src/js/auth/oidc-session.js:275)、[退出导航:392](/E:/CC_testP/iot-manager/client/src/js/auth/oidc-session.js:392)；[官方 Browser API](https://capacitorjs.com/docs/apis/browser) | 第 5 节：异步导航、对应事务清理、单授权流程、取消 / 成功回调区分。 |
| A05 | P2 | 首版关闭知识库时，本地解释提前返回且不保存；完整历史承诺无法成立。模型历史先反转再从较旧记录累加，超出预算时可能遗漏最新轮次。 | [提前返回:85](/E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiChatService.java:85)、[其他本地回答:100](/E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiChatService.java:100)、[历史选择:141](/E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiChatService.java:141) | 第 4.4、4.5 节：本地回答保存完整轮次且无模型用量；优先最近完整轮次，超长历史明确处理。 |
| A06 | P2 | 原稿笼统使用 expectedVersion 处理性格冲突，实际只覆盖保存。两位管理员启用不同版本仍会先后覆盖。保存 4,000 字符而调用仅使用 2,000 的已知缺口也需要独立验收。 | [保存冲突:72](/E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiManagementService.java:72)、[启用操作:79](/E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiManagementService.java:79)、[截断:133](/E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiChatService.java:133) | 第 3.3、4.2、4.5 节：保存最新版本与启用版本分开校验；完整指令和整体输入预算。 |
| A07 | P2 | 202 任务结果没有明确契约，当前 API 客户端把所有 2xx 当载荷返回，容易被渲染为答案。新 App 与旧服务器、旧 Web 的兼容分支也未冻结。 | [ApiClient.request:139](/E:/CC_testP/iot-manager/client/src/js/api.js:139)、[状态三字段:12](/E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiAvailabilityController.java:12)、[现有精确断言:63](/E:/CC_testP/iot-manager/client/e2e/runtime-ai-live.spec.js:63) | 第 4.2、4.3 节：能力接口、200 / 202 区分、旧无键响应保持同步、明确降级。 |
| A08 | P2 | 原稿把运行修订号放入身份隔离键，同时要求冷启动恢复；临时修订号改变会导致找不到记录。同一个服务器 ID 改地址也可能误关联旧记录。 | 原稿第 4.1 节；[当前运行配置](/E:/CC_testP/iot-manager/client/src/js/platform/runtime-config.js) 与 [上下文生命周期](/E:/CC_testP/iot-manager/client/src/main.js) | 第 3.2、4.1 节：稳定端点 / 身份分区与内存失效修订号分离；授权后恢复且限制时间。 |
| A09 | P2 | 覆盖安装和回退只列目标，没有约束签名、版本与已迁移数据库。Debug / Release 签名不同或 versionCode 未增加时可能无法完成计划中的升级验证。 | [Android 构建配置](/E:/CC_testP/iot-manager/client/android/app/build.gradle)、[已存在迁移](/E:/CC_testP/iot-manager/backend/src/main/resources/db/migration/V26__add_site_ai_metadata.sql) | 第 4.5、5、7 节：兼容增量、数据库回退验证、同应用 ID / 同证书 / 更高 versionCode。 |

## 3. 关闭问题的测试证据

| 验收组 | 必须观察到的结果 | 关闭条目 |
| --- | --- | --- |
| 请求、额度和并发 | 相同键并发、重放和轮询只占一次尝试；无效会话不扣额度；不同键的同会话请求被约束；模拟模型调用次数符合预期。 | A01、A02 |
| 提交故障和恢复 | 消息对、用量、审计、结果任一提交失败都不能出现半轮成功；调用前与调用后崩溃分别终结为失败或不确定；原生网络超时仅查询原键。 | A01、A03、A07 |
| 删除和保留 | 删除 / 清理与完成竞争后不再读取正文、不复活会话；有效墓碑返回 410、清理后 404；其他用户无法查询；恢复窗口之外不自动重放。 | A03、A08 |
| 历史和性格 | 本地回答存在于历史，模型调用数为零；时间相同的消息分页无丢失或重复；最近轮次优先；4,000 字符尾部进入模拟模型；双管理员保存 / 启用分别出现冲突。 | A05、A06 |
| 原生授权和状态 | 浏览器打开失败、用户取消、热 / 冷启动、成功回调与关闭竞争均恢复正确状态；AI 页面前后台和跨账号 / 站点 / 端点无迟到正文。 | A04、A08 |
| 兼容和交付 | 旧 Web / 旧 App 保持正常；新 App 面对旧服务能力降级；旧后端在新数据库上可回退；APK 签名、版本、哈希和覆盖安装结果可核查。 | A07、A09 |

界面和故障用例以模拟模型运行；真实 DeepSeek 调用只在最后联调用少量通用问题验证。Android 完成标准包含一台模拟器和一台真机，浏览器验收不能替代该证据。

## 4. 文档复核结果与后续条件

- 每条发现均在方案中有整改位置和对应测试；能力接口、任务响应、状态名与旧接口兼容分支已交叉核对。
- “取消等待”保留原请求恢复入口；超时有终结规则；删除使请求结果不可读，并阻止迟到持有者写入。
- 恢复稳定分区不依赖令牌值或本次修订号；App 24 小时恢复窗口小于服务端至少 30 天的幂等保留窗口。
- 性格保存与启用的预期版本分开；默认性格、旧会话固定版本、完整指令和输入上限要求一致。
- 接口契约和模拟开发可以开始；原生验收前仍须确认手机可达的 HTTPS / OIDC 地址、SDK 构建链和 APK 签名。上述条件未验证时，只能标记对应验收待完成。

此次审核关闭的是文档中的实施缺口；业务代码和运行结果的关闭状态均为待实施 / 待验收。
