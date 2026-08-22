# 部署入口 / Deployment entry point

请使用 [DEPLOYMENT.md](DEPLOYMENT.md) 作为唯一的 R1 部署运行手册。

Use [DEPLOYMENT.md](DEPLOYMENT.md) as the sole R1 deployment runbook.

旧的“仅设置 `DOMAIN` 即可启动演示栈”说明已废弃：R1 必须配置
PostgreSQL、Keycloak、初始 OWNER 映射、天气指纹密钥、HTTPS/WSS 和备份恢复
门禁。不要将开发 Profile、H2 或无认证 API 暴露到公网。
