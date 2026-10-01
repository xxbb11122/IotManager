# Windows Docker 上线 DeepSeek 聊天：准备与验收

**范围：** 本机 `iot-manager-p0` Docker Compose 环境；只开启远程 Chat。知识库及 Embedding 保持关闭。该环境使用集成账号、本机域名和文件系统备份，适合受控联调，不作为公网生产发布配置。

## 当前状态

- DeepSeek Chat 已在本机集成栈启用：`IOT_AI_ENABLED=true`、`IOT_AI_CHAT_PROVIDER=openai`；知识库与 Embedding 仍为 `false` / `none`。模型、请求路径和允许主机写在 `deploy/.env.integration`。
- 受保护目录 `deploy/.runtime/iot-manager-p0/secrets` 中的 `ai_chat_api_key` 已更新为有效凭据，限制为当前操作者访问，并重新导入 Backend 专用 Secret 卷。项目不会生成或记录供应商密钥。
- Docker Engine 已连接；Compose 配置、栈健康检查、DeepSeek 真实小样本调用和浏览器登录后站点 AI 问答均已通过。实际结果见本文件末尾记录。
- [模拟联调记录](SPRING-AI-DEEPSEEK-MOCK-INTEGRATION-2026-09-30.md)覆盖请求、响应和错误映射；不能代替真实服务验收。

## 1. 在 Windows Docker 启动基础栈

在项目根目录的 PowerShell 中执行：

```powershell
$env:LOCALAPPDATA = 'D:\电脑管家迁移文件'
& 'D:\Program Files\Docker\Docker\resources\bin\docker.exe' desktop start --timeout 120
.\scripts\runtime\start-integration.ps1 -Verify
```

启动脚本先运行 PostgreSQL、Keycloak、Caddy，检查已有数据卷的 pgvector 0.8.6，再启动 Backend。迁移 V27 即使关闭 AI 也需要扩展。构建/启动失败时先处理失败原因，不要跳过迁移或强行打开 AI。

## 2. 由操作者私下放置 DeepSeek 密钥

从 [DeepSeek 开放平台](https://platform.deepseek.com/)签发 API Key；[官方接入文档](https://api-docs.deepseek.com/quick_start/agent_integrations/copilot_cli/)说明其以 `sk-` 开头。在项目根目录的**本机 PowerShell** 执行下面一条命令，并在遮蔽提示中输入。勿发到聊天、工单、Git、`.env` 或前端；密钥文本不会写入命令历史。

```powershell
.\scripts\runtime\set-ai-chat-key.ps1
```

如果文件已有内容，需要更换为从 DeepSeek 开放平台复制的真实 Key，请执行：

```powershell
.\scripts\runtime\set-ai-chat-key.ps1 -ReplaceExisting
```

脚本验证 `sk-` 前缀、拒绝空白及换行，写入时设置当前 Windows 用户访问权限。`secret-volume-init` 将主机密钥复制到只供 Backend 读取的 `runtime-secrets-backend` 卷中，配置树加载为 `IOT_AI_CHAT_API_KEY`。更换后先用不含站点数据的小样本验证真实供应商调用，再启动聊天开关。

## 3. 启用聊天

先确认基础栈健康、Key 有效、供应商账户具备额度，并确认将站点提问发往远程 DeepSeek 的数据处理约定。DeepSeek 官方 [API 入门](https://api-docs.deepseek.com/guides/harness)与[聊天接口](https://api-docs.deepseek.com/api/create-chat-completion/)列出了当前兼容协议；若供应商将来变更模型/接口，以最新官方文档和真实小样本复验为准。

只修改 `deploy/.env.integration` 现有两行：

```dotenv
IOT_AI_ENABLED=true
IOT_AI_CHAT_PROVIDER=openai
```

其余配置保持 `IOT_AI_KNOWLEDGE_ENABLED=false`、`IOT_AI_EMBEDDING_PROVIDER=none`、`IOT_AI_CHAT_BASE_URL=https://api.deepseek.com`、`IOT_AI_CHAT_COMPLETIONS_PATH=/chat/completions`、`IOT_AI_CHAT_MODEL=deepseek-flash`、`IOT_AI_ALLOWED_HOSTS=api.deepseek.com`。`openai` 是 Spring AI 的兼容协议适配器名。

重新导入密钥并重建 Backend；不要打印容器环境或 Secret 内容：

```powershell
$env:LOCALAPPDATA = 'D:\电脑管家迁移文件'
$env:IOT_SECRET_DIR = 'E:\CC_testP\iot-manager\deploy\.runtime\iot-manager-p0\secrets'
$docker = 'D:\Program Files\Docker\Docker\resources\bin\docker.exe'
$compose = @('compose', '--project-name', 'iot-manager-p0', '--profile', 'application',
    '--env-file', 'deploy/.env.integration',
    '--env-file', 'deploy/.runtime/iot-manager-p0/runtime.env',
    '-f', 'deploy/docker-compose.yml', '-f', 'deploy/docker-compose.integration.yml')
& $docker @compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Compose config invalid' }
& $docker @compose run --rm --no-deps secret-volume-init
if ($LASTEXITCODE -ne 0) { throw 'Secret import failed' }
& $docker @compose up -d --no-deps --force-recreate backend
if ($LASTEXITCODE -ne 0) { throw 'Backend restart failed' }
& $docker @compose ps backend
```

## 4. 真实调用验收

1. 确认 Backend 为 `healthy`。日常浏览器需先信任本机集成 Caddy CA，才可用 `https://iot-manager.localhost/` 和 `/console/` 正常登录；启动脚本仅在自身 `curl` 验收时显式指定 CA，不会修改 Windows 全局证书信任。
2. 用站点成员账号查看 `GET /api/v1/sites/{siteId}/ai/status`，预期 `enabled=true`、`knowledgeEnabled=false`、`state=CONFIGURED_REMOTE`。此状态只证明配置加载，不证明供应商可访问。
3. 在应用的“站点 AI”入口询问一次通用问题，例如“用一句话解释温度传感器”，确认得到回答且无 401/429/5xx。再询问“本站知识库有哪些文档”，应返回未启用提示，不触发 Embedding。
4. 检查 Backend 日志、站点审计与用量记录，确认只出现 Chat 调用，且没有凭据和完整敏感提问泄露。观察预算与 429、超时处理后再扩大使用范围。

旧 Android APK 不包含本轮 AI 入口；需要先完成 Android SDK Platform 36 / Build Tools 35 的安装与许可流程，重建 APK 并真机验收。当前 Web 客户端可在信任本机 CA 后先进行聊天验收。

可复验的真实服务测试位于 `client/e2e/runtime-ai-live.spec.js`，默认跳过，显式开启才会产生一次付费 Chat 调用。Windows 无头浏览器的本机证书例外只用于该测试；`verify-stack.ps1` 已另行验证 Caddy CA 与 TLS 链。站点负责人密码由测试进程直接从受保护文件读取，不放入命令参数或测试日志：

```powershell
$env:IOT_RUNTIME_BASE_URL = 'https://iot-manager.localhost'
$env:IOT_RUNTIME_IGNORE_BROWSER_HTTPS_ERRORS = 'true'
$env:IOT_LIVE_AI_ACCEPTANCE = 'true'
cd client
npx playwright test e2e/runtime-ai-live.spec.js --reporter=line
```

## 5. 回退

将 `deploy/.env.integration` 改回 `IOT_AI_ENABLED=false` 与 `IOT_AI_CHAT_PROVIDER=none`，保持知识库/Embedding 关闭，使用上面的 Compose 命令再次执行 `config --quiet` 和 `up -d --no-deps --force-recreate backend`。确认状态变为 `DISABLED`，聊天 API 不再可用。数据库迁移保留；密钥轮换或销毁按供应商和本机 Secret 管理流程另行执行。

## 本次实际验收记录

| 检查 | 结果 |
| --- | --- |
| Docker Engine | 已连接，Server 28.3.2。 |
| Compose 静态配置 | 通过。 |
| PostgreSQL 镜像 | 构建通过，pgvector 0.8.6 已在现有 IoT 数据库检查通过。首轮 Debian 下载返回 503，改用官方备用入口后通过。 |
| 本机 TLS | 旧 Caddy 证书已过期，重启后签发新证书；集成启动脚本增加了证书校验失败时的一次重启重试。 |
| 完整栈 `start-integration.ps1 -Verify` | 通过；Backend、PostgreSQL、Keycloak、Caddy 与备份/WAL-G 服务均为 `healthy`。证据位于 `artifacts/p0-runtime/20260930T132202Z`。 |
| 首次凭据与回退 | 首次凭据小样本调用返回 401；当时已回退并通过 `verify-stack.ps1`，证据位于 `artifacts/p0-runtime/20260930T171750Z`。此问题在换入有效 Key 后已解决。 |
| 有效密钥与真实供应商调用 | 主机文件格式和 ACL 检查通过；不含站点数据的小样本调用返回 HTTP 200，`deepseek-flash` 给出非空且符合预期的回答。密钥未输出到日志或文档。 |
| 密钥导入及 Backend 配置 | `secret-volume-init` 完成，Backend Secret 文件非空；`IOT_AI_ENABLED=true`、Chat 提供方 `openai`，知识库关闭、Embedding 提供方 `none`。Backend 重建后 `verify-stack.ps1` 通过，证据位于 `artifacts/p0-runtime/20260930T173132Z`。 |
| 浏览器到应用再到 DeepSeek | `runtime-ai-live.spec.js` 通过：站点负责人经 Keycloak PKCE 登录，`/ai/status` 返回 `CONFIGURED_REMOTE`，页面提交通用问题后 `/ai/chat` 返回 200、非空回答与空引用列表。 |
| 知识库关闭边界 | `/ai/knowledge-bases` 返回 404；本次数据库用量记录为 `CHAT_ATTEMPT=1`、`CHAT=1`、无 `EMBED`，审计为 `CHAT/SUCCEEDED=1`。 |
| 运行日志 | 验收后的 Backend 日志未发现供应商失败、ERROR 或形如密钥的文本。 |

**上线判定：** 当前 Windows Docker 集成环境的远程 AI 聊天已启用并通过真实端到端验收，知识库保持关闭。公网生产部署还需按 [部署手册](../deploy/DEPLOYMENT.md)完成正式账号、备份恢复、域名/TLS 与发布门禁；本机集成栈不承担这些保证。
