# IoT Manager 云端部署（移动数据可用）

手机使用移动数据时无法访问家里的 `192.168.x.x` 内网地址。要真正使用"互联网远程"，
需要把后端放到一个有公网域名/公网 IP 的服务器上。本目录提供一键部署：
Spring Boot 后端 + Caddy 反向代理（自动 HTTPS/WSS 证书）。

## 前置条件

- 一台公网云服务器（阿里云/腾讯云轻量服务器即可，2 核 2G 足够演示）
- 一个域名，DNS A 记录指向服务器 IP（如 `iot.example.com`）
- 服务器防火墙/安全组放行 80 和 443
- 服务器安装 Docker 与 Docker Compose

## 部署步骤

1. 把整个项目目录上传到服务器（或只上传本项目仓库）。
2. 在服务器项目根目录执行：

```bash
cd deploy
DOMAIN=iot.example.com docker compose up -d --build
```

3. 等待 1-2 分钟构建启动，验证：

```bash
curl https://iot.example.com/api/devices/stats
```

返回 JSON 即成功。首次启动会自动建表并写入 `demo-org / demo-site` 演示数据。

## 手机 App 配置

1. 打开 App → 连接设置 → 选择**互联网远程**
2. 填写：

```text
API 地址：       https://iot.example.com/api
WebSocket 地址： wss://iot.example.com/ws/devices
```

3. 点**测试连接** → 显示"连接成功" → **保存并切换**
4. 手机无论使用 Wi-Fi 还是移动数据都能访问（需要服务器与手机都能联网）

## 没有服务器时的临时方案

如果暂时没有云服务器，可以用隧道让手机通过移动数据访问家里的后端：

**Tailscale（推荐，免费且简单）**
1. PC 与手机安装 Tailscale，登录同一账号，两端互相可见（会分配 `100.x.y.z` 内网地址）
2. PC 上确认后端 8080 在运行
3. App 连接设置选"现场 LAN"或"互联网远程"，填入：

```text
API 地址：       http://<PC的Tailscale IP>:8080/api
WebSocket 地址： ws://<PC的Tailscale IP>:8080/ws/devices
```

4. 测试连接通过后保存切换。Tailscale 走加密隧道，移动数据可用；
   不需要公网 IP、不需要端口转发（当前 debug APK 允许明文 HTTP/WS）。

其他同类方案：cpolar、frp（配合一台有公网 IP 的服务器）、ngrok。

## 注意

- 当前后端是演示配置：无登录、无权限校验、CORS 全开、H2 控制台开启。
  公网部署后不要填入真实业务数据，也不要长期公开使用；正式使用前需要先做安全里程碑。
- Caddy 自动申请 Let's Encrypt 证书，需保证 80 端口可访问（用于签发验证）。
- 数据保存在 Docker 卷 `backend-data`（H2 文件库），`docker compose down` 不会丢数据。
