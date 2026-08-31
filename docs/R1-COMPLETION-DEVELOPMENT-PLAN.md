# IoT Manager R1 收敛与完整性改进开发文档

**版本：** 1.0
**日期：** 2026-08-25
**文档状态：** 可执行实施补充，待 Gate 2 / Gate 3 证据签发
**适用范围：** backend、edge-agent、client、frontend、console、deploy、scripts、.github
**目标版本：** 单组织、多站点、受控网络 R1 试点
**责任角色：** 产品负责人、Backend 负责人、移动端负责人、Web 负责人、Edge 负责人、DevOps、测试负责人、安全负责人

> 本文是 PROJECT-APPROVAL-REVIEW.md v1.3 和 PROJECT-IMPROVEMENT-PLAN.md
> v1.6 之下的执行补充，不替换审批意见、不扩大 R1 范围。发生冲突时固定按以下顺序处理：
> 审批意见 > 整改基线 > 本文 > 功能扩展路线图。

## 0. 固定结论

本文冻结以下决定，实施期间不得再次模糊选择：

1. 正式代码仓库使用 xxbb11122/IotManager。
2. 当前版本定位为 R1 受控试点，不是公网生产版，也不是完整多租户 SaaS。
3. 保留 .github/workflows/ci.yml 作为唯一快速基础 CI。
4. 保留 .github/workflows/runtime-e2e.yml 作为完整 Docker 运行态 CI。
5. 新增受保护的 .github/workflows/recovery-drill.yml，验证 WAL、RPO 和 RTO。
6. 将 verify.yml 的独有检查并入 ci.yml 后删除 verify.yml，禁止两套基础 CI 并行漂移。
7. CI 和 Gate 验收采用严格模式；任何失败、错误或非批准的跳过均阻断。
8. H2 专用 V19 永久用于长文本兼容；下一条通用或 PostgreSQL 生产迁移从 V20 开始。
9. Backend 和 Edge 固定 JDK 17；Android 固定 JDK 21；Web 固定 Node.js 22；Maven 固定 3.9 以上。
10. R1 继续采用单主机 Docker Compose，不引入 Kubernetes、Redis、多实例或 mTLS。
11. 天气主源固定为 Open-Meteo；QWeather 和 Geo API 只有供应商审查通过后才能启用。
12. R1 只要求 Android 最小真机矩阵和同签名覆盖安装；完整离线、发布包回滚属于 R2。
13. FX-01、FX-02、FX-04、FX-05 仍为 Gate 3 之后的 R1.1 候选，不得提前并入 R1。
14. 工单、报表、地图、外部通知、OTA、MQTT、Modbus、iOS 和多租户不属于当前开发范围。

## 1. 项目定位与目标

### 1.1 产品定位

IoT Manager 是面向现场局域网和云端设备的物联网运维平台。平台服务于现场运维人员、
监控人员和管理员，统一提供：

- 设备发现、认领、分组、归档和生命周期管理；
- Device Profile 能力建模；
- 幂等命令、过期控制、读回确认和审计；
- 遥测、告警、活动和实时 WebSocket 更新；
- Edge Agent 和局域网设备接入；
- Android 原生 BLE 接入；
- 站点天气、海拔、温湿度、气压和环境风险；
- 组织、站点、空间和设备授权隔离；
- 监控大屏、运维控制台和 Android/PDA 三类界面。

### 1.2 R1 成功标准

R1 只在以下结果同时成立时完成：

1. 单组织下至少两个站点可以被不同用户授权。
2. 三端均能切换授权站点，且 API、缓存、WebSocket、天气和命令不串站。
3. Keycloak、PostgreSQL、Backend 和 Caddy 可以从空环境重复部署。
4. OWNER、ADMIN、OPERATOR、VIEWER 四角色权限与服务端规则一致。
5. 真实设备命令具备幂等、过期、确认和安全失败语义。
6. Open-Meteo 失败时可以正确缓存降级，不发生刷新风暴。
7. 手机定位仅由用户主动触发，完整坐标不进入日志。
8. PostgreSQL 可以备份、独立恢复并达到 RPO 和 RTO 目标。
9. nRF52840、Shelly 和 Android 真机最小矩阵通过。
10. 每个结论都能追溯到同一 Git SHA、测试报告和审批签字。

### 1.3 明确不属于 R1 的目标

以下能力缺失不阻断 R1，但不得被宣称已经完成：

- Redis Streams、Pub/Sub 和分布式锁；
- 多 Backend 实例和滚动升级；
- Agent mTLS；
- 1000 设备规模压测和 24 小时稳定性；
- 事件工单、健康分、命令模板和二维码认领；
- 地图、报表、通知、OTA、MQTT、Modbus 和 iOS；
- 多组织自助开通、计费、配额和完整多租户 SaaS。

## 2. 已验证基线

### 2.1 2026-08-25 重新执行结果

本次使用 JDK 17 执行 scripts/verify.ps1 -SkipDeploy，结果如下：

| 模块 | 结果 | 说明 |
|---|---:|---|
| Backend | 113 项，0 失败，0 错误，1 跳过 | PostgreSQL Testcontainers 因 Docker Engine 停止而跳过 |
| Edge Agent | 7 项全部通过 | 无失败、错误或跳过 |
| Client 单元测试 | 84 项全部通过 | 无失败、错误或跳过 |
| Client 移动布局 E2E | 1 项通过 | 使用模拟 API |
| Runtime Auth E2E | 3 项跳过 | 完整 Keycloak/Compose 未启动 |
| Frontend | 生产构建通过 | 暂无独立自动化测试 |
| Console | 生产构建通过 | 暂无独立自动化测试 |
| Client | 生产构建通过 | Vite 构建通过 |

本轮非部署基线退出码为 0，但由于存在四项环境条件跳过，不构成 Gate 2 证据。

### 2.2 2026-08-24 历史运行证据

artifacts/p0-runtime/20260824T215822Z 记录以下服务曾处于 healthy：

- backend；
- backup；
- caddy；
- keycloak；
- postgres；
- wal-g-archive；
- wal-g-backup。

历史证据还记录了本地 PKCE/JWT/RBAC、Caddy 边界和独立逻辑恢复冒烟。该证据证明实现
可运行，但不能代替干净 GitHub Runner、完整 WAL 恢复、真实设备和签字审批。

### 2.3 当前阻断项

| 编号 | 级别 | 当前问题 | 直接影响 |
|---|---|---|---|
| GAP-01 | P0 | 最新 P0 变更尚未形成干净提交 | GitHub 无法复现本机成果 |
| GAP-02 | P0 | ci.yml 与 verify.yml 重复 | 检查规则可能漂移 |
| GAP-03 | P0 | Runtime CI 未覆盖 client 全目录变化 | 移动端改动可能不触发全栈 |
| GAP-04 | P0 | Gate 验证允许测试跳过后返回成功 | 证据可能产生假阳性 |
| GAP-05 | P0 | 真实 Keycloak 只覆盖 OWNER/VIEWER | ADMIN/OPERATOR 可能存在配置偏差 |
| GAP-06 | P0 | Token 刷新、注销和重放未进入真实运行态 E2E | 会话生命周期未闭环 |
| GAP-07 | P0 | V19 H2 迁移与文档中的 R1.1 V19 冲突 | 后续 Flyway 可能重复版本 |
| GAP-08 | P0 | Runtime CI 只做逻辑恢复 | WAL、RPO、RTO 尚未签发 |
| GAP-09 | P0 | 无 Gitleaks、Trivy、SBOM 自动门禁 | 供应链和 Secret 风险未自动阻断 |
| GAP-10 | P1 | Android Release 无签名配置 | 不能生成正式可升级包 |
| GAP-11 | P1 | Frontend/Console 无独立 E2E | 三端回归覆盖不完整 |
| GAP-12 | P1 | 指标已有代码但缺少采集和告警验收 | 运维无法确认异常闭环 |
| GAP-13 | P1 | 文档仍保留 Docker 未验证等旧结论 | 项目状态不可审计 |
| GAP-14 | P1 | 真实手机、nRF52840、Shelly 未完成 Gate 3 | 真实设备控制不能批准 |
| GAP-15 | 环境 | 默认 Java 为 8、Maven 为 3.8.8、Node 为 24 | 本地和 CI 不可重复 |

## 3. 目标架构

目标 R1 拓扑固定为：

    Android / PDA -----------+
                              |
    监控大屏 -----------------+--> Caddy HTTPS/WSS
                              |       |
    运维控制台 ---------------+       +--> Keycloak OIDC
                                      |
                                      +--> Spring Boot Backend
                                                |
                                                +--> PostgreSQL 16
                                                +--> Open-Meteo
                                                +--> Prometheus 指标
                                                |
    LAN / Shelly --> Edge Agent <--- WSS Token -+
    BLE / nRF52840 --> Android

    PostgreSQL --> 逻辑备份 --> 独立恢复实例
              --> WAL-G --> 加密、版本化、不可变对象存储

网络边界：

- 只有 Caddy 可以发布宿主机 80/443；
- PostgreSQL、Backend、Keycloak 和指标端口不得直接发布；
- Backend 与 Keycloak 位于内部网络；
- Backend 和 WAL-G 通过受控出口访问外部服务；
- Release Android 只允许 HTTPS/WSS；
- Debug Android 的 HTTP/WS 例外不得进入 Release。

## 4. 固定技术决策

| 领域 | 决策 | R1 约束 |
|---|---|---|
| Backend | Spring Boot 3.2 系列、Java 17 | 升级版本另建兼容分支 |
| 用户认证 | Keycloak OIDC + JWT Resource Server | 三端 Authorization Code + PKCE S256 |
| 用户角色 | OWNER、ADMIN、OPERATOR、VIEWER | 服务端强制授权 |
| Agent 认证 | 每 Agent 独立 Token over WSS | 只保存哈希，支持轮换和吊销 |
| 数据库 | PostgreSQL 16 | H2 仅开发和单元测试 |
| 迁移 | Flyway | V19 为 H2 专用，通用迁移从 V20 继续 |
| 入口 | Caddy | HTTPS、WSS、严格 CORS、安全头、请求体限制 |
| 天气主源 | Open-Meteo | 超时后缓存降级 |
| 天气备用源 | QWeather | 供应商审查通过后条件启用 |
| 移动端 | Capacitor Android，API 24～36 | Release 签名，Keystore 存储 Token |
| 备份 | 逻辑备份 + WAL-G | 独立恢复、RPO 不超过 15 分钟 |
| 可观测性 | Actuator + Micrometer + Prometheus | 指标私有，不经公网裸露 |
| 基础 CI | ci.yml | 快速、严格、每次 PR 执行 |
| 运行态 CI | runtime-e2e.yml | 完整 Compose 和真实 Keycloak |
| 恢复 CI | recovery-drill.yml | 受保护环境执行 |

## 5. 实施阶段与任务矩阵

### 5.1 固定实施顺序

实施顺序不得调整为先做新功能：

1. S0：仓库、工具链和迁移编号收敛；
2. S1：基础 CI 与严格证据；
3. S2：Gate 2 身份、安全、数据库和恢复闭环；
4. Gate 2：P0 实现审批；
5. S3：天气、多站点、可观测性和 Web E2E；
6. S4：Android Release 与真实硬件；
7. Gate 3：R1 试点审批；
8. R1.1：通过 CR-01 后逐个开发候选功能包；
9. R2：Redis、mTLS、压测、安全扫描和故障演练；
10. Gate 4：R2 生产基础版审批。

### 5.2 任务追踪矩阵

| ID | 优先级 | 工作项 | 负责人 | 依赖 | 目标 Gate |
|---|---|---|---|---|---|
| S0-REP-01 | P0 | 收敛 Git 变更并推送正式仓库 | DevOps + 全体 | 无 | Gate 2 |
| S0-REP-02 | P0 | 增加 .gitattributes 和 Secret 清理 | DevOps + 安全 | S0-REP-01 | Gate 2 |
| S0-TOOL-01 | P0 | 固定 JDK、Maven、Node 和 Wrapper | DevOps | 无 | Gate 2 |
| S0-DB-01 | P0 | 固定 V19/V20 迁移编号规则 | Backend + DBA | 无 | Gate 2 |
| S1-CI-01 | P0 | 合并 ci.yml 与 verify.yml | DevOps + 测试 | S0-REP-01、S0-TOOL-01、S0-DB-01 | Gate 2 |
| S1-CI-02 | P0 | Runtime CI 补全触发路径 | DevOps | S1-CI-01 | Gate 2 |
| S1-CI-03 | P0 | strict 模式和零跳过门禁 | 测试 + DevOps | S1-CI-01 | Gate 2 |
| S1-SEC-01 | P0 | Gitleaks、Trivy、依赖扫描、SBOM | 安全 + DevOps | S1-CI-01 | Gate 2 |
| S2-AUTH-01 | P0 | 四角色真实 Keycloak 权限矩阵 | Backend + 安全 | S1-CI-01 | Gate 2 |
| S2-AUTH-02 | P0 | Token 生命周期与 bootstrap 幂等 | Backend + Web + 测试 | S2-AUTH-01 | Gate 2 |
| S2-DB-01 | P0 | PostgreSQL 迁移、故障和 fail-closed | Backend + DBA | S0-DB-01 | Gate 2 |
| S2-DR-01 | P0 | 逻辑备份独立恢复 | DBA + DevOps | S2-DB-01 | Gate 2 |
| S2-DR-02 | P0 | WAL/PITR/RPO/RTO 受保护演练 | DBA + 安全 | S2-DR-01 | Gate 2 |
| S2-NET-01 | P0 | Caddy TLS/CORS/WSS/端口边界 | DevOps + 安全 | S1-CI-01 | Gate 2 |
| S2-EDGE-01 | P0 | Agent 凭据与模拟命令运行态 | Edge + Backend | S2-AUTH-01 | Gate 2 |
| S3-WEA-01 | P1-Core | 天气可靠性、隐私和边界测试 | Backend + 移动端 | Gate 2 | Gate 3 |
| S3-SITE-01 | R1 | 两站点三端隔离 E2E | 三端 + Backend | Gate 2 | Gate 3 |
| S3-OBS-01 | P1-Core | Prometheus 采集、日志和告警 | Backend + DevOps | Gate 2 | Gate 3 |
| S3-UI-01 | P1-Core | Frontend/Console Playwright | Web + 测试 | Gate 2 | Gate 3 |
| S4-MOB-01 | P1-Core | Android Release 签名与版本 | 移动端 + DevOps | S3-WEA-01、S3-SITE-01 | Gate 3 |
| S4-MOB-02 | P1-Core | Android 真机最小矩阵 | 移动端 + 测试 | S4-MOB-01 | Gate 3 |
| S4-DEV-01 | P0/R1 | nRF52840 和 Shelly 真实验收 | Edge + 测试 | S2-EDGE-01 | Gate 3 |
| S4-DOC-01 | R1 | 文档、运维手册和审批包 | 全体 | 全部 | Gate 3 |

## 6. 详细开发工作包

### 6.1 S0：仓库与工具链

#### 修改内容

- 正式远端固定为 xxbb11122/IotManager；
- 创建 codex/p0-gate2-release；
- 将当前已跟踪和未跟踪的 P0 改造纳入同一可审计提交序列；
- 增加 .gitattributes，源码、脚本和 YAML 固定 LF；
- 增加 Maven Wrapper；
- 增加 .java-version，值为 17；
- 增加 .nvmrc，值为 22；
- Android CI 显式使用 JDK 21；
- scripts/verify.ps1 和 scripts/verify.sh 校验真实 Maven 版本；
- 文档不再要求开发者依赖系统默认 Java。

#### 验收

1. 从空目录克隆仓库；
2. 不读取开发者原有 .env 或本机 Secret；
3. 使用固定工具链完成快速验证；
4. git status 保持干净；
5. git diff --check 无空白错误；
6. Windows 和 Linux 生成一致的配置结果。

### 6.2 S1：CI 与严格证据

#### ci.yml

ci.yml 固定包含以下作业：

1. java：
   - Backend mvn verify；
   - Edge Agent mvn verify；
   - PostgreSQL Testcontainers 必须实际执行；
   - Surefire failures、errors、skipped 均为 0。
2. web：
   - frontend npm ci 和 build；
   - console npm ci 和 build；
   - client npm ci、84 项单元测试、移动布局 E2E 和 build。
3. android-debug：
   - JDK 21；
   - API 36；
   - assembleDebug；
   - 上传带 Git SHA 的 Debug APK。
4. deploy-static：
   - Compose 插值和 Schema；
   - Caddy validate；
   - Backend、Caddy、Keycloak、PostgreSQL 镜像构建。
5. security-baseline：
   - Gitleaks；
   - Trivy 文件系统和容器扫描；
   - Maven/npm 依赖漏洞；
   - 许可证报告；
   - CycloneDX 或等价 SBOM。

verify.yml 的独有步骤合入后删除该文件。

#### runtime-e2e.yml

触发路径至少覆盖：

- backend/**；
- edge-agent/**；
- client/**；
- frontend/**；
- console/**；
- deploy/**；
- profiles/**；
- shared/**；
- scripts/runtime/**；
- .github/workflows/**。

运行内容：

1. 生成仅用于本次任务的随机 Secret；
2. 启动身份平面；
3. 重复 reconcile 两次；
4. 引导 OWNER、ADMIN、OPERATOR、VIEWER；
5. 启动业务平面；
6. 等待七个长期服务 healthy；
7. 执行 PKCE、JWT、RBAC、站点隔离、CORS、TLS、WSS 和 Agent 测试；
8. 验证 PostgreSQL 应用账号 DDL 被拒绝；
9. 执行逻辑备份独立恢复；
10. 扫描 Artifact 中的 Secret；
11. 无条件清理本次专用项目，不删除其他项目 Volume。

#### strict 模式

scripts/verify.ps1 和 scripts/verify.sh 增加 strict 参数：

- 本地快速模式允许已声明的外部条件跳过，但必须在结尾列明；
- GitHub CI strict 模式中任何跳过直接返回非零；
- runtime-auth.spec.js 在 runtime workflow 中必须全部执行；
- PostgresFlywaySmokeTest 在 CI 中不得 disabledWithoutDocker；
- 证据清单必须记录实际执行数，而不是只记录脚本退出码。

### 6.3 S2：身份、角色和会话

#### 四角色权限矩阵

| 操作 | OWNER | ADMIN | OPERATOR | VIEWER |
|---|---:|---:|---:|---:|
| GET 设备、天气、告警 | 200 | 200 | 200 | 200 |
| POST 新增和命令 | 允许 | 允许 | 允许 | 403 |
| PUT/PATCH 修改 | 允许 | 允许 | 允许 | 403 |
| DELETE 删除 | 允许 | 允许 | 403 | 403 |
| Agent Credential 管理 | 允许 | 允许 | 403 | 403 |
| 公网 Actuator | 拒绝 | 拒绝 | 拒绝 | 拒绝 |
| 跨站点访问 | 403 | 403 | 403 | 403 |
| 无成员用户访问站点 | 403 或空授权列表 | 403 或空授权列表 | 403 或空授权列表 | 403 或空授权列表 |

#### 会话生命周期

真实浏览器 E2E 必须覆盖：

- 三端 PKCE S256；
- State 校验；
- 错误 Redirect URI；
- 过期 Authorization Code；
- Authorization Code 重复兑换；
- Access Token 到期；
- Refresh Token 轮换；
- 旧 Refresh Token 重放拒绝；
- 注销；
- 注销后的 Refresh Token 失败；
- WSS Bearer 子协议；
- Token 不得进入 URL、日志和持久化端点配置。

#### bootstrap 与 reconcile

- OWNER、ADMIN、OPERATOR、VIEWER 仅在 integration 环境自动创建；
- 生产仅允许一次性 OWNER 引导；
- 重复 bootstrap 不产生重复用户或成员关系；
- reconcile 连续执行两次，第二次无配置漂移；
- 任一步失败时 Backend 不得启动；
- 测试密码只存在本次任务 Secret 文件中。

### 6.4 S2：数据库与迁移

#### 迁移编号

- 通用历史迁移：V1～V18；
- H2 专用兼容迁移：V19；
- 下一条通用/PostgreSQL迁移：V20；
- 禁止再创建任何其他 V19；
- CI 扫描所有 migration location，发现重复版本立即失败。

#### PostgreSQL验收

- PostgreSQL 16 新库从空 Schema 应用 V1～V18；
- 所有 checksum 与仓库一致；
- Hibernate validate 通过；
- 重启 PostgreSQL 不丢数据；
- Backend 运行账号为 NOSUPERUSER、NOCREATEDB、NOCREATEROLE；
- Backend 账号不能 CREATE TABLE；
- Flyway Owner 只能管理业务 Schema，不得创建角色或数据库；
- 注入错误迁移时 Backend 非零退出；
- PostgreSQL 停止时 readiness 为 DOWN；
- 不得回退 H2；
- 数据库恢复后 Backend 无需删除 Volume 即可重新 UP。

#### 回滚原则

- 历史迁移禁止修改和重编号；
- 结构变更使用 Expand-Contract；
- 不执行 Flyway 自动 downgrade；
- 数据恢复只能指向已确认的独立目标；
- 迁移 PR 必须写明兼容期、回滚镜像和恢复方式。

### 6.5 S2：备份、WAL与恢复

#### 每次 Runtime CI

- 生成逻辑 dump；
- 生成 SHA-256；
- 恢复到新的 Compose project 和新的 Volume；
- 校验 Flyway 版本；
- 验证关键表记录；
- 验证恢复后读写；
- 恢复脚本拒绝当前源项目和已有目标 Volume。

#### 受保护 recovery-drill.yml

- 通过 GitHub Environment 审批后执行；
- 连接专用 S3 兼容测试 Bucket；
- Bucket 开启服务端加密、版本控制和 Object Lock；
- 触发 WAL 归档和 base backup；
- 写入带时间戳的恢复标记；
- 模拟源数据库故障；
- 使用 WAL-G 在独立实例恢复到目标时间点；
- 记录故障、恢复点、readiness 和读写成功时间；
- 计算 RPO 与 RTO；
- RPO 大于 15 分钟或 RTO 大于 60 分钟时失败。

### 6.6 S2：Caddy和网络边界

必须自动验证：

- HTTP 308 跳转 HTTPS；
- HSTS；
- X-Content-Type-Options；
- Referrer-Policy；
- Content-Security-Policy；
- 允许 Origin 返回正确 CORS；
- 非法 Origin 不返回 Allow-Origin；
- 超过 1 MB 请求返回 413；
- H2 Console 在生产入口为 404；
- 未登录业务 API 为 401；
- 只有 Caddy 发布 80/443；
- 5432、8080 和 Keycloak 内部端口不可从宿主直接访问；
- WSS 通过 Caddy；
- Release 客户端拒绝 HTTP/WS；
- integration 安装内部 CA 后不使用跳过证书校验参数也能成功；
- 生产使用真实 DNS 和 ACME，不得使用内部 CA。

### 6.7 S2：Edge Agent和安全命令

运行态验收必须覆盖：

- 凭据签发时 Token 只显示一次；
- 数据库只存 BCrypt 或等价安全哈希；
- 列表接口不返回 Token；
- 凭据 lastUsedAt 更新；
- 轮换后旧凭据立即失败；
- 吊销后现有或新建 WSS 被拒绝；
- 错误站点、错误 Agent 或错误 Token 被拒绝；
- 相同幂等键不造成重复物理执行；
- 同一设备命令串行；
- 过期命令重连后不重放；
- PENDING、SENT、ACKNOWLEDGED、FAILED、UNCONFIRMED、EXPIRED 状态正确；
- UNCONFIRMED 不更新 reportedState；
- 未知 Profile 只读；
- Agent 断线后客户端显示陈旧状态，禁止控制。

真实 nRF52840 与 Shelly 测试保留到 Gate 3。

### 6.8 S3：天气可靠性与隐私

#### 固定刷新预算

- 后端每站点固定延迟 30 分钟；
- 首次计划刷新延迟 30 秒；
- 失败只进行一次 30 秒短重试；
- 当前天气读取缓存 10 分钟；
- 预报缓存 30 分钟；
- 回到前台超过 5 分钟才同步；
- 下拉或手动刷新冷却 60 秒；
- 429 返回 Retry-After；
- WebSocket 正常时不使用 REST 定时器重复轮询；
- 实时事件触发的设备重同步冷却 2 分钟；
- 页面实时渲染最短间隔 2 秒。

#### 数据质量

- FRESH：抓取时间不超过 45 分钟；
- STALE：超过 45 分钟且不超过 6 小时；
- UNAVAILABLE：没有快照或快照超过 6 小时；
- 主源失败时返回最后有效快照；
- 未配置坐标时显示天气未配置，不使用默认城市；
- 切换站点后必须重新按站点读取；
- 上游恢复后只进行一次短重试。

#### 环境状态

状态优先级固定为：

危险红色 > 观察黄色 > 适宜绿色 > 不可用灰色。

温度、湿度、气压、ESD 和结露风险使用整改基线中已批准的阈值。每个边界必须至少验证：

- 边界前一个可表示值；
- 边界值；
- 边界后一个可表示值；
- null、NaN、单位异常和超范围；
- 多项风险并存时使用最高严重度；
- 未配置表面温度时结露风险返回灰色，不伪造安全结论。

#### 隐私

- 手机定位只在用户主动点击后获取一次；
- 不启用后台定位和位置 watch；
- 精确和大致定位均能正常处理；
- 永久拒绝和系统定位关闭显示操作引导；
- 日志、指标和天气原始响应不保留完整坐标；
- 持久化指纹使用 HMAC；
- V18 天气调用审计生效；
- 位置删除后按策略删除或粗化历史精确坐标；
- QWeather 未审批时不发送任何坐标。

### 6.9 S3：最小多站点

测试固定创建 site-a 和 site-b，并为用户配置不同成员关系。

三端必须验证：

- 授权站点列表；
- 当前站点切换；
- 设备、天气、活动和告警随站点变化；
- API 查询带明确 siteCode；
- 本地缓存按端点、组织和站点分区；
- WebSocket 仅收到当前授权站点事件；
- 切换过程中在途命令仍绑定原端点和原站点；
- 旧站点命令不会发到新站点设备；
- 离线快照不串站；
- 删除或失去成员权限后缓存进入只读并被清理；
- 无成员和跨站点访问被服务端拒绝。

### 6.10 S3：可观测性

增加 deploy/observability profile，至少包含 Prometheus 和 Alertmanager；Grafana可作为同一
profile 的内部运维界面。指标端口不得公网裸露。

必须采集：

- API P50、P95、P99 延迟和错误率；
- 命令成功、失败、超时、过期和未确认率；
- 天气刷新成功率、供应商失败、缓存降级和 429 次数；
- WebSocket 在线连接、拒绝和重连；
- Edge Agent 在线数、最后心跳和队列；
- PostgreSQL 连接池；
- 最后成功逻辑备份和 WAL 归档时间；
- Runtime CI 和恢复演练结果。

结构化日志必须包含：

- timestamp；
- level；
- service；
- requestId；
- traceId；
- actorId；
- organizationCode；
- siteCode；
- deviceId；
- result。

日志禁止包含：

- 密码；
- Access/Refresh Token；
- Agent 一次性 Token；
- 私钥；
- 完整坐标；
- Android 签名 Secret。

必须验证告警能够触发和恢复：

- Backend readiness DOWN；
- PostgreSQL 不可用；
- Edge Agent 长时间离线；
- 命令失败率超限；
- 天气连续失败；
- 备份或 WAL 长时间无成功记录。

### 6.11 S3：Frontend和Console测试

在修改公共逻辑前先增加 Playwright：

Frontend：

- PKCE 登录与注销；
- 授权站点切换；
- 设备统计和筛选；
- 天气当前值与预报；
- WebSocket 实时更新；
- 无权限和后端不可达状态；
- 两种桌面宽度和一个窄屏宽度。

Console：

- PKCE 登录与注销；
- 设备新增、修改、删除权限；
- Profile 控件；
- 发现与认领；
- 设备组和批量命令；
- Agent 凭据管理；
- VIEWER、OPERATOR、ADMIN 权限差异；
- 两站点隔离。

完成测试后再抽取三端重复的 API、OIDC、WebSocket 和站点上下文逻辑，避免无保护重构。

### 6.12 S4：Android Release

#### 构建

- 增加 release signingConfig；
- Keystore 和密码只存 GitHub 受保护 Secret；
- versionName 来自发布标签；
- versionCode 由发布流水线单调递增；
- 生成签名 APK 和 AAB；
- 生成 SHA-256；
- 发布清单记录 Git SHA、版本和构建时间；
- Release 保持 usesCleartextTraffic=false；
- Mixed Content 只允许 Debug；
- OAuth Token 继续使用 Android Keystore 加密存储。

#### 安装与升级

Debug 与 Release 签名不同，禁止把 Debug 直接覆盖 Release 作为验收。

正确验收流程：

1. 使用正式测试 Release Key 构建较低 versionCode；
2. 安装旧 Release；
3. 写入站点、缓存和 OIDC 会话；
4. 使用同一 Key 构建较高 versionCode；
5. 覆盖安装；
6. 验证配置迁移、Keystore 会话、站点缓存和 BLE 本地绑定；
7. 会话不可用时安全退出登录，不得暴露 Token。

#### 兼容矩阵

- Emulator API 24；
- Emulator API 36；
- 一台 Android 12～13 真机；
- 一台 Android 15～16 真机；
- 精确定位；
- 大致定位；
- 拒绝和永久拒绝；
- 系统定位关闭；
- 蓝牙关闭；
- Wi-Fi 与移动网络切换；
- 前后台切换；
- 后端断开和恢复；
- 下拉刷新；
- BLE 扫描、连接、确认、断线和重连。

### 6.13 S4：真实设备

nRF52840：

- 使用仓库参考固件；
- 只连接板载 LED 或低压负载；
- 验证 Profile UUID；
- 验证通知确认；
- 验证 read-back；
- 超时必须进入 UNCONFIRMED；
- 断线重连后不得重放过期命令。

Shelly Plus Plug S Gen2：

- 在隔离网络和低风险负载中测试；
- 验证发现、认领、状态读取和命令；
- 重复幂等键只执行一次；
- 设备断网后状态变陈旧；
- Agent 重连后恢复读取；
- 命令失败必须保留失败审计。

## 7. API与WebSocket契约

### 7.1 版本化原则

- 新功能只允许新增到 /api/v1；
- 旧 /api 别名只用于兼容；
- 旧接口返回 Deprecation 和 Sunset 信息；
- 删除旧接口必须经过独立版本审批；
- 客户端不得新增长期依赖旧接口；
- 破坏性响应字段变化必须发布新版本。

### 7.2 主要API

| 能力 | 接口 |
|---|---|
| 当前用户 | GET /api/v1/me |
| 授权站点 | GET /api/v1/sites |
| 设备列表 | GET /api/v1/devices |
| 设备详情 | GET /api/v1/devices/{id} |
| 新增设备 | POST /api/v1/devices |
| 修改设备 | PUT /api/v1/devices/{id} |
| 删除设备 | DELETE /api/v1/devices/{id} |
| 设备命令 | POST /api/v1/devices/{id}/commands |
| 命令状态 | GET /api/v1/commands/{commandId} |
| 命令事件 | GET /api/v1/commands/{commandId}/events |
| 遥测 | GET /api/v1/devices/{id}/telemetry |
| 告警 | GET /api/v1/alerts |
| 解决告警 | PUT /api/v1/alerts/{id}/resolve |
| 设备组 | /api/v1/device-groups |
| 批量命令 | /api/v1/command-batches |
| LAN发现 | GET /api/v1/discovery/lan |
| LAN认领 | POST /api/v1/discovery/lan/{candidateId}/claim |
| 当前天气 | GET /api/v1/sites/{siteCode}/weather |
| 天气预报 | GET /api/v1/sites/{siteCode}/weather/forecast |
| 天气设置 | GET/PUT /api/v1/sites/{siteCode}/weather-settings |
| 天气刷新 | POST /api/v1/sites/{siteCode}/weather/refresh |
| 手机位置 | POST /api/v1/sites/{siteCode}/weather/location |
| Agent凭据签发 | POST /api/v1/edge-agents/credentials |
| Agent凭据列表 | GET /api/v1/edge-agents/{agentId}/credentials |
| Agent凭据轮换 | POST /api/v1/edge-agents/{agentId}/credentials/rotate |
| Agent凭据吊销 | POST /api/v1/edge-agents/{agentId}/credentials/{credentialId}/revoke |

所有站点相关接口必须使用服务端成员关系校验，不能信任客户端传入的组织、站点或角色。

### 7.3 WebSocket

- /ws/devices：用户实时通道，JWT + 授权站点；
- /ws/edge/v1：Agent 通道，每 Agent 独立 Credential；
- 用户 Token 优先通过受限子协议传递，不进入 URL；
- Edge Token 使用专用 Header；
- 协议消息保留 protocolVersion；
- 未知版本被拒绝或忽略；
- 事件必须包含足够的 siteCode 以进行客户端隔离；
- 跨站点订阅和事件注入必须被拒绝。

## 8. 文件修改清单

| 区域 | 计划修改 |
|---|---|
| 根目录 | .gitattributes、.java-version、.nvmrc、Maven Wrapper |
| .github/workflows/ci.yml | 唯一快速 CI、strict、扫描、SBOM |
| .github/workflows/verify.yml | 合并后删除 |
| .github/workflows/runtime-e2e.yml | 全触发路径、四角色、Token 生命周期、证据 Manifest |
| .github/workflows/recovery-drill.yml | WAL/PITR/RPO/RTO 受保护演练 |
| scripts/verify.ps1 | 工具版本、strict、Surefire/E2E跳过检查 |
| scripts/verify.sh | 与 PowerShell 保持同等规则 |
| scripts/runtime/verify-stack.* | RT 用例编号、故障注入、证据摘要 |
| scripts/runtime/recovery-drill.* | 逻辑恢复证据与清理策略 |
| scripts/runtime/wal-recovery-drill.* | 新增 WAL 时间点恢复 |
| backend/pom.xml | Maven Wrapper兼容、扫描、必要测试插件 |
| backend/src/test | 四角色、PostgreSQL、指标、隐私、边界测试 |
| backend/resources/db | 保留H2 V19，后续从V20继续 |
| deploy/keycloak | 四角色测试用户、幂等reconcile |
| deploy/docker-compose.yml | 可观测性profile、健康和网络边界 |
| deploy/Caddyfile | 生产安全边界最终验收 |
| client/e2e/runtime-auth.spec.js | 四角色、刷新、注销、跨站点 |
| client/e2e/mobile-client.spec.js | 天气、下拉刷新、站点、离线 |
| client/android/app/build.gradle | Release签名、版本、构建产物 |
| frontend | Playwright配置与关键E2E |
| console | Playwright配置与关键E2E |
| docs | 状态、部署、恢复、用户、API和发布文档 |

## 9. 测试策略

### 9.1 分层

| 层级 | 运行频率 | 内容 | 是否允许跳过 |
|---|---|---|---|
| 单元测试 | 每次提交 | 状态机、规则、缓存、Profile、协议 | 否 |
| H2集成 | 每次提交 | Repository、Controller、基础迁移 | 否 |
| PostgreSQL集成 | 每个PR | Flyway、方言、权限、持久化 | Gate模式否 |
| Web E2E | 每个PR | 三端核心流程和布局 | 否 |
| Runtime E2E | 相关PR和主分支 | Keycloak、Caddy、PostgreSQL、WSS | 否 |
| 恢复演练 | 发布前和周期任务 | 逻辑恢复、WAL、RPO/RTO | 否 |
| Android真机 | 每个Release候选 | 定位、BLE、网络、覆盖安装 | 否 |
| 真实设备 | Gate 3候选 | nRF52840、Shelly | 否 |
| R2压测/安全 | Gate 4候选 | k6、ZAP、故障注入 | 否 |

### 9.2 Gate 2最小自动化结果

- Backend：失败 0，错误 0，跳过 0；
- Edge Agent：失败 0，错误 0，跳过 0；
- Client：失败 0，错误 0，跳过 0；
- Frontend、Console、Client构建成功；
- Layout E2E全部成功；
- Runtime Auth E2E全部成功；
- Compose七个长期服务 healthy；
- PostgreSQL真实迁移通过；
- 逻辑恢复和WAL恢复通过；
- P0安全扫描无阻断项。

### 9.3 R2性能基准

R2固定场景：

- 1000台设备；
- 每台30秒一条遥测；
- 约34条消息每秒；
- 100个并发WebSocket用户；
- 24小时稳定性；
- 错误率小于0.1%；
- 数据库、Redis和Backend重启；
- 后端滚动升级；
- 无重复事件、无跨站点事件、无过期命令重放。

## 10. 证据包

每次 Gate 候选必须生成 evidence-manifest.json 或等价机器可读清单，至少包含：

- Git SHA；
- 分支和Tag；
- GitHub Run ID；
- 操作系统；
- Java、Maven、Node、Docker和Compose版本；
- 镜像名称和digest；
- Flyway版本和checksum摘要；
- 各测试套件执行、失败、错误和跳过数量；
- PKCE和角色矩阵结果；
- CORS、TLS、WSS和端口结果；
- 备份SHA-256；
- 恢复点、RPO和RTO；
- Android版本、签名证书指纹和APK SHA-256；
- nRF52840和Shelly设备型号、固件和结果；
- 已知限制；
- 测试、安全、DevOps和产品审批结论。

证据包严禁包含：

- .env；
- 密码；
- Access/Refresh Token；
- Agent一次性Token；
- Cookie；
- 私钥；
- Keystore；
- 完整坐标；
- 数据库完整备份内容。

## 11. Gate定义

### 11.1 Gate 2：P0实现审批

只有以下全部满足才可签发：

- [ ] 当前P0变更已经提交并推送正式仓库；
- [ ] 基础CI、Runtime CI、恢复演练来自同一Git SHA；
- [ ] 测试失败、错误和跳过均为0；
- [ ] 四角色真实Keycloak权限矩阵通过；
- [ ] 刷新、注销和Token重放拒绝通过；
- [ ] 两次reconcile和bootstrap幂等通过；
- [ ] PostgreSQL V1～V18、持久化和失败迁移通过；
- [ ] 应用数据库账号DDL被拒绝；
- [ ] Caddy安全边界全部通过；
- [ ] Agent凭据签发、轮换、吊销和模拟命令通过；
- [ ] 逻辑恢复和WAL恢复达到RPO/RTO；
- [ ] Gitleaks、Trivy、依赖扫描和SBOM无阻断项；
- [ ] 证据包无Secret；
- [ ] 测试、安全、Backend和DevOps负责人签字；
- [ ] 无未解释P0缺陷。

Gate 2通过后仍不得宣称R1或公网生产。

### 11.2 Gate 3：R1试点审批

- [ ] 两站点三端隔离通过；
- [ ] 天气主源、缓存、质量、阈值和隐私通过；
- [ ] QWeather未审批时明确使用缓存降级；
- [ ] 基础Prometheus、日志、审计和告警通过；
- [ ] Android签名Release生成；
- [ ] 同签名Release覆盖安装通过；
- [ ] Android定位、BLE、网络和前后台真机矩阵通过；
- [ ] nRF52840真实验收通过；
- [ ] Shelly Plus Plug S Gen2真实验收通过；
- [ ] 生产域名和ACME验证通过；
- [ ] 部署、恢复、密钥轮换和用户文档完成；
- [ ] 产品、测试和安全负责人签字；
- [ ] 无未解释P0缺陷。

Gate 3通过后只批准单组织、多站点、受控网络R1试点。

### 11.3 Gate 4：R2生产审批

R2至少追加：

- Redis Streams、Pub/Sub和分布式锁；
- 两个以上Backend实例；
- Agent mTLS和证书吊销；
- 1000设备和24小时稳定性；
- OWASP ZAP认证态扫描；
- 完整Trivy/Gitleaks/依赖和许可证策略；
- PostgreSQL、Redis、网络和Backend故障注入；
- 滚动升级与回滚；
- 完整离线、权限引导和客户端数据迁移；
- 生产运行手册和轮值告警；
- Gate 1范围变更批准的功能包。

## 12. 部署、升级与回滚

### 12.1 部署

- 镜像使用不可变版本或digest，不使用latest；
- 部署前校验Secret文件权限；
- 先启动PostgreSQL和Keycloak；
- reconcile和OWNER引导成功后启动Backend；
- Backend健康后启动Caddy；
- 发布前执行数据库兼容检查；
- 发布后执行API、WSS、天气和命令冒烟。

### 12.2 Backend回滚

- 保留前一个健康镜像digest；
- 数据库变更必须满足N-1 Backend兼容窗口；
- 回滚只切换镜像，不自动回滚Flyway；
- 如果新Schema不兼容旧镜像，禁止应用回滚，必须执行经批准的数据恢复。

### 12.3 Keycloak回滚

- 变更前导出Realm配置；
- Realm变更保持向后兼容；
- Client Redirect URI缩减前先确认旧版本不再使用；
- 密钥轮换保留可控重叠窗口；
- bootstrap管理员密码在引导后轮换或禁用。

### 12.4 Android回滚

- Android正常分发不能直接安装较低versionCode；
- 如需回滚，使用旧代码重新构建更高versionCode且保持同一签名；
- 服务端API至少保持一个客户端版本兼容期；
- 回滚包同样必须通过签名、HTTPS和冒烟检查。

### 12.5 数据恢复

- 生产恢复必须双人确认；
- 恢复目标必须与源隔离；
- 不允许直接覆盖当前运行Volume；
- 恢复前保存当前证据和时间点；
- 恢复后先只读验证，再开放写入；
- 恢复结果纳入审计。

## 13. 风险与控制

| 风险 | 级别 | 控制 |
|---|---|---|
| 未提交变更丢失或远端不一致 | 高 | 先完成S0并从空目录复验 |
| V19迁移冲突 | 高 | 保留H2 V19，通用从V20开始 |
| CI跳过产生假阳性 | 高 | strict模式和机器可读计数 |
| 四角色配置偏差 | 高 | 真实Keycloak矩阵 |
| WAL存在但不可恢复 | 高 | 受保护PITR演练 |
| Android签名不可持续 | 高 | 受保护Keystore和同签名升级 |
| 天气上游刷新风暴 | 中 | 固定预算、缓存和一次重试 |
| 坐标泄漏 | 高 | HMAC、日志脱敏、删除测试 |
| 前端复制逻辑漂移 | 中 | 先补E2E，再抽公共模块 |
| 指标存在但无人告警 | 中 | Prometheus采集和触发恢复测试 |
| 真实设备造成电气风险 | 高 | 板载LED或低压负载、隔离网络 |
| 功能范围再次膨胀 | 高 | Gate 3前禁止R1.1/R2功能 |

## 14. 工作量与排期

当前代码基础上的R1收敛估算：

| 阶段 | 工作量 | 主要角色 |
|---|---:|---|
| S0 仓库、迁移、工具链 | 2～3人日 | DevOps、Backend |
| S1 CI、strict、安全扫描 | 3～4人日 | DevOps、测试、安全 |
| S2 认证、数据库、恢复、网络 | 5～7人日 | Backend、DBA、DevOps、测试 |
| S3 天气、多站点、可观测性、Web E2E | 4～5人日 | Backend、Web、测试、DevOps |
| S4 Android和真实设备 | 3～4人日 | 移动端、Edge、测试 |
| 文档、证据和审批 | 1～2人日 | 全体 |
| 合计 | 18～25人日 | 见上 |

Backend、移动/Web、测试/DevOps三条线并行时，预计8～12个工作日。不包含：

- 真实硬件采购等待；
- 正式域名和证书审批；
- 对象存储开通；
- QWeather供应商审批；
- 人员签字等待。

R2平台硬化另估25～40人日，必须在Gate 3之后单独审批。

## 15. Definition of Ready

每个任务进入开发前必须具备：

- 已确认任务ID和目标Gate；
- 负责人和评审人；
- 明确输入、输出和依赖；
- API或迁移影响；
- 测试用例；
- Secret需求；
- 部署影响；
- 回滚方案；
- 不扩大范围的确认。

缺少上述任一项时，任务不得进入开发中。

## 16. Definition of Done

单个任务只有同时满足以下条件才可完成：

- 代码和配置已提交；
- 无未解释的失败、错误或Gate模式跳过；
- 单元、集成和必要E2E通过；
- 数据迁移编号和checksum正确；
- 安全与隐私检查通过；
- 文档更新；
- 部署和回滚影响记录；
- 证据可追溯到Git SHA；
- 负责人和评审人签字；
- 没有把后续范围伪报为完成。

## 17. 交付物

R1最终交付物固定包括：

1. 干净且已推送的正式仓库；
2. 唯一基础CI、Runtime CI和恢复演练工作流；
3. 四角色Keycloak配置和测试；
4. PostgreSQL生产迁移与恢复报告；
5. Caddy安全边界报告；
6. 天气可靠性、隐私和边界报告；
7. 两站点三端隔离报告；
8. Prometheus指标和告警规则；
9. 签名Release APK、AAB和校验和；
10. nRF52840与Shelly真实设备报告；
11. 部署、升级、回滚、恢复和密钥轮换手册；
12. Gate 2和Gate 3证据包；
13. 产品、测试、安全、Backend和DevOps审批记录。

## 18. 最终实施结论

本文覆盖当前项目从本地可运行MVP收敛到R1受控试点所需的仓库、工具链、身份、权限、
数据库、恢复、网络、天气、多站点、移动端、真实设备、可观测性、测试、证据和回滚工作。

完成本文全部Gate 2和Gate 3条目后，项目可以申请：

> 单组织、多站点、受控网络、可审计、可恢复的R1物联网运维试点。

本文不批准公网生产、多租户、大规模设备或R1.1/R2/R3功能。Redis、mTLS、压测、ZAP、
工单、报表、二维码、OTA和协议扩展必须按审批意见在后续Gate中单独实施。
