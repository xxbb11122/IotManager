# Spring AI 当前开发方向审查与测试方案

- 日期：2026-09-29
- 范围：本项目的服务端远程 AI、站点知识库、可编辑性格、三端问答入口，以及它们对既有 IoT 发布链路的影响。
- 状态：代码审查与测试计划；Docker 恢复后的执行顺序和覆盖状态见第 10～12 节，最新开发安排见[测试后开发文档](SPRING-AI-DEVELOPMENT-GUIDE-AFTER-TESTS-2026-09-30.md)。**不是生产验收报告，也不代表已获发布批准**。

## 1. 审查结论

继续采用 Spring AI 1.1.8、服务端调用远程 Chat/Embedding、PostgreSQL 保存站点知识及 pgvector 精确检索，符合已选定的轻量单节点方向。站点 ID 定界、默认关闭、只读问答和管理员编辑是正确的首版边界。当前实现已经形成可联调的纵向功能，但**尚不宜开启生产 AI**：旧库升级、提示词信任边界、入库中断恢复、文档/性格版本语义和真实供应商兼容性仍需收口。

应将 AI 作为单独的功能发布包处理。现有 [路线图](FEATURE-EXPANSION-EVALUATION-AND-ROADMAP.md)将 FX-13 列为 R3 研究项，[整改基线](PROJECT-IMPROVEMENT-PLAN.md)要求范围变更留下 Gate 1 记录。当前改动已包含 V26/V27 数据库迁移和 Caddy 规则，不能仅凭 AI 开关将它视作完全独立于 R1 的代码。

## 2. 已核对的证据与边界

| 项目 | 本次核对结果 | 尚缺证据 |
| --- | --- | --- |
| 后端实现 | [AI 模块](../backend/src/main/java/com/iot/manager/ai/)包含远程模型网关、问答、入库、管理、权限入口；[生产配置](../backend/src/main/resources/application-prod.yml)默认关闭 AI。 | 供应商真实调用与目标环境运行。 |
| 数据库 | [V26](../backend/src/main/resources/db/migration/V26__add_site_ai_metadata.sql)建立站点元数据，[V27](../backend/src/main/resources/db/migration-postgresql/V27__add_site_ai_vectors.sql)依赖 vector 类型。 | 旧数据卷升级、恢复库、非超级用户迁移的运行证据。 |
| 自动测试 | 本地现存 Surefire XML 合计 **151 项、0 失败、0 错误、3 跳过**；其中 PostgreSQL 容器相关用例因 Docker 不可用而未运行。[CI](../.github/workflows/ci.yml)已有严格 Testcontainers 门槛，但尚无本轮 CI 结果。 | AI 专项的容器、浏览器、Caddy 和远程服务用例。 |
| 三端和网关 | 控制台、移动端和监控页已有问答入口；[Caddy](../deploy/Caddyfile)对 AI 上传给出 6 MB 请求体路径，其余 API 维持 1 MB。 | 携带真实身份的界面端到端测试、上传边界测试。 |
| 当前环境 | 审查时 `docker info` 无法连接 Docker Desktop Linux Engine；当日晚些时候恢复后，补充结果见第 8 节。 | Compose、Caddy、恢复演练的实际通过记录。 |

现有 [开发文档](SPRING-AI-FRAMEWORK-REMEDIATION-DEVELOPMENT.md)第 10 节的交付快照和本次代码核对基本一致；其中第 2、7、9 节为实施前快照，不能当作当前测试通过证据。上述测试数字来自工作区现存报告，本次没有重新执行全量测试。

## 3. 冲突与整改决策

下表中的“确认”指代码路径或文档约束可以直接证明；“待运行”指后果还需运行测试复现。P0 为进入 AI 发布候选前必须处理，P1 为启用 AI 试点前必须处理，P2 为单节点以后扩容前处理。C14 的供应商信息是完成远程联调的输入，协议模拟测试可先做。

| ID / 优先级 | 结论及证据 | 整改方向 | 验收点 |
| --- | --- | --- | --- |
| C01 / P0 | **确认：AI 关闭仍执行 V27。** [生产配置](../backend/src/main/resources/application-prod.yml)始终加载 PostgreSQL Flyway 目录；[V27](../backend/src/main/resources/db/migration-postgresql/V27__add_site_ai_vectors.sql)需要 vector；[启动脚本](../scripts/runtime/start-integration.sh)启动 PostgreSQL 后未执行或检查[旧库安装脚本](../deploy/postgres/install-vector-existing.sh)。旧数据卷缺扩展时，主后端可能在迁移阶段失败。 | 把扩展安装作为**数据库发布前置**：先备份，在数据库管理员阶段安装并校验版本，写入可重复的预检；预检失败时不得切换到新 Backend。同步整改 PowerShell/Bash 两套启动链及恢复库流程。不要把 V27 简单改成依赖 AI 开关的可选 Flyway 版本，以免后续版本顺序失配。 | 新库、V25 旧库、恢复库均验证 V27；AI 关闭且已完成扩展预检时原设备 API 与 readiness 正常；缺扩展时在切换 Backend 前给出明确阻断。 |
| C02 / P0 | **确认：知识正文被提升到系统消息。** [AiChatService](../backend/src/main/java/com/iot/manager/ai/AiChatService.java)将性格、检索片段和设备名称附加到 system 字符串，与[开发文档](SPRING-AI-FRAMEWORK-REMEDIATION-DEVELOPMENT.md)“知识正文不可信、分层传递”的约束不一致。实际模型是否被诱导尚未测。 | 固定安全规则单独作为最高优先级消息；受约束的管理员性格单独处理；检索结果及设备名称以明确标记的不可信证据传递。设备命令能力继续在代码/API 层关闭，不能只靠提示词。 | 恶意文档、恶意设备名和越权性格均不能触发命令、泄露其他站点资料或把伪造证据当成系统规则；断言发送给模型的消息角色与内容边界。 |
| C03 / P0 | **确认：入库完成点与恢复流程不一致。** [AiIngestService](../backend/src/main/java/com/iot/manager/ai/AiIngestService.java)先发布文档再将任务置为 SUCCEEDED；重启会重排 RUNNING 任务，并先删向量/分段。恰在两步间中断时，已发布文档可能短暂失去完整索引。 | 为新索引使用暂存批次，成功后在事务中切换可见版本与任务终态；恢复时识别已完成发布，保证重试幂等。 | 在抽取、每段向量化、发布前、发布后各注入中断；重启后检索只见完整旧版或完整新版，任务终态与可见索引一致。 |
| C04 / P0 | **确认：会话记录的性格版本与后续实际性格可能不同。** [AiChatService](../backend/src/main/java/com/iot/manager/ai/AiChatService.java)每轮取当前激活版本，而会话只在创建时写入 persona_version。 | 首版建议会话固定其创建时的性格版本；如产品要求即时切换，则需每条回复记录版本并向用户展示切换。二选一并更新 API 契约。 | 同一会话两轮之间切换性格，回答所用版本与持久化记录始终一致。 |
| C05 / P0 | **确认：同名文档可有多个 PUBLISHED 版本。** [AiRepository](../backend/src/main/java/com/iot/manager/ai/AiRepository.java)按同名生成版本号，但发布新版时不退出旧版；检索过滤的是所有 PUBLISHED。旧新内容矛盾时会同时进入候选集。 | 定义逻辑文档的唯一当前版；新版索引成功后原子切换，失败保留旧版；保留历史版供审计和回退。 | 同名 v1/v2 内容相反时检索只用当前版；v2 失败后仍用 v1；回退后引用版本正确。 |
| C06 / P1 | **确认：来源链接向所有获授权站点成员提供原文。** [AiController](../backend/src/main/java/com/iot/manager/ai/AiController.java)的 source 下载只检查站点访问，VIEWER 也可读取；这可能符合“站点知识共享”，但需明确文档分类规则。 | 明确知识库是否允许管理员私有/受限文档。若不允许，应在上传界面提示所有站点成员可见；若允许，增加文档级可见性和检索/下载双重授权。 | 用 OWNER/ADMIN/OPERATOR/VIEWER 及跨站成员验证答案片段、引用和原文下载权限一致。 |
| C07 / P1 | **确认：引用和设备状态证据语义偏弱。** [AiChatService](../backend/src/main/java/com/iot/manager/ai/AiChatService.java)把全部命中片段都列作引用；[AiRepository](../backend/src/main/java/com/iot/manager/ai/AiRepository.java)按 ID 取前 20 台设备，未按问题中的设备定位。 | 引用改为可校验的文档片段标识，或明确标为“检索参考”而非结论证明；设备状态按唯一标识/名称定位，附观测时间和过期判断，找不到时回答未知。 | 超过 20 台设备、同名设备、过期状态、无关命中时不误报状态或伪造出处。 |
| C08 / P1 | **确认：更换 Embedding 模型会隐藏旧索引。** [AiRepository](../backend/src/main/java/com/iot/manager/ai/AiRepository.java)按 model_name 与 dimension 查向量，现无完整重建与切换流程。 | 增加索引代次：后台重向量化、对账与抽样质量验证，成功后切换查询代次，失败回到旧代次。 | 切换模型/维度期间问答仍能检索已发布知识；中断重建可恢复且不混用两代向量。 |
| C09 / P1 | **待运行：PDF 资源边界。** [AiIngestService](../backend/src/main/java/com/iot/manager/ai/AiIngestService.java)在全文抽取结束后才检查 80,000 字上限；5 MB 压缩 PDF 可能先消耗较多内存和 CPU。 | 在抽取过程中限制累计字符、单页大小、耗时和内存；将损坏、加密、扫描版 PDF 明确为受控失败。 | 边界文件不使 Backend OOM、不阻塞设备 API，任务给出稳定失败码且可删除/重试。 |
| C10 / P1 | **确认结构性影响，回归待运行。** [AiHttpTimeoutConfig](../backend/src/main/java/com/iot/manager/ai/AiHttpTimeoutConfig.java)的 RestClientCustomizer 会作用于使用 Boot RestClient Builder 的其他客户端。当前未发现明确受损调用。 | 为 AI 供应商单独配置 HTTP 客户端，或至少增加既有外部调用超时回归测试。 | AI 开关前后天气、OIDC/其他 HTTP 客户端的超时与证书行为不发生意外变化。 |
| C11 / P1 | **测试缺口：** [Caddy](../deploy/Caddyfile)新增 6 MB 上传例外，但 [verify-stack](../scripts/runtime/verify-stack.sh)仍只检查普通 API 的 1 MB 拒绝。 | 加入 AI 路由的 multipart、流式请求体、身份与状态码专项测试，覆盖两套 Caddy 配置。 | 小于 5 MB 文件上传成功；超文件/请求体上限为受控 413；其他 API 仍维持 1 MB；错误不泄露正文或密钥。 |
| C12 / P1；多实例部分 P2 | **确认：配额与并发限制为进程级。** [AiChatService](../backend/src/main/java/com/iot/manager/ai/AiChatService.java)的并发信号量、[ApiRateLimitFilter](../backend/src/main/java/com/iot/manager/config/ApiRateLimitFilter.java)的窗口为单进程；每日用量为先查后写，单实例并发下也可能超额。 | 试点前以数据库原子计数落实每日站点预算并限定单实例；多实例前再改为集中式分钟限流和全局并发控制。 | N 个并发请求最多占用配置的日预算；第二节点加入前必须通过分布式限额测试。 |
| C13 / P0 | **治理冲突：** [路线图](FEATURE-EXPANSION-EVALUATION-AND-ROADMAP.md)规定 AI 为 R3 研究项，[整改基线](PROJECT-IMPROVEMENT-PLAN.md)要求 Gate 1 范围变更；AI 迁移和网关规则已经进入工作树。 | 将 AI 代码与既有 R1 修复分成可审阅变更包；确定 AI 所属发布批次和审批记录。未获提前纳入批准时，不把 AI 测试作为 R1 核心放行条件，也不要提前合入会影响 R1 的 V27。 | 发布清单、迁移清单、Gate 记录、回退演练与所选批次一致。 |
| C14 / P0 | **未验：真实远程服务。** 当前测试用模拟 Chat/Embedding，供应商、数据处理区域、模型、维度与密钥尚未确定。 | 先做协议模拟服务契约测试，再用选定供应商最小样本联调；记录地域、成本和内容留存约定。 | HTTPS/域名白名单、模型响应、向量维度、429/503/超时映射、令牌计量、密钥轮换在真实环境得到证据。 |

## 4. 建议实施顺序

1. **冻结功能边界与数据语义。** 明确 AI 所属发布批次、知识库原文可见性、会话性格是否固定、同名文档当前版和引用的含义。把决定写回接口/部署文档。
2. **修复平台级 P0。** 先处理 C01 的旧库预检与启动顺序，再处理 C03/C05 的索引原子可见性，随后处理 C02/C04 的消息与版本一致性。数据库迁移一旦发布，不在原 V26/V27 上直接改已部署 SQL；用新迁移修正。
3. **补齐可复现的 AI 专项自动测试。** 先 Mock 模型做后端边界，再 PostgreSQL Testcontainers 跑真实向量和迁移；随后 Compose/Caddy、三端浏览器与 Android、恢复演练。
4. **完成试点所需 P1。** 处理设备定位、引用、索引模型更换、PDF 资源限制、HTTP 客户端隔离和入口大小边界；用固定数据集做质量和成本基准。
5. **供应商小流量验收。** 只在明确服务商和数据区域后配置服务器端密钥；从一处测试站点、少量可公开样本开始，记录远程请求/响应兼容性、延迟、费用和异常降级。再决定是否打开正式站点开关。

## 5. 测试数据、用例与通过条件

固定准备：两个组织或至少两个站点 A/B；每站点各有 OWNER、ADMIN、OPERATOR、VIEWER 和非成员；相同知识库/文档名称但内容不同；同名 v1/v2 相反结论；A 站 21 台以上设备；正常、恶意指令、损坏、加密、扫描版 PDF；两个性格版本；模拟服务能注入 429、503、超时、错误维度。测试记录不得包含真实密钥或原文全文。

| 用例 | 层级 | 操作与预期 |
| --- | --- | --- |
| T01 开关与主业务 | H2 + Compose | AI 关闭、无模型密钥：Backend 与原设备/天气/告警 API、readiness 正常；AI 管理/问答关闭，状态端点反馈关闭且无外网调用。 |
| T02 新旧库升级 | PostgreSQL + Compose | 新库和 V25 旧库经管理员预检后完成 V26/V27；迁移账号不需超级用户；缺扩展或版本不符时在部署切换前阻断并保留旧版本可用。 |
| T03 站点/RBAC | H2 + PostgreSQL + API | 四角色的问答权限与管理员权限按文档执行；跨站知识库、任务、引用、原文、性格、会话均不可访问；会话只能由本人读取/删除。 |
| T04 上传边界 | Caddy + Backend | TXT/MD/PDF 正常；空文件、错误编码/伪 PDF、重复上传、5 MB 文件上限、6 MB 请求体上限、50 MB 站点上限及普通 API 1 MB 限制都有稳定响应。 |
| T05 入库失败与恢复 | PostgreSQL + 故障注入 | 队列满、远程 Embedding 错误、数据库断连、四个崩溃点、删除中任务重试均不暴露半成品；重启后可重试或完成，不重复计入已发布索引。 |
| T06 检索版本与隔离 | PostgreSQL | 两站同名文档绝不串检索；同名 v1/v2 仅当前版参与问答；索引代次切换期间始终可检索一套完整可用索引。 |
| T07 性格与提示词 | Mock 模型 + 真实服务小样本 | 会话两轮间切换性格仍遵守选定版本语义；恶意性格/文档/设备名不能让模型越权、伪造命令或泄露系统信息；消息角色边界可由协议记录验证。 |
| T08 设备状态与引用 | PostgreSQL + 问答评估集 | 指定第 21 台设备、重名和过期设备时准确定位或回答未知；答案所给引用只指向同站、当前、存在且与回答相关的文档。 |
| T09 供应商协议与失败 | HTTP Stub + 真实服务 | Chat/Embedding 请求路径、身份头、模型和维度匹配；429/503/超时/空响应映射正确，受控重试不造成请求风暴；日志、错误体、审计无密钥。 |
| T10 成本与配额 | 单节点并发 + 指标 | 日预算、分钟限流、三路问答并发、双线程入库队列均按配置工作；各站独立计数；计量能与供应商账单抽样核对。 |
| T11 三端上下文 | Playwright + Android 真机/模拟器 | 控制台管理与问答、移动端/监控端问答；切站点、换账号、注销、离线/超时恢复后，旧回答、引用与会话不在新上下文显示。 |
| T12 备份回退 | 隔离 Compose 恢复演练 | 原文、元数据、性格、会话、向量恢复后引用可下载；N-1 对 N 模式只用于既有回退演练；回退后主业务仍可用并按发布决策关闭 AI。 |
| T13 兼容性回归 | 全量 CI + Runtime E2E | Java、三端单测/构建、现有 PKCE/JWT/RBAC/WSS、天气、命令、备份、Caddy 普通路由和观测指标无新增失败。 |

问答质量另外建立人工审定的 30～50 题小数据集，覆盖资料内答案、资料外问题、同名冲突、时间敏感设备状态与恶意文本。每题保存期望证据和“应拒答/应答未知”标记；在正式服务商确定后，冻结首版正确率、拒答率、引用准确率、P95 延迟和每次成本阈值。阈值需由产品与运维根据实际样本确认，不能凭本地 Mock 结果假定。

## 6. 执行环境与放行门槛

| 阶段 | 环境与产物 | 放行条件 |
| --- | --- | --- |
| G0 静态/快速 | JDK 17、Node 22；后端非容器单测、三端单测与构建、迁移编号/配置/依赖/敏感信息检查报告。 | 可在本地执行的单测、构建和静态检查通过；新增用例落地。 |
| G1 数据库 | 本机先做定向 PostgreSQL/Testcontainers 冒烟；CI 运行 `bash scripts/verify.sh --strict --skip-web --skip-deploy`；固定 pgvector 镜像、V25 升级种子库与恢复库；保存 Surefire 和 Flyway 日志。 | 定向冒烟仅作为前置检查；AI PostgreSQL 用例及原有 Testcontainers **0 跳过**，V27 新库与 V25 旧库升级、权限、隔离、故障恢复全部通过后，G1 才通过。 |
| G2 网关与三端 | 隔离 Compose、两种 Caddy 配置、Keycloak 测试身份、Playwright 与 Android；脱敏 HTTP 证据。 | T01/T03/T04/T11/T13 通过，原业务无回归。 |
| G3 供应商小样本 | 选定区域和模型，专用测试密钥、固定问题集、费用与延迟记录。 | T07～T10 的真实服务部分通过；维度、错误映射、成本与保留约束有签认。 |
| G4 恢复与发布 | 隔离备份/恢复/回退演练，发布清单及 Gate 记录。 | T12 通过；C01～C05、C13、C14 已关闭；试点所需 P1 全部关闭；明确开关、回退和负责人。 |

现有 [回退覆盖文件](../deploy/docker-compose.rollback.yml)已为 N-1 演练设置 future migration 忽略规则；不应把它当作生产长期跳过 V27 的配置。现有 CI 已有严格 Testcontainers 主门槛，但仍需要把本表新增的 AI 专项断言接入对应流水线，并保留运行证据。

## 7. 本次自检与未决输入

- 逐一核对了本报告所引用的核心代码、迁移、启动脚本、Caddy 配置、CI 和原开发文档；冲突按“确认”或“待运行”标注，没有将推断写成已复现故障。
- 审查时对本地现存 48 个 Surefire XML 汇总为 151/0/0/3；当时 Docker Engine 不可用，所以未给 PostgreSQL、Caddy、真实供应商或恢复演练填写“通过”。当日晚些时候的 PostgreSQL 补充验证见第 8 节。
- 本轮只新增审查与测试方案，不修改当前实现；工作树另有正在进行的 Android 动画、部署与文档改动，后续实现前应按功能包核对差异，避免把无关改动混入 AI 发布。
- 仍需确定：供应商及数据处理区域、Chat/Embedding 模型和维度、服务端凭据、文档分类/可见性、会话性格语义、试点预算与质量阈值、AI 所属发布批次及 Gate 记录。

## 8. Docker 恢复后的补充验证（2026-09-29 21:19）

- Docker Desktop WSL 发行版已从 D 盘虚拟磁盘重新登记并可启动；Engine 28.3.2 可连接，原环境的 34 个容器和 135 个卷可见。D 盘启动脚本经停止、重新启动验证成功。此结果仅证明开发机 Docker 恢复，不构成生产部署验收。
- 使用 JDK 17、Maven 3.9.11 和 D 盘迁移后的 Maven 本地仓库，运行 `PostgresFlywaySmokeTest,AiVectorPostgresIntegrationTest`。Testcontainers 连接本机 Docker，拉取并启动 `pgvector/pgvector:0.8.6-pg16`；两项测试 **2 通过、0 失败、0 错误、0 跳过**。Flyway 在新 PostgreSQL 16 容器中完成至 V27。
- 本次未验证 V25 旧库升级、恢复库、Compose/Caddy、真实 AI 供应商或生产环境。21:19 时 C 盘 Docker Desktop 程序及损坏的 LocalAppData 连接点仍需处理；后续程序迁移与复测见第 9 节。

## 9. Docker Desktop 程序迁移 D 盘后的复测（2026-09-29 22:49）

- 停止 Docker Desktop 和 WSL 后，将原 D 盘数据 VHD、WSL 系统 VHD 复制到 E 盘；两个备份分别与源文件通过 SHA-256 比对。使用 Docker Inc 签名有效的同版本 4.43.2.199162 安装包，按官方卸载、重装流程将程序安装到 `D:\Program Files\Docker\Docker`，WSL 数据根目录设为 `D:\moveFile\DockerWSL\wsl`。
- 恢复配置并更新桌面快捷方式后，D 盘启动脚本通过停机、重新启动验证；Engine 28.3.2、原有 34 个容器、135 个卷、16 个网络可见。系统 PATH 已指向 D 盘 Docker CLI；新终端可运行 `docker info` 和 `docker compose version`。
- 重跑 `PostgresFlywaySmokeTest,AiVectorPostgresIntegrationTest`：**2 通过、0 失败、0 错误、0 跳过**；Testcontainers 使用本机 Docker，Flyway 到 V27。此次仍不代表 Compose/Caddy、旧库升级、真实 AI 服务或生产环境验收。
- `C:\Users\Raid\AppData\Local\Docker` 的旧损坏连接点依然存在，因此使用已更新的桌面快捷方式启动；C 盘还保留 Docker 安装器放置的 CLI 插件和少量用户配置。恢复备份及操作记录位于 `E:\DockerRecoveryBackup-20260929` 和 `D:\moveFile\DockerWSL\codex-reconnect-backup-20260929\RECOVERY-NOTE.txt`。

## 10. Docker 恢复后的测试方案更新（2026-09-29）

Docker 不可用已不再是本机测试阻塞项。第 8、9 节的两次定向复测均通过，但只证明新 PostgreSQL 16 库可以迁移到 V27，以及同名文档的向量检索不会跨站点返回；它们没有覆盖 V25 旧库升级、完整权限链、故障恢复或部署网关。T02 只完成新库部分，T06 只完成基础站点隔离部分；G1～G4 均保持待验。

| 顺序 | 要执行的检查 | 通过证据与状态 |
| --- | --- | --- |
| 1. 本机入口检查 | 由已更新的桌面快捷方式启动 Docker；在新终端确认 `docker info`、`docker compose version`、WSL 路径和原容器/卷数量。JDK 17 与 Maven 3.9.11 使用 D 盘 Maven 仓库。 | Docker 连接、停机重启和两项定向 Testcontainers 用例已通过；后续测试前复查 Engine，避免环境故障被误记为代码失败。 |
| 2. G0/G1 全量后端与数据库 | 本机先跑后端 `clean verify` 并汇总 Surefire；CI 跑 `bash scripts/verify.sh --strict --skip-web --skip-deploy`。补充 V25 种子库到 V27、迁移账号非超级用户、跨站权限、入库失败重试和向量版本切换测试。 | 后端与 CI 报告均为 0 失败、0 错误；严格门槛下 0 跳过。当前仅两项定向用例通过，不能据此关闭 G1。 |
| 3. G2 网关与三端 | 在隔离的 Compose 项目、专用端口和卷中验证两套 Caddy 配置、上传 5/6 MB 边界、普通 API 1 MB 边界、身份与站点切换；随后跑 Playwright 与 Android。 | T01/T03/T04/T11/T13 的运行日志、HTTP 断言和构建报告。当前未运行。 |
| 4. G3 远程模型 | 先以 HTTP Stub 跑 Chat/Embedding 契约、429/503/超时和密钥脱敏；选定供应商、区域、模型及维度后，使用测试站点和服务器端测试密钥跑小样本与 30～50 题评估集。 | T07～T10 的协议、质量、延迟、成本和失败降级证据。当前未运行，不以本机 Docker 成功代替远程服务验收。 |
| 5. G4 恢复与回退 | 在隔离环境中使用备份副本演练数据库、原文、向量和 N-1 回退；核对 AI 关闭后主业务可用、迁移清单和 Gate 记录。 | T12 与发布清单通过。现有 E 盘 VHD 是 Docker 灾备副本，不等于应用数据恢复演练；当前未运行。 |

**冲突控制：** 本机旧终端可能仍缓存 C 盘 Docker PATH，且 `C:\Users\Raid\AppData\Local\Docker` 是损坏连接点；启动统一使用 D 盘脚本或桌面快捷方式。`C:\Users\Raid\.m2` 同样损坏，本机 Maven 使用 D 盘仓库；CI 不依赖这些本机路径。Compose 测试先确认项目名、固定容器名、端口和卷不会触碰原有容器。测试环境维持 `IOT_AI_ENABLED=false` 默认值；仅在隔离测试站点和完成 G3 前置条件后启用远程模型，不因 Docker 可用而打开生产 AI。

## 11. 新 D 盘目录复测（2026-09-30）

- 电脑管家将原 `D:\moveFile` 目录迁到 `D:\电脑管家迁移文件` 后，旧路径已不存在，Docker Engine 和 WSL 最初无法启动。新路径分别为 `D:\电脑管家迁移文件\DockerWSL`（WSL 虚拟磁盘）和 `D:\电脑管家迁移文件\Docker`（运行日志与状态）；Docker Desktop 程序仍安装在 `D:\Program Files\Docker\Docker`。
- 停机复制两块新路径 VHD 到 `E:\DockerRecoveryBackup-20260930-new-path`，源文件与备份的 SHA-256 均一致。随后重登记 `docker-desktop` WSL 发行版，并将安装默认数据根目录、用户设置、启动脚本与两个桌面快捷方式改为新路径。
- 新路径启动脚本经停机、重启验证：Engine 28.3.2，原有 34 个容器、135 个卷、16 个网络可见；`D:\电脑管家迁移文件\Docker\log` 中有本次启动的新日志。使用迁移后的 Maven 仓库 `D:\电脑管家迁移文件\C盘迁移\Users\Raid\.m2\repository` 重跑 `PostgresFlywaySmokeTest,AiVectorPostgresIntegrationTest`，结果 **2 通过、0 失败、0 错误、0 跳过**，Flyway 到 V27。`docker compose --env-file deploy/.env.example -f deploy/docker-compose.yml config --quiet` 也通过；这是静态配置检查，尚未启动整套服务。
- 第 10 节的 G1～G4 完整门槛和待测项不变；本节只确认目录变更后的开发机 Docker 与定向数据库测试恢复。第 8、9 节中的 `D:\moveFile` 是当时的历史路径，后续本机操作一律使用本节新路径。旧的 C 盘 LocalAppData 损坏连接点仍存在，直接执行 `docker desktop` 子命令可能输出日志路径警告；通过更新后的快捷方式启动，或仅在当前命令会话将 `LOCALAPPDATA` 设为 `D:\电脑管家迁移文件`。

## 12. 全量后端与三端复测（2026-09-30 00:19）

- 使用 JDK 17、Maven 3.9.11、新 D 盘 Maven 仓库和当前 Docker Engine 执行后端 `mvn verify`（未执行 `clean`）。Maven 最终汇总为 **151 项、0 失败、0 错误、0 跳过，BUILD SUCCESS**；48 个本轮 Surefire XML 汇总相同，JAR 打包成功。全量测试中的 PostgreSQL/Testcontainers 用例不再跳过。
- 分别执行控制台、移动端 Web、监控页的 `npm run test` 与 `npm run build`：测试 **1、168、2 项全部通过**，三个 Vite 构建成功。没有执行 Playwright 端到端或 Android 包构建。
- 本机 `docker info` 可连接 Engine 28.3.2；生产 Compose 的 `config --quiet` 通过。该命令只验证配置解析，没有启动 Compose 服务。旧 V25 数据卷升级、Caddy/Keycloak 实际请求、真实供应商、备份恢复及 CI 严格门槛仍待验。因此 G1～G4 状态不变，G0 仅本机后端和三端测试/构建已有新证据。
