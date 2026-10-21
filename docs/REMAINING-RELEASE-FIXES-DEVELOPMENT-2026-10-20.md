# 剩余发布整改开发与迁移说明

本轮基于前次整改的 110 条 HIGH/CRITICAL 镜像条目继续修复。此文说明实现约束与验收方法，测试结果另见本轮验收报告；模拟结果不代表生产审批。

## 1. 技术选择与方案审核

| 范围 | 实现 | 审核约束 |
| --- | --- | --- |
| 后端 | Spring Boot 4.0.8 / Framework 7.0.9 / Java 17 | 使用公开修复版本；同步迁移模块、测试包名及 JSON，不混装 Spring 6/7 |
| 数据映射 | Jackson 3.1.8 / SDK Jackson 2.21.8，兼容外部序列化默认行为 | Jackson 注解保留官方包名；外部 API 时间、字段和错误结构必须回归 |
| AI | Spring AI 2.0.1 / OpenAI Java SDK | 沿用 IOT_AI 配置；选项改为平铺结构；禁用 SDK 重试，连接 5 秒、请求/读取 30 秒；保持 HTTPS 白名单和错误脱敏 |
| 数据库 | PostgreSQL 16 / pgvector 0.8.6，Alpine 3.24 musl | 保持主版本和 UID/GID 999；只向新集群写 ABI 标记；旧 glibc/未知数据卷必须拒绝启动 |
| 逻辑备份 | PG16 官方客户端及匹配 musl 的动态库 | 不复制整个旧系统；实际执行 dump/restore 验证依赖与数据完整性 |
| WAL-G | 固定 v3.0.9 源提交及 Go 1.26.10 | 保留 FILE/S3；验证真实修复祖先、校验和和 Go 原生模块元数据，不伪造版本或包名 |
| 仓库 | 默认分支强制 quick-gate、独立 PR 审批、管理员遵守保护、禁强推/删除 | 环境独立审批和专用恢复 runner 单独核实，不用模拟改写治理结论 |

Spring 6.2.19 的阻断涉及 CVE-2026-47884、CVE-2026-47890、CVE-2026-47892；公开分支的修复版本是 Framework 7.0.9。选择 Boot 4.0.8 管理的整套依赖，避免只替换单个 Spring JAR。参考 [Spring 安全公告](https://spring.io/security/cve-2026-47890/)、[Boot 4 迁移指南](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)、[Spring AI 升级说明](https://docs.spring.io/spring-ai/reference/upgrade-notes.html)。

WAL-G 源码模块路径没有 /v3；构建取真实 v1 标签及其祖先，允许 Go 生成兼容该模块路径的规范版本。应用显示版本和源提交保持真实 v3.0.9，不用 ldflags 覆盖模块版本。libsodium 不受支持时必须拒绝配置，不能静默明文写入。

v3.0.9 使用 encoding/json/v2，构建沿用[上游 Makefile](https://github.com/wal-g/wal-g/blob/3e493188db28335fb93a45bd680c6ff8fc3028c1/Makefile)的 GOEXPERIMENT=jsonv2；实际备份与 PITR 演练必须覆盖新二进制的元数据读写。

pgvector 只部署正常编译的原生 vector.so 与扩展 SQL；构建显式 with_llvm=no，避免供应镜像使用 LLVM 21、Alpine 默认开发包 LLVM 22 的 bitcode 工具链混用。PostgreSQL 自身已有的 JIT 配置不在本次变更范围。

方案审核结论：可进入隔离开发与模拟验收；数据库 libc 改变必须执行下述迁移，不能直接把旧卷挂到新镜像，也不能仅靠风险豁免跳过漏洞扫描。

2026-10-21 实际镜像扫描补充：Boot 4.0.8 默认的 Tomcat 11.0.24、Jackson 3.1.5 和 SDK Jackson 2.21.5 仍有条目，因此覆盖完整 BOM 为 Jackson 3.1.8 / 2.21.8，Tomcat 全组件统一 11.0.27。Caddy、Alertmanager 固定 klauspost/compress 1.18.7。参考 [Tomcat 安全公告](https://tomcat.apache.org/security-11.html)、[Jackson 3.1.7 修复说明](https://github.com/FasterXML/jackson/wiki/Jackson-Release-3.1.7)、[compress 1.18.7](https://github.com/klauspost/compress/releases/tag/v1.18.7)。覆盖补丁后必须重新扫描同源八镜像并执行运行回归，不能沿用修改前的安全结论。

## 2. 旧 PG16 数据的迁移边界

1. 保留已验证的旧 glibc 镜像 digest、旧数据卷、完整物理备份和旧恢复配置。旧物理备份只能用匹配的旧运行时恢复。
2. 盘点扩展版本、数据库编码、排序规则、角色和授权。不同 libc 的 locale 名称/排序结果可能不同；正式迁移需确认目标 locale，不能把合成数据测试当成所有业务排序规则的证明。
3. 在独立环境以固定 digest 启动新的 musl 空卷，使用正常入口初始化。只有初始化钩子可以生成 pg16-musl-alpine3.24-v1 标记。
4. 使用受保护凭据做逻辑导出。正式切换前暂停写入并再次导出/恢复；恢复到明确创建的目标数据库，重新建立扩展和索引，并按最小权限部署角色授权。演练里的 --no-owner --no-acl 仅适用于合成数据，不是完整生产授权迁移命令。
5. 核对表/行数、业务指纹、外键与索引有效性、向量检索、UTC 时间、角色权限和应用读写；保留校验结果与 dump 哈希。
6. 使用新集群建立新的 WAL-G 全量备份与 WAL 链，再做一次从该链恢复的演练。旧/新物理备份存储前缀必须区分。
7. 在业务写入目标后，回滚到旧数据库需要另行协调数据同步；不能把保留旧卷称为无损回滚。后端 N→N-1→N 测试也不能代替跨 libc 的数据库回退。

入口对旧卷返回 78，并且不写 ABI 标记。禁止手工给旧卷补标记来绕过检查；即使 PostgreSQL 主版本都是 16，也不把物理目录兼容性视为已证明。

2026-10-21 的第二次演练发现旧 glibc 镜像的 pgvector 使用默认 -march=native，在部分 runner 上加载扩展触发 SIGILL。新发布镜像已使用 OPTFLAGS=""。旧环境模拟采用单独的实验夹具：固定旧镜像 digest，仅以同一 pgvector 0.8.6 源提交重新编译通用指令集版本，保留旧 glibc/PG16。报告记录夹具实际镜像 ID、Dockerfile 哈希和 runner CPU；这不是未修改历史镜像的通过证明。若既有运行环境有此故障，先在隔离恢复环境使用匹配 libc/PG 主版本的可移植扩展完成逻辑导出，再按迁移步骤验收，不修改原始生产卷。

## 3. 开发与验收项目

- 后端：完整 Java 测试在 UTC 与 Asia/Shanghai 执行，Docker 环境中的 PostgreSQL Testcontainers 项目必须真正运行，不能把跳过计为通过。
- AI：真实 SDK 连接本地/内部 HTTPS 合成服务；检查模型、路径、角色、错误脱敏、429/503、请求超时与单次调用。禁止使用真实供应商凭据或外部模型。
- 迁移：固定旧 R04、新 R04/R07 digest，在本次运行的临时卷内建 300 条 Unicode、JSON、时间及向量数据，实际 dump/restore；验证旧卷拒绝、控制文件哈希未变、新卷标记、扩展、写入与重启。
- 镜像：同一 source SHA 构建八个镜像，扫描实际 digest；扫描器异常、未知系统、过期数据库和高危条目保持阻断，不修改原始报告冒充通过。
- 恢复：同一候选运行全部服务、64 MiB 合成数据清除后 PITR、备份篡改拒绝、WAL-G 加密拒绝和告警生命周期；保留源 SHA、manifest 哈希、镜像 digest 与清理证据。
- 应用边界：重跑四角色授权、AI 展示、负载、数据库中断恢复和后端 N→N-1→N；硬件相关测试按用户要求使用模拟器/故障注入，明确标为模拟。
- 治理：读取 GitHub 生效配置。独立审核人尚未提供时保留未满足项；不制造审批记录，不自动合并、打正式 tag 或部署。

开发文档自审：依赖由 BOM 对齐；新旧卷分离；现有迁移文件校验和不变；测试固定源和 digest；清理只作用于本次标签的资源；审批与模拟结论分开。按此约束实施，实际结果以验收报告和 CI 原始证据为准。
