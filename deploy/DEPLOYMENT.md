# 首版云端部署

本部署将同一个 Git 提交中的三个交付面一起发布：Spring Boot 平台、监控
界面和企业运维控制台。Caddy 负责 HTTPS/WSS 终止、静态文件服务和平台反向
代理；后端 `8080` 不直接暴露到公网。

## 访问地址

假设 `DOMAIN=iot.example.com`：

| 用途 | 地址 |
| --- | --- |
| 监控界面 | `https://iot.example.com/` |
| 运维控制台 | `https://iot.example.com/console/` |
| REST API | `https://iot.example.com/api` |
| 移动端设备事件 | `wss://iot.example.com/ws/devices` |
| 现场 Edge Agent | `wss://iot.example.com/ws/edge/v1` |

控制台的前端资源在镜像构建时使用 `/console/` 作为 Vite base，因此它和根
目录的监控界面可以由同一个域名安全地提供静态资源。`/api` 与 `/ws` 会在
Caddy 路由的最前面交给 Spring Boot，不会被单页应用回退页面截获。

## 前置条件

- 公网 Linux 主机已安装 Docker Engine 和 Docker Compose v2。
- 域名 A/AAAA 记录已指向该主机。
- 云防火墙和主机防火墙允许入站 TCP `80` 和 `443`。
- 部署目录位于完整仓库中；Compose 的构建上下文是仓库根目录，不能只复制
  `deploy/` 子目录。

## 首次启动

```bash
cd deploy
cp .env.example .env
```

编辑 `.env`，只填写域名，不要包含 `https://`、端口或路径：

```text
DOMAIN=iot.example.com
```

构建并启动：

```bash
docker compose up -d --build
docker compose ps
```

首次启动时 Caddy 会在 DNS 和端口检查通过后申请证书。查看启动日志：

```bash
docker compose logs -f caddy backend
```

## 验收

在公网主机或另一台可以访问域名的机器上执行：

```bash
curl -fsS https://iot.example.com/api/devices/stats
curl -fsSI https://iot.example.com/
curl -fsSI https://iot.example.com/console/
```

浏览器打开根路径应显示监控界面，打开 `/console/` 应显示运维控制台。移动端
连接设置填写：

```text
API:       https://iot.example.com/api
WebSocket: wss://iot.example.com/ws/devices
```

现场 Edge Agent 不在云端 Compose 中运行；它安装在设备所在 LAN，并通过
`wss://iot.example.com/ws/edge/v1` 主动连接云端。

## 更新与恢复

更新同一发布基线时，在仓库根目录更新代码后重新构建：

```bash
cd deploy
docker compose up -d --build
```

持久化数据位于 `backend-data`、`caddy-data` 和 `caddy-config` Docker 卷。
`docker compose down` 不会删除这些卷；只有显式执行 `docker compose down -v`
才会删除它们。

## 当前边界

这是首版功能部署，而非生产安全基线。当前后端仍使用演示 H2 数据库，并且
登录、RBAC、组织授权、限流、密钥管理和正式备份策略尚未完成。不要在公网
长期暴露真实业务数据；进入正式生产前应先完成安全和 PostgreSQL 迁移里程碑。
