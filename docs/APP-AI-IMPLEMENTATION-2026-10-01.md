# App AI 功能开发与验收记录

日期：2026-10-01。依据：[审核后的开发方案](APP-AI-DEVELOPMENT-PLAN-2026-10-01.md)、[方案审核记录](APP-AI-PLAN-REVIEW-2026-10-01.md)。

最新增量交付为 2026-10-03 的 1.1.4 / versionCode 6：登录与连接引导、联网恢复、App 网页部署和新 APK 验收见[功能完善记录](APP-AI-READINESS-IMPLEMENTATION-2026-10-03.md)。本文下方保留 10 月 1 日历史验收数据。

同日更新：已合入最新底栏动效，交付版本更新为 1.1.1 / versionCode 3；详见[动效更新与回归验收](CLIENT-AI-MOTION-UPDATE-2026-10-01.md)。

## 1. 本次实现

App 继续使用现有 JavaScript、Vite、Capacitor 8 和 Android 工程。AI 已接入主导航，包含聊天、会话历史和性格页面。请求经过项目服务器，由 Spring AI 接入远程兼容服务；供应商密钥由服务器保管。站点知识库和 Embedding 暂不启用。

| 页面 | 已实现功能 |
| --- | --- |
| AI 聊天 | 连续问答、会话固定性格、新会话、复制纯文本回答、字符限制、发送防连点、错误及限流提示。 |
| 会话历史 | 只列当前用户在当前站点的会话，游标分页、打开完整消息、加载更早消息、确认后删除。 |
| AI 性格 | 查看当前性格；OWNER / ADMIN 保存新版本并单独启用。其他角色只读。已有会话保留原版本，默认性格也固定。 |
| 异常与恢复 | 202 等待状态、查询原请求、停止本地等待、后台停止查询、前台恢复、结果未知时明确重试。 |
| 连接与权限 | 未配置、未登录、无站点权限、AI 关闭和网络不可用分别展示；读取或写入发生 401 / 403 时清空 AI 内容与管理权限。 |

原悬浮面板模块保留给旧测试和兼容引用，正式 App 不再实例化它。AI 页面使用现有导航与返回栈，设备、BLE、天气和站点模块沿用既有实现。

## 2. 代码结构

| 模块 | 职责 |
| --- | --- |
| [ai-state.js](../client/src/js/ai/ai-state.js) | 状态、限制、错误说明、稳定身份分区、恢复元数据存储。 |
| [ai-controller.js](../client/src/js/ai/ai-controller.js) | 请求、能力探测、上下文校验、恢复、历史、性格与生命周期。 |
| [ai-view.js](../client/src/js/ai/ai-view.js)、[ai.css](../client/src/css/ai.css) | 安全 DOM 渲染、响应式页面和输入区域。模型及用户文本通过 textContent 展示。 |
| [ui.js](../client/src/js/ui.js)、[main.js](../client/src/main.js) | 主导航、局部更新、焦点保留、原生浏览器、登录及前后台衔接。 |
| [AiConversationStore.java](../backend/src/main/java/com/iot/manager/ai/AiConversationStore.java) | 请求登记、数据库任务槽、消息对原子提交、结果恢复、分页和墓碑清理。 |
| [AiReplyGenerator.java](../backend/src/main/java/com/iot/manager/ai/AiReplyGenerator.java) | 使用固定性格和最近完整轮次构造输入；供应商调用发生在事务外。 |
| [AiChatService.java](../backend/src/main/java/com/iot/manager/ai/AiChatService.java) | 兼容旧同步接口、请求复用、并发限制、结果提交与异常终结。 |
| [V28 迁移](../backend/src/main/resources/db/migration/V28__add_ai_request_recovery.sql) | 增加会话任务槽、标题、消息序号和请求恢复表；保留旧写入所需的可空字段。 |
| [模拟器启动脚本](../scripts/start-android-test-emulator.ps1)、[原生测试脚本](../client/scripts/native-ai-smoke.mjs) | 使用已安装 SDK 启动现有模拟器，对安装后的 Debug APK 执行隔离模拟验收。 |

## 3. 服务端契约

所有路径均位于 /api/v1/sites/{siteId}/ai，继续执行服务器站点权限与会话归属检查。

| 接口 | 契约 |
| --- | --- |
| GET /status | 保持 enabled、knowledgeEnabled、state 三个原字段。配置启用不代表供应商实时健康。 |
| GET /capabilities | contractVersion=1；返回 history、pagedMessages、requestRecovery、idempotency、personaActivationGuard 及限制。AI 关闭时仍可查询，功能开关均为 false。 |
| POST /chat | 旧客户端不带幂等键时保持同步 200 和原五字段。新 App 使用 UUID 格式的 Idempotency-Key；完成时返回 200，同键仍在处理时返回 202 和等待提示。 |
| GET /requests/{clientRequestId} | PROCESSING、SUCCEEDED、FAILED、UNKNOWN；完成时包含原问题和已保存结果。同键查询及成功重放不再调用供应商、不再消耗尝试额度。 |
| GET /conversations | 游标分页，仅返回当前用户拥有的会话。默认 20，最大 100。 |
| GET /conversations/{id}/messages | 按单调序号分页，固定本次读取的上界，分页期间的新消息不会插入较早页面。旧无序号消息在站点锁内回填。 |
| DELETE /conversations/{id} | 同步清除消息与请求正文，使正在生成的持有者失效；迟到结果不能重建会话。 |
| PUT /persona | 名称最多 80，指令最多 4000 个 UTF-16 字符；expectedVersion 校验最新保存版本。 |
| POST /persona/{version}/activate | expectedActiveVersion 独立校验当前启用版本。旧客户端不传该字段仍兼容。 |

稳定错误码通过 fieldErrors.code 返回。请求内容不一致及会话忙碌为 409；已删除或过期请求为 410；其他用户的请求返回 404。超期处理区分尚未调用供应商的 FAILED 与调用后无法确认的 UNKNOWN。

服务端保存可恢复请求 30 天；App 自动恢复元数据只保留 24 小时。删除或过期后墓碑继续保留至少 30 天；到期清除墓碑后返回 404。若旧后端在回退期间删除会话，新后端在恢复、重放和清理前会识别孤立请求并清除正文。

## 4. 请求与上下文约束

1. 登记与完成各使用短事务，站点行锁串行保护会话任务槽。网络调用在事务外，进程内仍保留模型并发上限。
2. 相同站点、用户和键只登记一次。不同键不能并发追问同一会话。无效或他人会话不会消耗尝试额度，达到额度后仍可查询和重放成功结果。
3. USER / ASSISTANT 消息对、付费用量、审计和恢复结果一起提交。提交失败不会留下半轮；调用过供应商而未能确定结果时提示费用不确定。
4. 默认请求期限为 120 秒；供应商客户端配置为连接 5 秒、读取 30 秒，并关闭供应商自动重试。期限失效后旧持有者不能提交结果。
5. 历史输入优先最近完整轮次，最多 12 条消息和 4000 字符。最新完整轮次过长时不引入旧轮次代替，并明确提示历史未带入；完整历史仍可查看。
6. 合法性格指令完整使用，整体输入默认上限 16000 字符。超限在调用 Chat 前拒绝，避免静默截断性格。
7. App 使用稳定 API 地址、issuer、clientId、服务器 /me 核验的 subject、组织和站点隔离恢复分区；内存上下文修订号单独用于阻止迟到结果。
8. Preferences 只保存请求编号、会话编号和提交时间，最多 20 个分区，不保存问题、回答、供应商密钥或登录令牌。注销清理恢复元数据。
9. 本地恢复记录保存失败时不发送问题；断网和本地超时不自动再次 POST。GET 查询采用前台退避并遵守 Retry-After，后台及离开 AI 页面停止查询。
10. 用户先进入 AI、随后启动流程取得站点时，控制器自动加载当前页面、恢复结果及性格。新建会话会使未完成的恢复记录读取失效，防止旧请求重新出现；进入后台后停止自动读取。

## 5. Android 登录与构建

新增 @capacitor/browser 8.0.4。原生登录和退出等待 Browser.open 的异步结果；打开失败会反馈并清理所属 PKCE 事务。登录重入受保护，取消及浏览器关闭不会清理已进入令牌兑换的回调。浏览器关闭处理延迟一个短窗口，给系统深链回调先进入兑换流程的机会；该事件顺序仍需真机确认。

保留 appUrlOpen 和 getLaunchUrl 的热、冷启动回调。PKCE 事务核验 state、issuer、clientId、redirectUri 和 10 分钟有效期；ID token 核验 nonce、issuer、audience、授权方及有效期。令牌来自经校验的直接 TLS Token Endpoint，API 权限继续由资源服务器校验 JWT。对应依据：[OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation)、[Capacitor Browser](https://capacitorjs.com/docs/apis/browser)、[Capacitor App](https://capacitorjs.com/docs/apis/app)。

| 构建项 | 本次实际配置 |
| --- | --- |
| SDK | D:\电脑管家迁移文件\C盘迁移\AppData\Local\Android\Sdk；Platform 36、Build Tools 36.0.0 已定位并用于构建。 |
| Java | 后端 JDK 17；Android 构建 JDK 23。 |
| 工具链 | Gradle 8.14.3，Capacitor 8，applicationId=com.iot.manager.client。 |
| 版本 | 默认 versionCode=3，versionName=1.1.1；受保护发布配置仍可覆盖版本。 |
| 安装包 | 本次交付 Debug APK，不能当作正式发布签名包。覆盖旧包需相同证书及更高 versionCode。 |
| 原生网络 | CapacitorHttp 已通过模拟器问答、性格和结果恢复测试；真实设备的超时、中断、证书及网络切换仍待验收。 |

构建使用现有 npm run android:debug，Android 同步会重新生成 Browser 插件引用。旧 C 盘 SDK 路径不能直接枚举，本次使用已验证的 D 盘真实路径，未迁移或删除 SDK 文件。

模拟器启动已修复并通过冷启动验证：启动脚本使用英文路径别名、现有 WHPX 加速及软件图形配置。已同签名验证 1.0.0 → 1.1.0 / 2，本次动效更新进一步覆盖升级至 1.1.1 / 3。横屏宽布局已保留顶部安全区；原生测试同时检查系统返回、软键盘、点击区域及底栏。详见[原生测试与复现](APP-AI-NATIVE-TEST-2026-10-01.md)。

## 6. 验证结果

| 验证项 | 实际结果 | 证据 |
| --- | --- | --- |
| 后端全量测试与打包 | 189 项通过，失败 0、错误 0、跳过 0，BUILD SUCCESS。 | [Maven verify](../artifacts/app-ai-backend-verify.log) |
| 请求恢复契约 | 同一组 13 项测试分别在 H2 和真实 PostgreSQL 运行，均通过；包含旧后端删除后的恢复正文清除。 | 同上，AiRequestRecoveryIntegrationTest / AiRequestRecoveryPostgresIntegrationTest。 |
| PostgreSQL 升级与旧写入方式 | V25 升级至 V28，非超级用户迁移、旧消息写入及旧迁移校验通过。完整生产应用回退演练未执行。 | 同上，AiUpgradePostgresIntegrationTest。 |
| 客户端单元测试 | 194 项通过，失败 0、跳过 0；包含启动时序和恢复记录读取竞争回归。 | [Node 测试](../artifacts/release/app-ai-motion-20261001/client-unit.log) |
| 前轮完整浏览器回归 | 48 项通过，8 项部署环境专用测试未启用；本次执行相关 11 项回归。 | [前轮完整浏览器回归](../artifacts/app-ai-client-e2e-all.log) |
| 最终 AI 页面模拟验收 | 6 项通过：焦点与安全渲染、历史删除、4000 字符性格、角色只读、离开返回恢复及宽屏安全区；覆盖 390、700 和 900 像素宽度。 | [本次浏览器测试](../artifacts/release/app-ai-motion-20261001/client-browser.log) |
| 动效及移动端回归 | 底栏 1 项、启动 3 项、移动端主流程 1 项通过；与 AI 合计 11 项通过。 | 同上。 |
| 旧 Web 界面兼容 | Console 1 项、Frontend 2 项单元测试通过；两者构建成功。 | [Console](../artifacts/app-ai-console-tests.log)、[Frontend](../artifacts/app-ai-frontend-tests.log) |
| Android 构建 | 最终 Debug APK 构建成功，Browser 插件已同步；Web 构建版本与原生版本均为 1.1.1。 | [Android 构建](../artifacts/release/app-ai-motion-20261001/android-build.log) |
| 原生模拟验收 | 已安装 APK 的 11 项测试通过：新增底栏位置、快速切换和减少动态效果，既有问答、历史、4000 字符性格、键盘、系统返回、元数据隔离、后台暂停、进程重启恢复、旋转安全区及浏览器打开返回均通过。 | [原生结果](../artifacts/release/app-ai-motion-20261001/native-ai-results.json)、[运行日志](../artifacts/release/app-ai-motion-20261001/native-ai-smoke.log) |
| 密钥隔离 | 公共构建环境检查通过；最终 APK 的 Web 资产逐一检查，未包含服务器当前 Chat 密钥；扫描数量和校验值见清单。APK 签名校验通过。 | [构建清单](../artifacts/release/app-ai-motion-20261001/build-manifest.json) |

测试过程中发现并修正：旧运行时夹具仍模拟悬浮面板、旧迁移版本断言、部署回退测试缺少运行环境开关、恢复存储失败后可能继续发送、权限撤销后性格页残留数据、回退旧后端删除后的恢复正文残留、410 后本地旧会话未清空，以及 640～819 像素宽度下新增导航可能换行。

模拟测试不调用 DeepSeek 或 Embedding。已有部署记录中的真实 DeepSeek 调用属于此前验证，不能当作本次新 APK 的运行结果。

本轮原生验收发现并修正了启动后站点晚到时不自动查询已保存结果的问题，同时补足历史和性格加载。复核还修正了恢复记录读取期间新建会话可能重新引入旧请求，以及宽屏样式覆盖顶部安全区的问题。

### 6.1 Windows Docker 后端升级

本机 iot-manager-p0 后端已构建并更新。升级前创建了受保护的数据库备份，保留旧镜像标签 iot-manager-backend:before-app-ai-20261001。启动日志确认追加 V28 成功，容器健康检查为 healthy，应用数据库角色具备请求恢复表的 SELECT / INSERT / UPDATE / DELETE 权限。未修改供应商密钥及知识库开关。

证据：[镜像构建](../artifacts/app-ai-runtime-build.log)、[启动与迁移](../artifacts/app-ai-runtime-startup.log)、[数据库版本与权限](../artifacts/app-ai-runtime-db.log)。备份位于 deploy/.runtime/iot-manager-p0 内，权限沿用受保护密钥文件，未放入公共交付目录。回退服务必须配合旧镜像和既有部署流程；不删除 V28 数据表，不在运行数据库上直接执行备份覆盖。

### 6.2 APK 交付

[下载最新 Debug APK](../artifacts/release/app-ai-motion-20261001/iot-manager-ai-1.1.1-debug.apk)

- applicationId：com.iot.manager.client。
- versionName：1.1.1；versionCode：3。
- 大小及 SHA-256：[构建清单](../artifacts/release/app-ai-motion-20261001/build-manifest.json)。原生结果中的安装包哈希须与此清单一致。
- 签名证书 SHA-256：55135dbb4ac115bc0db023544ccc184472f9023f51bf767161a0ca6ba11a6e0d。
- 包类型：Debug；模拟器升级安装与运行通过，真机安装及新 APK 的真实 DeepSeek 对话尚未执行。

上一版 [1.1.0 Debug APK](../artifacts/release/app-ai-20261001/iot-manager-ai-1.1.0-debug.apk)保留；更新记录及本次专项证据见[动效更新报告](CLIENT-AI-MOTION-UPDATE-2026-10-01.md)。

## 7. 当前验收边界与后续步骤

用户确认暂时没有手机可访问的 HTTPS 地址及测试手机。功能代码、数据库迁移、模拟和浏览器回归、APK 构建及模拟器安装运行已完成。原生测试使用本机隔离模拟服务，未接入真实 DeepSeek；完整 OIDC 登录及真机网络验收仍需对应环境。

正式原生验收还需：

1. 手机能访问的 HTTPS API / OIDC 端点及受信任证书，并在 Keycloak 注册原生公开客户端和自定义回调地址；无需在 App 中放供应商密钥。
2. 连接一台真机，确认旧包的签名及版本，安装后复核返回键、软键盘、安全区、旋转、前后台、网络切换及进程重启恢复；模拟器已通过对应模拟用例。
3. 在真实 Android 上完成完整 OIDC 登录，验证打开失败、取消、热 / 冷启动、回调与关闭竞争及证书，并检验 CapacitorHttp 的超时和中断。本次 Browser 插件的打开与返回测试没有执行身份认证。
4. 使用服务器当前受保护 DeepSeek 配置执行少量真实通用提问，检查历史、用量、审计和零 Embedding 调用。未执行之前不得把模拟回答当成真实联调通过。
5. 使用既有受保护发布证书构建正式 APK / AAB。没有核对旧包证书时不卸载旧包、不生成替代证书、不承诺覆盖安装成功。

更换模型供应商时修改服务器协议适配、base URL、模型、允许主机与受保护密钥，并复验兼容接口。App 继续调用项目 API，不绑定 DeepSeek SDK。知识库、流式输出和语音功能属于后续独立迭代。
