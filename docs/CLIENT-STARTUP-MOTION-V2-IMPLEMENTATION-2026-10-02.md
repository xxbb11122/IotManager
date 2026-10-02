# 启动动效 v2 开发与验证记录

## 已实现

- Android 保留应用图标的静态 SplashScreen。Activity 创建后至少停留 800ms；本地首屏绘制确认后由原生视图执行 360ms 淡出，完成事件携带 `launchId`。
- Web 覆盖层在原生淡出前只隐藏，直到收到当前 `launchId` 的完成事件才删除并解除首页 `inert`。桥接失败、事件丢失、超时均保留可重试的静态页面。
- 启动分为本地首屏与联网同步。会话令牌刷新和站点、设备、天气请求在首屏揭幕后进行；同步期间的站点内容变化不触发额外的页面切换动效。
- 浏览器刷新独立使用静态图标，目标停留 700ms、淡出 280ms；减少动态效果时跳过淡出。
- Android 失败上限由草案的 3 秒调整为 8 秒，Web 完成信号兜底为 9.5 秒。模拟器实测正常冷启动的 Web 首屏在 Activity 创建后约 3–4 秒才就绪；3 秒上限会提前切换到第二个 Web 图标。8 秒仅是异常上限，不增加正常启动的等待时间。

## 自动化与模拟器结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 204 通过 |
| Playwright 全套 | 50 通过、8 因缺少外部运行服务跳过 |
| `npm run android:debug` | 构建成功，Web 资源已同步进 APK |
| Android 16 模拟器，最终 APK 冷启动 5 次 | 5 次均收到 `COVERING → prepare_reveal → frame_ready → exit_started → exit_completed`；无超时回退 |
| 模拟器原生淡出 | 日志测得 369–381ms，目标 360ms |
| 模拟器减少动态效果 | 绘制确认后同一时刻完成退场 |
| 模拟器后台返回 | Activity 未重建，未重播启动动效 |
| 安装包核对 | `versionCode=5`，`versionName=1.1.3` |

最终 APK：[iot-manager-1.1.3-debug.apk](../artifacts/startup-motion-v2/iot-manager-1.1.3-debug.apk)。SHA-256：`1EC6B1C56280B175E4F318C542CA9A881C207B5E393684448852AC61E48B9C0F`。构建信息见 [build-manifest.json](../artifacts/startup-motion-v2/build-manifest.json)，冷启动事件见 [final-emulator-runs.log](../artifacts/startup-motion-v2/final-emulator-runs.log)。

## 尚需实机验收

本机 ADB 只有 Android 16 模拟器，没有连接用户手机或目标 PDA。模拟器日志确认交接协议和动画时长，不能证明真机上的逐帧流畅度。安装该 1.1.3 APK 后，应分别在手机与目标 PDA 上记录冷启动、温启动和后台恢复，并逐帧检查空白闪帧、图标位置跳变及淡出卡顿；版本与 APK 哈希须与本记录一致。Debug 包不能替代签名发布包。
