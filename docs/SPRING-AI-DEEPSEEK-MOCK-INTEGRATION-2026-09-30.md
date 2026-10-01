# Spring AI + DeepSeek 聊天模拟联调：实施与验收记录

**更新日期：** 2026-09-30（Asia/Shanghai）
**当前阶段：** 服务器端 Chat 接口完成模拟联调；知识库暂不启用；生产 AI 保持关闭。
**依据：** 用户选定 DeepSeek 作为首个聊天服务，并要求后续可替换；当前只做模拟联调，不启用知识库。

## 1. 本阶段交付范围

后端使用 Spring AI 的 OpenAI 兼容 Chat 适配器。默认地址为 `https://api.deepseek.com`，完成路径为 `/chat/completions`，默认模型为 `deepseek-flash`。这些值来自 [DeepSeek 官方模型文档](https://api-docs.deepseek.com/quick_start/pricing/)和[聊天接口文档](https://api-docs.deepseek.com/api/create-chat-completion/)。模型地址、完成路径、模型名、允许主机和服务器端密钥分别配置，更换兼容服务时不需要改业务接口。

模拟测试用本地 HTTP 替身核对请求地址、Bearer 头、模型、消息角色、响应内容和 token 用量。测试使用占位凭据；没有调用真实 DeepSeek 服务，也没有取得真实密钥。生产配置中 `IOT_AI_ENABLED=false`、`IOT_AI_KNOWLEDGE_ENABLED=false`，因此本次交付不产生远程请求或账单。

知识库关闭时不需要 Embedding 模型或密钥，知识库/文档/入库 API 返回 404，启动恢复不会重排已有入库任务。问答与站点性格仍可单独运行；明确的站点文档问题直接返回知识库未启用。当前工作树保留此前开发的知识库代码及迁移，待选定远程 Embedding 服务后再做实际索引联调。

## 2. 代码与边界

| 区域 | 当前处理 |
| --- | --- |
| 模型连接 | [AiHttpTimeoutConfig](../backend/src/main/java/com/iot/manager/ai/AiHttpTimeoutConfig.java)只配置 AI Chat 客户端的 5 秒连接、30 秒读取超时，并校验完成路径；不改天气等现有 HTTP 客户端。[AiModelGateway](../backend/src/main/java/com/iot/manager/ai/AiModelGateway.java)校验 HTTPS、允许主机和 Chat 密钥；只有知识库启用时才要求 Embedding。 |
| 问答 | [AiChatService](../backend/src/main/java/com/iot/manager/ai/AiChatService.java)将固定安全规则放在 system 消息，站点证据与性格放在 user 消息；会话固定创建时的性格版本；只返回回答实际使用且存在的引用，剔除无效引用标记。设备状态带观测时间，过期时标为当前状态未知。每日站点问答预算由数据库事务串行预留。 |
| 知识管理 | [AiController](../backend/src/main/java/com/iot/manager/ai/AiController.java)依据知识库开关拦截入库 API；[AiIngestService](../backend/src/main/java/com/iot/manager/ai/AiIngestService.java)关闭时不恢复旧任务。此前的上传、发布和回滚逻辑保留，已补同名版本切换与事务测试，但本阶段不启用上传。 |
| 数据库 | V26 元数据和 V27 pgvector 迁移仍随新 Backend 发布执行，**即使 AI 关闭也不能跳过扩展预检**。[start-integration.ps1](../scripts/runtime/start-integration.ps1)及 [start-integration.sh](../scripts/runtime/start-integration.sh)在启动 Backend 前安装/核对旧 PostgreSQL 数据卷的 vector 扩展。 |
| 界面 | [控制台](../console/src/main.js)在知识库关闭时隐藏上传/文档管理，保留性格配置；移动端与监控页已有问答入口。客户端只调用后端，不持有供应商密钥。 |

## 3. 配置与替换服务商

当前模拟联调保持以下生产开关关闭：

```dotenv
IOT_AI_ENABLED=false
IOT_AI_KNOWLEDGE_ENABLED=false
```

将来经过真实服务联调和发布验收后，聊天试点才设置：

```dotenv
IOT_AI_ENABLED=true
IOT_AI_KNOWLEDGE_ENABLED=false
IOT_AI_CHAT_PROVIDER=openai
IOT_AI_EMBEDDING_PROVIDER=none
IOT_AI_CHAT_BASE_URL=https://api.deepseek.com
IOT_AI_CHAT_COMPLETIONS_PATH=/chat/completions
IOT_AI_CHAT_MODEL=deepseek-flash
IOT_AI_ALLOWED_HOSTS=api.deepseek.com
```

`openai` 是 Spring AI 的协议适配器名称。真实 `ai_chat_api_key` 只放在受保护的服务端 Secret 文件，通过 configtree 加载；不放入 .env、前端或 Git。更换兼容服务时更新 Chat 地址、路径、模型、允许主机和 Secret，然后用同一套 HTTP 契约与真实服务小样本复验。启用知识库还需独立选择远程 Embedding 服务、维度与数据区域，完成索引切换/重建验收；不得直接把 Chat 模型当 Embedding 使用。

## 4. 验收证据与未完成项

| 项目 | 本阶段证据 | 结论 |
| --- | --- | --- |
| DeepSeek HTTP 契约 | [AiDeepSeekContractTest](../backend/src/test/java/com/iot/manager/ai/AiDeepSeekContractTest.java)用本地替身测试 Spring AI 的聊天请求和响应，以及 429、503、401 错误映射与错误正文隔离。 | 模拟通过；真实服务未验证。 |
| Chat-only 启动与隔离 | [AiChatOnlyConfigurationTest](../backend/src/test/java/com/iot/manager/ai/AiChatOnlyConfigurationTest.java)无 Embedding Bean/密钥启动，并验证状态与知识库 404；[AiChatServiceTest](../backend/src/test/java/com/iot/manager/ai/AiChatServiceTest.java)验证无证据、角色边界、固定性格与引用。 | 定向测试通过。 |
| 数据一致性 | [AiEnabledApiTest](../backend/src/test/java/com/iot/manager/ai/AiEnabledApiTest.java)并发问答/上传日预算、发布失败回滚；[AiVectorPostgresIntegrationTest](../backend/src/test/java/com/iot/manager/ai/AiVectorPostgresIntegrationTest.java)版本、站点隔离、设备状态；[AiUpgradePostgresIntegrationTest](../backend/src/test/java/com/iot/manager/migration/AiUpgradePostgresIntegrationTest.java)从 V25 升级到 V27。 | 定向测试通过；备份恢复演练另行执行。 |
| 三端构建与界面 | 使用 Node 22.23.3 执行 console、client、frontend 的 `npm run test` 与 `npm run build`；[移动端 AI 浏览器测试](../client/e2e/ai-chat-panel.spec.js)验证切换站点后清空回答、忽略迟到回复。 | 均通过；完整身份流与 Android 真机验收未做。 |
| Docker/Compose | Docker Engine 28.3.2 可连接，Compose 配置静态检查通过。 | 未启动完整身份、网关、远程 AI 组合环境。 |
| 后端全量回归 | JDK 17、Maven 3.9.11、Docker 可连接下执行 `mvn verify`。 | 162 项测试、0 失败、0 错误、0 跳过；JAR 打包成功。 |

这阶段的模拟结果**不等于**真实 DeepSeek 联调成功。真实密钥、模型响应、错误与限流、费用、数据处理区域、留存条款、Caddy/Keycloak 端到端、备份恢复和 Android 真机都还需要独立验收。知识库目前没有 Embedding 提供商，保持关闭。

## 5. 本机复现

本机 Docker 已迁至 `D:\电脑管家迁移文件\DockerWSL`；下列 `LOCALAPPDATA` 仅处理当前开发机 CLI 连接，不能写进产品配置。

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:Path = "$env:JAVA_HOME\bin;" + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$env:LOCALAPPDATA = 'D:\电脑管家迁移文件'
docker info --format 'Server={{.ServerVersion}}'
& 'D:\apache-maven-3.9.11\bin\mvn.cmd' -f .\backend\pom.xml '-Dmaven.repo.local=D:\电脑管家迁移文件\C盘迁移\Users\Raid\.m2\repository' verify
docker compose --env-file deploy/.env.example -f deploy/docker-compose.yml config --quiet
```

三端在各自目录用 Node 22 执行测试与构建。本机没有全局 Node 22，已用 `npx --yes --package=node@22 -c "npm run test && npm run build"` 执行；项目 `.nvmrc` 为 22。

## 6. 自检结论

已核对生产配置的 AI/知识库双开关、Chat 与 Embedding 独立配置、Secret 只在服务端、知识库关闭时无 Embedding 依赖、迁移仍需 pgvector，以及模拟测试没有真实网络调用。最终后端全量回归 162/0/0/0。现阶段可继续做隔离环境验收；生产 AI 保持关闭。先取得真实服务凭据及验收数据，再讨论打开聊天试点；知识库单独排期。
