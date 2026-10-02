# IoT Manager Spring AI 框架整改开发文档

**版本：** 1.0  
**日期：** 2026-09-29  
**状态：** 框架与功能代码已实现；生产联调待验收  
**目标：** 在现有 IoT Manager 框架中接入服务器调用的远程 AI，并提供站点知识库和可由管理员定制的 AI 性格。

> 最新开发状态及 2026-09-30 的全量后端、三端测试结果见[测试后开发文档](SPRING-AI-DEVELOPMENT-GUIDE-AFTER-TESTS-2026-09-30.md)。本文第 10 节的 Docker 不可用与 3 项跳过是历史快照。

## 1. 文档定位与边界

用户已选择 Spring AI 作为技术路线。本文保留实施时采用的基线、接口边界、数据库与部署方向，并在第 10 节记录当前代码交付与尚未通过的运行验收。第 2、7、9 节保留实施前的核对与计划快照；它们不是当前源码状态的描述。

现有 [项目审批意见](PROJECT-APPROVAL-REVIEW.md)、[平台整改基线](PROJECT-IMPROVEMENT-PLAN.md) 和[功能路线图](FEATURE-EXPANSION-EVALUATION-AND-ROADMAP.md)仍定义当前发布门槛。路线图将 FX-13“AI 异常分析和自然语言助手”列为 R3 研究项。本需求若提前进入某个发布版本，应同步更新范围、风险与验收记录，不把 AI 功能悄悄加入现有 R1 放行条件。

本轮目标为知识问答、站点设备状态解释和人工管理知识库与性格。AI 不直接下发设备命令，不绕过现有命令幂等、确认和审计链路。远程聊天模型与远程 Embedding 模型都由服务器调用；客户端不持有模型密钥，服务器不部署本地推理模型。

## 2. 现状核对

| 位置 | 当前事实 | 整改影响 |
|---|---|---|
| [后端依赖](../backend/pom.xml) | Java 17、Spring Boot 3.5.16；尚无 Spring AI 依赖 | 锁定与 Boot 3.5 兼容的 Spring AI 1.1.8，导入 BOM 后按选定模型服务添加最小依赖 |
| [生产配置](../backend/src/main/resources/application-prod.yml) | Flyway 负责迁移；应用账号与迁移账号分离 | AI 表由 Flyway 创建；应用启动不自动创建扩展或表 |
| [PostgreSQL 镜像](../deploy/postgres/Dockerfile)与[数据库初始化](../deploy/postgres/init-databases.sh) | PostgreSQL 16 镜像包含 WAL-G，未安装 pgvector；迁移账号不是超级用户；初始化只在新数据卷运行 | 镜像加入固定版本 pgvector；新库与既有库分别安排扩展安装步骤 |
| [权限链](../backend/src/main/java/com/iot/manager/config/SecurityConfig.java)与[站点授权](../backend/src/main/java/com/iot/manager/service/SiteAccessService.java) | GET 可供 VIEWER 使用，普通 POST 排除 VIEWER；站点代码可能跨组织重复 | 为只读问答 POST 增加明确规则；所有 AI 资源以已授权的站点 ID 定界 |
| [API 限流](../backend/src/main/java/com/iot/manager/config/ApiRateLimitFilter.java) | 非命令 POST 没有独立计数 | 为问答、文档上传和索引操作增加专用预算 |
| [Caddy 入口](../deploy/Caddyfile)与[集成入口](../deploy/Caddyfile.integration) | 通用 API 请求体上限 1 MB，并拒绝 chunked 请求 | 仅为受控上传路径增加独立限制，保留其他 API 的现有上限 |
| [后端容器](../deploy/docker-compose.yml) | 后端文件系统只读，临时目录 64 MB；后端已有出站网络 | 文件解析设大小及并发上限；远程模型调用不需要新容器 |
| [站点 DTO](../backend/src/main/java/com/iot/manager/dto/SiteView.java)、[客户端](../client/src/main.js)与[控制台](../console/src/main.js) | 站点列表已有 ID，但界面主要以站点代码保存活动上下文 | AI 调用使用站点 ID；切站点、退出登录时清理在途回答和会话状态 |
| [迁移测试](../backend/src/test/java/com/iot/manager/migration/PostgresFlywaySmokeTest.java) | PostgreSQL Testcontainers 使用不含 pgvector 的基础镜像 | 向量迁移测试须改用带 pgvector 的固定版本镜像 |

依据：[Spring AI 1.1.8 入门文档](https://docs.spring.io/spring-ai/reference/1.1/getting-started.html)明确支持 Spring Boot 3.4.x/3.5.x；[Spring AI 1.1.8 发布页](https://github.com/spring-projects/spring-ai/releases/tag/v1.1.8)可核对版本。[pgvector 官方说明](https://github.com/pgvector/pgvector)描述 PostgreSQL 扩展安装和向量索引。Spring AI 2.x 与 Boot 4 的升级应作为后续独立任务。

## 3. 目标架构

1. Android、监控页面、运维控制台只访问现有 Caddy 与后端 API。
2. 后端先用 Keycloak 身份和 SiteAccessService 确认站点，再读取该站点已发布知识和必要的只读设备状态。
3. 后端使用 Spring AI 的聊天和 Embedding 抽象调用已配置的远程服务；数据库保存源文档、分段文本、向量、性格版本和受限的会话记录。
4. 文档入库在后端的有界后台任务中执行；任务状态可查询，失败可重试。无需单独部署 Dify、RAGFlow、向量数据库或本地模型。

知识检索使用明确含站点 ID、知识库 ID 和文档 ID 的 PostgreSQL 表及受控查询。Spring AI 负责模型调用、文本处理和回答组装；向量检索层可以使用 pgvector SQL。此设计让站点约束成为查询条件和数据库关系约束，而不是依赖客户端传入的过滤表达式或通用向量表的可选元数据。首版采用精确检索；只有数据量和性能测试证明有需要时再增加 HNSW 索引。

## 4. 后端整改设计

### 4.1 依赖、配置与模型网关

- 在 [后端 POM](../backend/pom.xml)导入 Spring AI 1.1.8 BOM；确定远程供应商后再添加对应 ChatModel、EmbeddingModel 依赖。聊天与向量化允许使用不同远程服务。
- 新增后端 AI 模块，至少分为配置、身份与站点校验、知识入库、检索、性格、会话、模型网关及审计。业务代码依赖模块接口，不把供应商 SDK 或密钥散布到现有设备服务。
- AI 功能开关默认关闭。关闭时不要求模型密钥，不建立外部连接，原有健康检查和设备 API 保持可用。AI 可用性单独反馈，不把远程模型故障计入后端基础 readiness。
- 模型地址由服务端部署配置固定，要求 HTTPS 和受控域名；请求参数不得接受用户提交的模型 URL。密钥走现有 configtree Secret 路径，加入[Secret 生成脚本](../scripts/runtime/new-secrets.ps1)、[Secret 挂载](../deploy/secret-volume-init.sh)及生产部署说明。密钥不得进入浏览器构建、URL、日志或审计正文。
- 配置连接与响应超时、最大输入与输出长度、并发数、用户/站点用量上限和明确的故障映射。对可能已产生费用的模型请求不做无界自动重试。
- 选定供应商后固定聊天模型、Embedding 模型及其向量维度，并用真实服务做兼容冒烟；仅宣称“兼容接口”不足以证明所有参数可用。

### 4.2 数据库与迁移

- 在现有 PostgreSQL 16/WAL-G 镜像中加入经固定版本与来源校验的 pgvector，保留当前非 root 运行和备份路径。
- 新数据库在初始化阶段安装 vector 扩展；已有数据卷在发布前执行一次受控的数据库管理员预检和扩展安装。Flyway 迁移账号保持非超级用户，应用账号保持 DML 权限。启动时关闭 Spring AI 的自动 schema 初始化。
- 当前迁移最大版本为 V25。实施时重新检查版本占用，然后按项目规则分配后续版本：公共元数据表放通用迁移，向量类型与索引放 PostgreSQL 专用迁移。H2 仅覆盖可移植的元数据测试；真实向量与权限验证使用 PostgreSQL。
- 建议实体为：知识库、文档与原文、文档分段、入库任务、性格版本、对话与消息、用量事件、AI 审计事件。每个资源都记录站点 ID；分段与文档、知识库之间使用同站点复合外键或等效数据库约束。
- 文档版本和性格版本不可原地覆盖。文档删除或停用先让其退出检索，再清理分段向量与原文。会话查询同时校验用户与站点，防止通过会话 ID 读取他人内容。
- Embedding 模型或维度变更采用新索引构建、抽样核验、切换和旧索引清理流程；不直接改变在用向量列维度。
- 首版为轻量部署，可将受大小配额约束的原始文档保存在 PostgreSQL，并让现有备份覆盖。文档量增长到超出既定容量预算时，再设计受备份保护的对象存储迁移。

### 4.3 知识库入库与检索

- 首版接收管理员录入的文本、Markdown，以及能提取文字的 PDF。建议初始单文件上限 5 MB，并同时设置站点总容量、解析并发及队列上限；最终值以压测和容器临时空间为准。扫描版 PDF 无法提取文字时标记失败并提示，不把空内容标记为入库成功。
- 入库流程为接收、校验、存储、提取、分段、远程 Embedding、向量写入、发布。只检索已发布版本；失败任务保留明确错误和重试入口。重复上传用内容哈希与版本策略控制，避免重复计费。
- 检索条件由服务器根据已授权站点和已发布知识库构造，客户端不能提供 SQL 或向量过滤表达式。答案返回文档名、版本、页码或标题、引用片段；引用链接再次走权限校验。
- 检索到的文档属于不可信输入。系统规则、性格配置与知识正文分层传给模型；知识内容不得要求修改系统权限、读取密钥或发起命令。证据不足时返回“未找到足够站点知识”，不编造出处。
- 设备当前状态通过已有后端服务按站点实时读取，仅给模型最小必要的只读字段。历史遥测不默认整库向量化；高风险操作仍由用户在原命令界面确认和提交。

### 4.4 性格、会话和审计

- 性格配置以站点为单位，由 OWNER/ADMIN 在控制台编辑名称、语气、回答格式、适用范围等。保存为不可变版本，显式启用并可回退；对话记录其使用的性格版本。
- 项目固定的安全与业务边界优先于可编辑性格：性格文本不能授予新权限、跨站检索、泄露密钥或让模型执行设备控制。
- 会话短历史仅由后端按用户与站点读取，限制轮数和总长度；退出登录或切站点时客户端清空当前显示和在途请求。服务端提供删除和到期清理，保留期在上线前确定。
- [现有审计与指标模式](../backend/src/main/java/com/iot/manager/service/PlatformMetricsService.java)扩展为 AI 请求结果、耗时、令牌用量、索引任务结果和管理操作。指标标签只用低基数类别，不写用户、站点、提示词或文档正文；审计记录操作人、站点、资源、版本和结果。

## 5. API 与权限草案

新接口只使用版本化路径，并沿用现有错误响应结构。以下是开发契约草案；DTO 字段和分页参数在实现前冻结。

| 接口 | 角色及站点条件 | 作用 |
|---|---|---|
| POST /api/v1/sites/{siteId}/ai/chat | OWNER、ADMIN、OPERATOR、VIEWER，均须有站点成员关系 | 提交问题；返回答案、引用、会话 ID 和请求 ID |
| GET /api/v1/sites/{siteId}/ai/status | 有站点权限的四类角色 | 返回功能开关与远程配置状态；不探测供应商连通性 |
| GET /api/v1/sites/{siteId}/ai/conversations/{id} | 会话所有者且有站点权限 | 读取本人会话；不得只凭 ID 访问 |
| DELETE /api/v1/sites/{siteId}/ai/conversations/{id} | 会话所有者且有站点权限 | 删除本人会话 |
| GET /api/v1/sites/{siteId}/ai/knowledge-bases | 有站点权限的四类角色 | 列出可见的已发布知识库 |
| POST /api/v1/sites/{siteId}/ai/knowledge-bases | OWNER、ADMIN，且有站点权限 | 创建知识库 |
| POST /api/v1/sites/{siteId}/ai/knowledge-bases/{id}/documents | OWNER、ADMIN，且有站点权限 | 上传文档，返回异步任务 ID |
| GET /api/v1/sites/{siteId}/ai/ingest-jobs/{id} | OWNER、ADMIN，且有站点权限 | 查询索引状态与失败原因 |
| DELETE /api/v1/sites/{siteId}/ai/documents/{id} | OWNER、ADMIN，且有站点权限 | 停用文档并触发向量清理 |
| GET /api/v1/sites/{siteId}/ai/persona | 有站点权限的四类角色 | 读取当前已启用的公开性格信息 |
| PUT /api/v1/sites/{siteId}/ai/persona | OWNER、ADMIN，且有站点权限 | 保存新版本；通过版本号防止覆盖并发修改 |
| POST /api/v1/sites/{siteId}/ai/persona/{version}/activate | OWNER、ADMIN，且有站点权限 | 启用或回退指定版本 |

[SecurityConfig.java](../backend/src/main/java/com/iot/manager/config/SecurityConfig.java)中应把只读问答 POST 的匹配规则置于通用 POST 规则之前；知识和性格写入继续检查角色及站点。应用层每次再调用 SiteAccessService 校验站点 ID。现有 Keycloak 角色是全局角色，成员关系决定资源范围；本方案的 ADMIN 可编辑其已获成员关系的站点。如需“同一用户在不同站点拥有不同角色”，应先扩展成员关系权限模型。

AI 专用限流至少按身份、站点和接口类型计数，并补充服务器端并发与预算控制。超限返回 429/Retry-After；供应商拒绝、超时和暂不可用分别映射为可识别的 502/504/503，响应与日志不回显供应商密钥或完整请求体。[异常处理入口](../backend/src/main/java/com/iot/manager/controller/ApiExceptionHandler.java)应保持现有响应格式。

## 6. 网关、客户端与部署改动

| 文件或模块 | 开发任务 |
|---|---|
| [生产 Caddyfile](../deploy/Caddyfile)、[集成 Caddyfile](../deploy/Caddyfile.integration) | 为文档上传路径设置单独请求体大小和传输策略；其他 API 仍保持 1 MB 上限。验证带 Content-Length 和 chunked 的合法/超限请求。 |
| [生产 Compose](../deploy/docker-compose.yml)、[PostgreSQL 镜像](../deploy/postgres/Dockerfile) | 固定 pgvector 版本与镜像来源；增加远程模型服务端配置和 Secret；保留只读根文件系统、64 MB 临时目录和现有网络。 |
| [Secret 生成](../scripts/runtime/new-secrets.ps1)、[Secret 挂载](../deploy/secret-volume-init.sh) | 加入聊天与 Embedding 凭据，支持轮换；同步维护 Bash 脚本和部署文档。 |
| [控制台](../console/src/main.js) | 增加知识库、文档状态、性格版本管理及问答入口；权限不足时隐藏编辑入口，但安全判断仍以服务端为准。 |
| [移动端 API](../client/src/js/api.js)、[移动端状态](../client/src/main.js) | 新增问答调用及取消信号；切站点、换账号、退出和离线时清除旧上下文，拒绝迟到回答。 |
| [监控前端](../frontend/src/main.js) | 复用同一服务端 API；是否展示只读问答入口由产品界面设计确定，不另建模型直连接口。 |
| [备份与发布验证](VERIFICATION.md)、[部署手册](../deploy/DEPLOYMENT.md) | 将 AI 表、扩展存在性、数据恢复、密钥轮换、故障降级和关闭开关列入验证。 |

后端不为用户请求直接暴露任意外网抓取功能。远程模型故障时返回明确的 AI 错误，已有设备控制、天气、告警和基础就绪检查继续工作。

## 7. 实施顺序与交付件

1. **决策冻结：** 确定远程供应商、聊天与 Embedding 模型、向量维度、数据处理区域、成本预算、文档与会话保留期。产出配置清单和供应商兼容冒烟记录。
2. **基础设施：** 固定 pgvector 镜像与现有库升级步骤；加入 Secret、功能开关和迁移；更新 PostgreSQL Testcontainers 镜像及迁移测试。产出新库和既有库的迁移证据。
3. **后端核心：** 实现身份/站点约束、文档入库、索引、检索、性格版本、问答、引用、限流、用量和错误映射。产出接口契约与自动化测试。
4. **界面接入：** 运维控制台先提供管理员功能，移动端和监控前端按同一站点上下文接入问答。产出切站点、注销、离线和角色界面验证。
5. **运行验收：** 完成远程服务冒烟、两站点越权测试、上传与恢复演练、故障注入、容量测试和现有发布回归，再按项目变更流程纳入目标版本。

实施前先检查工作区状态，使用独立工作树或明确隔离的变更范围，保护已有未提交改动。每阶段均应有可独立验证的结果，避免数据库和网关已变更但 API 尚不可用的半成品发布。

## 8. 验收矩阵

| 场景 | 必须观察到的结果 |
|---|---|
| 功能开关关闭或缺少 AI 密钥 | 后端启动和既有接口正常；AI 入口关闭且不发外部请求 |
| 两站点、同名文档、不同成员 | 检索、引用、会话读取、文档下载及删除均无跨站数据 |
| VIEWER 问答与管理请求 | 可向有权限站点提问；编辑知识库和性格均被拒绝 |
| 知识缺失或检索分数不足 | 明确说明缺乏资料；不伪造文档引用 |
| 文档失败、重复上传及删除 | 状态与失败原因可见；重复请求不重复计费；删除立即退出检索 |
| 模型超时、限流或服务断开 | AI 返回受控错误；IoT 主业务及 readiness 不受远程故障拖累 |
| 切站点、换账号、退出、离线恢复 | 旧回答、旧引用和旧会话不会出现在新上下文 |
| 恶意知识正文要求越权或下发命令 | 只作为检索文本处理；无跨站读取、密钥泄露或设备写入 |
| 备份恢复与回退 | 原文、版本、向量和引用关系可恢复；关闭 AI 可止损，既有业务继续运行 |

测试层次：后端单元测试使用可控的模型替身；PostgreSQL/pgvector Testcontainers 验证真实 SQL 与迁移；Caddy 集成验证上传边界；浏览器和 Android 验证站点生命周期；最后才用选定的真实远程服务做少量冒烟。现有[迁移版本测试](../backend/src/test/java/com/iot/manager/migration/MigrationVersionAllocationTest.java)及 PostgreSQL 集成测试需随新迁移更新。正式发布仍执行[全项目验证说明](VERIFICATION.md)规定的门槛。

## 9. 本文自检与未决项

**已核对：** 本文所列项目文件、Spring Boot/Java 版本、权限规则、站点 ID、迁移位置、PostgreSQL 镜像、Caddy 1 MB 限制及只读后端容器均与当前源码一致。Spring AI 1.1.8 的 Boot 3.5 兼容性和 pgvector 能力已对照上文官方资料。文档的 37 个仓库内链接均存在，无意外行尾空格或冲突标记；本次只新增本文档。上一轮用 JDK 17 与已缓存 Maven 执行权限、限流、迁移版本基线测试，共 13 项通过、0 失败。

**尚未验证：** 当前 Docker 引擎未运行，因此不能把 PostgreSQL 扩展安装、真实迁移、备份恢复或 Caddy 上传路径标为通过。供应商、模型、密钥和向量维度尚未确定，远程连通性、成本与服务条款也未验证。这些是实施验收项，不能由本设计文档替代。

**实施前需要冻结的参数：** 供应商及数据处理区域、聊天/Embedding 模型与维度、每站点知识库配额、文档与会话保留期、首版是否需要流式回答。未决定前可先实现接口边界和权限测试，但不得把向量维度和供应商兼容性视为已确定。

## 10. 当前代码交付与运行验收

截至 2026-09-29，后端已接入 Spring AI 1.1.8 的 OpenAI 兼容聊天与 Embedding 抽象，采用服务端 HTTPS 地址、域名白名单和 configtree 密钥；AI 默认关闭。已加入站点范围的知识库、异步文档入库、pgvector 精确检索、引用下载、不可变性格版本、短会话、只读设备状态、独立限流、用量与审计记录。控制台支持管理员维护和问答，移动端及监控页面接入同一站点问答接口。启用状态由独立的 /ai/status 路径返回；CONFIGURED_REMOTE 仅表示开关及启动配置已就绪，不代表供应商在线。

V26 保存通用元数据，V27 保存 PostgreSQL 向量；新库初始化安装 pgvector 0.8.6，既有库需在 Backend 启动前运行管理员安装脚本。删除文档时退出检索并清除向量、分段和原文。上传文件初始上限 5 MB，站点原文上限 50 MB，每日站点问答上限 200 次、文档入库上限 20 次，会话保留 30 天；这些值仍需用容量和成本验收确认。

已通过 JDK 17 后端全量测试（151 项，0 失败、0 错误，3 项 PostgreSQL 容器测试跳过）、三个 Vite 界面的构建与单元测试，以及 Docker Compose 配置解析。当前环境的 Docker Engine 不可用，因此真实 PostgreSQL/pgvector 迁移、Caddy 上传边界、备份恢复和容器运行尚未通过验收；用户也尚未指定供应商、数据区域、模型与密钥，远程模型兼容冒烟未执行。AI 保持默认关闭，不应据此文档开启生产开关或宣称生产发布完成。
