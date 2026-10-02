# Spring AI 测试后开发文档

> 本文记录 2026-09-30 00:19 的开发基线，后续改动和用户确定的“DeepSeek 聊天模拟联调、知识库暂不启用”范围以[最新实施与验收记录](SPRING-AI-DEEPSEEK-MOCK-INTEGRATION-2026-09-30.md)为准。

**版本：** 1.0  
**核对时间：** 2026-09-30 00:19（Asia/Shanghai）  
**适用范围：** IoT Manager 的服务端远程 AI、站点知识库、站点性格、三端问答入口及其发布准备。  
**当前结论：** 纵向功能已实现，本机后端与三端构建通过；旧库升级、故障恢复、网关端到端和真实远程模型仍待开发与验收。生产 AI 开关保持关闭。

本文依据当前工作树和本次实际测试编写。原[框架整改开发文档](SPRING-AI-FRAMEWORK-REMEDIATION-DEVELOPMENT.md)第 2、7、9 节是实施前快照，第 10 节是 9 月 29 日旧测试快照；本文件中的 9 月 30 日执行结果优先。冲突编号 C01～C14、测试编号 T01～T13 及 G0～G4 门槛沿用[开发方向审查与测试方案](SPRING-AI-CURRENT-DIRECTION-REVIEW-AND-TEST-PLAN-2026-09-29.md)。

## 1. 已验证的开发基线

| 检查 | 本次实际执行结果 | 结论边界 |
| --- | --- | --- |
| 后端 `mvn verify`，JDK 17、Maven 3.9.11、D 盘本地仓库 | **151 项测试、0 失败、0 错误、0 跳过；BUILD SUCCESS；JAR 打包成功**。48 个本轮 Surefire XML 的计数与 Maven 汇总一致。 | 本机执行的是 `verify`，没有执行 `clean`；这不是 CI 严格模式或生产部署测试。 |
| PostgreSQL/Testcontainers | 全量测试中的 PostgreSQL 用例未跳过；新 PostgreSQL 16 容器迁移至 V27，AI 向量检索的基础跨站隔离通过。此前单独跑的两项定向测试也是 2/0/0/0。 | 覆盖新库；未覆盖 V25 旧数据卷、恢复库、受限迁移账号和索引发布中断。 |
| 控制台 `npm run test && npm run build` | 1 项通过，Vite 构建通过。 | 未运行带真实身份的浏览器端到端测试。 |
| 移动端 Web `npm run test && npm run build` | 168 项通过，Vite 构建及生产预览隔离检查通过。 | 未构建/运行 Android 包，未做真机、离线和切站点端到端验收。 |
| 监控页 `npm run test && npm run build` | 2 项通过，Vite 构建通过。 | 未运行浏览器端到端测试。 |
| Docker 与 Compose 静态检查 | Docker Engine 28.3.2 可连接；`docker compose ... config --quiet` 通过。 | 没有启动整套 Compose，也没有通过 Caddy、Keycloak、备份或远程模型运行验收。 |

本机 Docker 数据在 `D:\电脑管家迁移文件\DockerWSL`，运行日志及状态在 `D:\电脑管家迁移文件\Docker`，Docker Desktop 程序在 `D:\Program Files\Docker\Docker`。旧 `D:\moveFile` 已不存在。Maven 仓库位于 `D:\电脑管家迁移文件\C盘迁移\Users\Raid\.m2\repository`。测试时通过更新后的 D 盘快捷方式启动 Docker；如果当前 PowerShell 的 `docker desktop` 受旧 C 盘用户目录连接点影响，可只在该会话设置 `LOCALAPPDATA=D:\电脑管家迁移文件`。这些是本机开发路径，不应写入项目运行配置或 CI。

## 2. 当前实现与代码入口

| 层 | 已有实现 | 需要继续处理的边界 |
| --- | --- | --- |
| 模型接入 | [后端 POM](../backend/pom.xml)使用 Spring AI 1.1.8 的 OpenAI 兼容 Chat/Embedding；[AiModelGateway](../backend/src/main/java/com/iot/manager/ai/AiModelGateway.java)检查 HTTPS、允许的主机、密钥和向量维度，映射超时/429/503。调用发生在服务器。 | 尚未用选定供应商验证协议、模型、维度、费用及数据处理区域；[AiHttpTimeoutConfig](../backend/src/main/java/com/iot/manager/ai/AiHttpTimeoutConfig.java)的全局 RestClient 定制需隔离。 |
| 问答 | [AiChatService](../backend/src/main/java/com/iot/manager/ai/AiChatService.java)按站点检索、添加只读设备状态、记录短会话、用量和引用；并发上限为进程内 3 路。 | 检索正文被拼入 system 消息；会话中途切换性格、无关引用、设备定位和原子用量需整改。 |
| 知识入库 | [AiIngestService](../backend/src/main/java/com/iot/manager/ai/AiIngestService.java)处理 TXT/Markdown/可提取文字的 PDF，后台排队、向量化、发布、失败重试和启动恢复。 | 发布与任务终态需原子可见；同名文档仅保留一个当前版本；PDF 解析过程需资源限制。 |
| 站点管理与 API | [AiController](../backend/src/main/java/com/iot/manager/ai/AiController.java)在 `/api/v1/sites/{siteId}/ai` 下提供问答、知识库、文档、任务、性格和会话接口；先做站点校验，管理操作再限制 OWNER/ADMIN。[AiAvailabilityController](../backend/src/main/java/com/iot/manager/ai/AiAvailabilityController.java)提供 `/status`。 | 原文下载对所有站点成员开放，需要明确文档分类；完整跨站、角色与本人会话测试仍需补齐。`CONFIGURED_REMOTE` 只表示开关配置状态，不是服务商在线探测。 |
| 数据库 | [V26](../backend/src/main/resources/db/migration/V26__add_site_ai_metadata.sql)建立知识库、文档、分段、任务、性格、会话、用量和审计表；[V27](../backend/src/main/resources/db/migration-postgresql/V27__add_site_ai_vectors.sql)建立 pgvector 向量表并以站点复合外键约束。 | V27 在 AI 关闭时也会执行；既有库需要在切换新 Backend 前安装/预检 vector 扩展。不得将已发布迁移原地修改。 |
| 部署与界面 | [生产配置](../backend/src/main/resources/application-prod.yml)和 [Compose](../deploy/docker-compose.yml)默认 `IOT_AI_ENABLED=false`；服务端 configtree 装载供应商密钥；[Caddy](../deploy/Caddyfile)给 AI 上传 6 MB 路径，普通 API 1 MB；控制台、移动端 Web、监控页已有入口。 | Caddy 上传边界、身份上下文、Android 和恢复演练仍需运行验证。 |

首版容量默认值来自 [AiProperties](../backend/src/main/java/com/iot/manager/ai/AiProperties.java)：单文件 5 MiB、站点原文 50 MiB、问题 2,000 字符、答案 8,000 字符、每站点每日 200 次问答及 20 次上传、会话保留 30 天、Embedding 维度 1536。这些是当前配置值，不是经压测确认的容量承诺。

### 已实现的接口边界

- 成员可调用 `POST /chat`、`GET /status`、`GET /knowledge-bases`、`GET /persona`；本人会话经 `GET/DELETE /conversations/{id}` 操作。原文下载 `GET /documents/{id}/source` 当前仅要求站点访问。
- OWNER/ADMIN 可创建知识库、列出/上传/删除文档、查看/重试入库任务、查看性格版本、创建并启用性格版本。路径、请求字段和响应类型以 [AiController](../backend/src/main/java/com/iot/manager/ai/AiController.java) 的当前实现为准。
- 客户端始终通过后端访问远程 AI，不传模型地址或供应商密钥；设备控制仍使用原有 IoT 命令链路。

## 3. 下一轮开发任务与完成标准

按依赖顺序执行。P0 是形成 AI 发布候选前必须处理；P1 是开始单节点试点前必须处理。每项完成时同时提交代码、自动测试和简短的运行证据。

| 顺序 | 对应审查项 | 开发改动 | 完成标准 |
| --- | --- | --- | --- |
| 1 / P0 | C13、C14 | 确定 AI 所属发布批次、供应商与处理区域、Chat/Embedding 模型和维度、密钥来源、成本预算；把 V26/V27、Caddy 及三端变更列入独立发布清单。 | Gate 1 范围记录与代码包一致；测试密钥只在服务器；有供应商联调参数表。 |
| 2 / P0 | C01 | 在新库、V25 旧库和恢复库的部署前置步骤中安装并检查固定版本 vector 扩展；PowerShell、Bash 两条启动链在切换 Backend 之前阻断缺扩展状态。应用与 Flyway 账号继续保持非超级用户。 | AI 关闭的新旧库均可迁移到 V27；扩展缺失时旧版 Backend 仍可用，部署在切换前明确失败。 |
| 3 / P0 | C03、C05 | 为文档索引增加暂存批次和唯一当前发布版；分段、向量、文档版本和任务终态在事务中切换可见性。恢复逻辑识别“已发布但任务未收尾”，重试幂等。 | 四个注入中断点和同名 v1/v2 冲突测试通过；检索只见完整的一个版本，失败保留旧版。 |
| 4 / P0 | C02、C04 | 模型消息中固定安全规则与管理员性格、检索证据分层；知识正文和设备名作为不可信数据传入。首版建议把会话固定在创建时的性格版本，并在每轮记录实际版本。 | Mock 模型可断言消息角色；恶意知识/设备名不取得系统指令地位；会话跨性格切换后记录与实际调用一致。 |
| 5 / P1 | C06～C08 | 冻结原文下载的可见性策略；引用关联实际被回答采用的当前文档片段；按设备标识定位且带状态观测时间；为 Embedding 切换增加索引代次与后台重建。 | 四角色、跨站、同名文档、21 台以上设备、过期状态和模型切换中断的用例通过。 |
| 6 / P1 | C09～C12 | PDF 抽取中限制页数、累计文本、耗时与内存；AI 专用 HTTP 客户端；Caddy 5/6 MB 与普通 API 1 MB 边界测试；用数据库原子计数实现站点每日预算。单节点先固定部署约束。 | 损坏/加密/高压缩 PDF 受控失败；天气等现有 HTTP 行为无回归；并发请求不超日预算；Caddy 返回稳定状态码。 |
| 7 / 验收 | T03～T13 | 加入真实身份的浏览器/Android 测试、Compose 隔离环境、供应商最小样本及备份回退演练，建立 30～50 题人工标注集。 | G1～G4 的每项证据齐备，再决定试点开关及发布。 |

对 C06（站点成员是否都能下载原文）、C04（会话是否固定性格）和 C13（发布批次）已有上述建议，但应在 API 契约与发布记录中冻结决定。若改变现有 V26/V27 表结构，追加后续迁移；已运行数据库不可改原迁移校验和。

## 4. 开发与测试执行方式

### 本机快速复现

先用更新后的快捷方式启动 Docker Desktop，并在 PowerShell 中运行：

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:Path = "$env:JAVA_HOME\bin;" + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$env:LOCALAPPDATA = 'D:\电脑管家迁移文件'
docker info --format 'Server={{.ServerVersion}}'
& 'D:\apache-maven-3.9.11\bin\mvn.cmd' -f .\backend\pom.xml '-Dmaven.repo.local=D:\电脑管家迁移文件\C盘迁移\Users\Raid\.m2\repository' verify
docker compose --env-file deploy/.env.example -f deploy/docker-compose.yml config --quiet
```

三端分别在 `console`、`client`、`frontend` 目录运行 `npm run test`、`npm run build`。上述命令是本机回归入口；CI 仍应执行 [scripts/verify.sh](../scripts/verify.sh) 的严格检查，拒绝 Testcontainers 用例跳过，并在隔离环境执行完整部署测试。不要把 `docker compose config` 当作容器运行成功。

### 用例补充次序

1. **数据库（G1）：** 增加 V25 升级种子库、恢复库、非超级用户迁移、AI 关闭但 V27 仍执行、向量/任务切换事务和跨站权限测试。保留 Flyway 版本、容器镜像及 Surefire 报告。
2. **后端契约（G1/G2）：** 以 HTTP Stub 覆盖 Chat/Embedding 请求、429/503/超时/错误维度、消息角色、原文下载与会话归属；并发压测日预算和上传队列。无真实凭据也能重复运行。
3. **网关和三端（G2）：** 用隔离 Compose 项目测试两份 Caddy 配置、Keycloak 四角色、上传大小及普通 API 限制；Playwright/Android 验证切站点、换账号、注销和迟到回答清理。
4. **供应商（G3）：** 选定供应商后用测试站点和服务器端测试密钥执行最小样本；记录向量维度、错误映射、P95 延迟、费用、数据区域及内容留存约定。质量阈值从固定评估集确定。
5. **恢复和发布（G4）：** 用应用数据备份副本演练原文、向量、性格、会话恢复与 N-1 回退；确认关闭 AI 后主业务仍可用。此前的 Docker VHD 备份只证明开发机数据可保留，不等于应用恢复演练。

## 5. 发布约束与冲突处理

- **数据库耦合：** V27 不随 `IOT_AI_ENABLED=false` 跳过。发布新 Backend 前必须完成 pgvector 扩展预检；缺扩展不能以关闭 AI 开关绕过。
- **主业务隔离：** AI 模型超时、预算耗尽和上传失败不应影响设备命令、天气、告警及基础 readiness。现有全量后端测试通过是回归基线，仍需运行 Compose 级故障注入。
- **配置安全：** [生产配置](../backend/src/main/resources/application-prod.yml)默认关闭 AI，Chat/Embedding provider 默认 `none`；启用时须固定 HTTPS 允许主机、模型和维度，密钥经 [configtree 挂载](../deploy/secret-volume-init.sh)提供。不要在浏览器、Git 或命令输出中放真实密钥。
- **发布范围：** AI 在现有[功能路线图](FEATURE-EXPANSION-EVALUATION-AND-ROADMAP.md)中属于 R3 研究项。若提前进入 R1/R2，先更新[项目整改基线](PROJECT-IMPROVEMENT-PLAN.md)要求的 Gate 1 记录，并使迁移、网关、客户端和回退清单与该批次一致。
- **多实例限制：** 当前限流和并发控制是进程级。试点前先以单节点和数据库原子日预算收口；增加第二个 Backend 实例前，需要集中式限流与跨实例并发验证。

## 6. 自检与当前状态

本文件已按本轮 Maven 最终汇总及 48 个 Surefire XML 双重核对 **151/0/0/0**，并按三端实际命令输出记录 1、168、2 项测试及构建结果。Docker Engine 与 Compose 配置检查在本轮重跑。代码入口、默认开关、V26/V27、Caddy 请求体限制及 C01～C14 对照当前文件核对；历史 `D:\moveFile` 仅保留在旧记录中，本文件使用新路径。

**当前门槛：** G0 的本机后端与三端测试/构建已通过；G1 的新库迁移与基础站点向量隔离已通过，但旧库升级、故障恢复和完整权限未完成；G2、G3、G4 待验。此状态支持继续开发和隔离环境联调，尚不构成开启生产 AI 的依据。
