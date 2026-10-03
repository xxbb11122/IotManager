# IoT Manager Glass Next

基于 IoT Manager 客户端 **1.1.3** 的独立新版 App，已同步 **1.1.4** 的 AI 登录引导、连接检查与断网恢复。使用轻毛玻璃与液态玻璃界面，保留启动动画、局部状态更新、设备能力控制、命令回执、天气位置与预报、AI 会话/历史/性格、OIDC 登录、LAN/Edge 和 Android 原生 BLE 链路。

运行入口使用真实客户端的 API、WebSocket、鉴权、缓存和原生适配器。模拟数据仅用于开发预览和自动测试；生产构建会检查并排除开发预览。

## 🤖 App AI 助手

AI 是本 App 的主导航功能之一：登录并选择获授权站点后即可进入 AI 工作区。

- **服务器端远程 Chat：** App 只调用 IoT Manager API；后端使用 Spring AI 与当前 DeepSeek 兼容服务通信，API 密钥只保存在服务器。更换兼容模型服务时调整后端配置，App 不绑定供应商 SDK。
- **IoT 运维对话：** 支持会话历史、沿用会话创建时的性格版本、断网恢复和请求查询，避免网络重试造成重复提问。
- **可定制 AI 性格：** OWNER / ADMIN 可创建并启用版本化性格，其他角色只读；旧会话保留当时使用的版本。
- **明确的知识库边界：** Chat 可单独启用；知识库与 Embedding 当前默认关闭，不能将回答描述为基于站点知识库检索。
- **试点状态：** `IOT_AI_ENABLED=false` 为默认值。生产环境启用前仍需完成模型隐私、成本、权限及真实部署验收。

详见[Glass Next 验证记录](VERIFICATION.md)。

| 项目 | Glass Next |
| --- | --- |
| 源码基线 | 客户端 1.1.3；来源提交和文件摘要见 [source-provenance.json](source-provenance.json) |
| 当前版本 | 1.1.4-glass.4 / Android code 8 |
| 开发/预览端口 | 5190 |
| Android 包名 | `com.iot.manager.glassnext` |
| Android 显示名称 | IoT Manager Glass |
| 原生登录回调 | `com.iot.manager.glassnext://oauth/callback` |

本目录拥有独立源码、依赖锁、构建、测试和 Android 工程；运行时不读取原 `client/` 或之前的玻璃演示。Android 包名及浏览器端口不同，可与原 App 并存。原生数据存储随独立包隔离，浏览器数据随独立端口隔离。

## 启动与真实后端

使用 Node.js 22 或更新版本，在本目录运行：

```powershell
npm ci --no-audit --no-fund
npm run dev
```

也可双击 [start-app.cmd](start-app.cmd)。浏览器访问 **http://127.0.0.1:5190/**。

开发服务器默认将 `/api` 与 `/ws` 转发到 `localhost:8080`。需要连接真实服务器时，在本机未跟踪的 `.env.development.local` 中设置可访问的 HTTPS API 地址和 CA 文件路径；不要把机器专属地址、CA 私钥或供应商密钥提交到 Git。此开发配置不参与 Android/生产构建。

**手机接入：** 使用部署方提供的 HTTPS 地址，先按设备要求信任服务端证书，再安装对应版本 APK 或打开网页 App。电脑开发端的 `http://127.0.0.1:5190/` 只在运行 Vite 的电脑上可用。登录后选择已授权站点，点击底栏 **AI**；快捷提问只填入草稿，点击“发送”才会生成回答。“历史”用于查看会话；“性格”中的保存与启用仅对组织所有者或管理员开放。通用部署入口见[部署指南](../../deploy/DEPLOYMENT.md)。

手机接入使用部署方提供的 HTTPS 入口与受信任证书；可选的 Compose 覆盖方式见[部署指南](../../deploy/DEPLOYMENT.md)。本机 Docker 特殊路径通过环境变量配置，不写入仓库。

可在“连接设置”中测试并保存现场 API、WebSocket 或云端 OIDC 配置。后端不可用时会显示失败/缓存状态。收到 401 会引导登录；检查连接成功且身份相同时保留当前草稿与会话。

生产构建：`npm run build`。部署时为 `/api` 与 `/ws` 配置现有后端的反向代理，或设置公开的端点参数。Android 真机需要能访问电脑/服务器的实际网络地址，模拟器地址 `10.0.2.2` 仅用于本机 Android 模拟器。

## 独立登录配置

新包名使用独立的回调 URI。将 [Keycloak 客户端示例](keycloak-client.example.json)作为 public client 的配置参考，在当前 realm 登记新客户端或将新回调加入经过核对的 public client。

公开客户端为 `iot-glass-next`，启用 Authorization Code + PKCE S256；部署时应登记电脑开发回调 `http://127.0.0.1:5190/`、对应的 `https://<SERVER_HOST>/glass/` 和上表 Android 回调。更换网络地址需要同步服务器公开地址、回调与构建配置。

`.env.example`只包含公开端点元数据。浏览器开发设置放在 `.env.development.local`；Android 构建可使用 `.env.production.local` 中的 `VITE_NATIVE_API_BASE_URL`、`VITE_NATIVE_WS_URL`、OIDC Issuer、Client ID 和新回调。不得把浏览器回调配置成 Android 回调。账号和令牌通过运行时登录及安全存储获取，供应商密钥只保存在服务器。

## Android

保留最新版的原生启动协调器、SecureSession、BLE、定位、网络及 Browser 插件。需要 JDK 23 和可访问的 Android SDK 36。

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-23'
# 将 ANDROID_HOME 替换为本机 SDK 路径；也可在 android/local.properties 配置 sdk.dir。
$env:ANDROID_HOME = '<Android SDK path>'
npm run android:sync
npm run android:debug
```

Debug APK 输出为 `android/app/build/outputs/apk/debug/app-debug.apk`。Release 构建沿用现有签名输入与传输限制，使用本工程的独立包名。

## 验证

```powershell
npm test
npm run test:e2e
npm run build
```

测试运行最新版的真实模块；浏览器测试通过网络与硬件边界的测试替身验证客户端行为。需要真实 Keycloak、Docker、AI 供应商或发布环境的用例保留原有的显式启用条件。

真实 AI 验收需要额外指定 `IOT_E2E_OWNER_PASSWORD_FILE`，使用你自己的私密凭据文件。本工程不会读取原工程部署目录中的凭据。模拟器测试日志、截图、APK 与端点配置均为本地生成文件，不纳入 Git。

[当前验证记录](VERIFICATION.md)列出实际执行结果。界面显示支持混合玻璃、轻毛玻璃、实色及独立的减少动画设置；高对比度使用实色。设备详情采用连续面板，天气位置表单支持折叠。
