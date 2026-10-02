# 客户端启动动画视觉提案：图标轻启

> 状态：已按此稿接入客户端；Android SDK、APK 构建与模拟器运行已可用，真机启动画面待验收  
> 设计依据：[此前的图标启动方案](CLIENT-STARTUP-ANIMATION-DESIGN.md)  
> 动效预览：[独立 HTML](../artifacts/startup-icon-animation-concept/preview.html)  
> 静态分镜：[PNG](../artifacts/startup-icon-animation-concept/storyboard.png) · [HTML 原稿](../artifacts/startup-icon-animation-concept/storyboard.html)

## 设计决定

当前素材使用 Android 安装图标 `client/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`。该图标目前是蓝色 Capacitor 默认图案，与 Web favicon 不同。本提案忠实使用现有安装图标，不改动图案本身；后续替换图标时只调整素材与视觉尺寸。

画面以 `#f3f6f7` 为底色，图标居中。原生启动画面保持静态；进入 WebView 后，图标整体轻微放大、回到原尺寸，背后的浅蓝光晕扩散并消失。画面不加入标题、百分比或设备连接结果文案。

## 关键帧

| 时间 | 图标 | 光晕 | 界面 |
| --- | --- | --- | --- |
| 0 ms | 原尺寸、完整可见 | 不可见 | 与原生启动页衔接 |
| 180 ms | 放大至 104% | 扩散至约 155%，柔和可见 | 首屏在后台继续绘制 |
| 420 ms | 回到 100% | 扩散至约 185% 并消失 | 若未就绪，保持静态图标 |
| 首屏就绪 | 停止当前动画 | 立即停止 | 启动层约 150 ms 淡出，并立即释放底层交互 |

插值建议采用 `cubic-bezier(0.2, 0, 0, 1)`。图标在整段中保持可辨认，光晕使用低透明度且不遮盖图案。动效播放一次，不循环。

## 运行约束

1. **就绪优先**：420 ms 是完整概念分镜，不是必须等待的启动时长。若应用壳层更早就绪，立即转入退场；不得为了播放完整动效延迟操作。
2. **慢启动**：420 ms 后保持静态图标，必要时显示现有“正在准备设备运营界面…”状态；不让图标反复呼吸。
3. **减少动态效果**：只显示静态图标，首屏就绪后直接移除启动层。
4. **图标替换**：动画只作用于承载图标的容器。新的图标应由统一源生成 Android 和 Web 预览资源，并重新检查透明边距、系统遮罩及视觉中心；无需改关键帧和就绪逻辑。
5. **分镜边界**：第四帧中的设备界面是示意线框，不代表客户端现有 UI 的精确截图。

## 审看结果

分镜已用当前安装图标生成，并在 1600 × 1128 的静态图中检查了图标、光晕、退场示意和文字布局。独立 HTML 预览可重播常规、提前就绪和慢启动场景，也可模拟减少动态效果；已检查按钮状态与浏览器脚本错误。没有生成视频文件。

## 开发落点与验证

- Android `AppTheme.NoActionBarLaunch` 使用系统 SplashScreen，背景色与 Web 启动层一致，图标引用现有 launcher 前景资源；`MainActivity` 在 `super.onCreate` 前安装 SplashScreen。
- `client/index.html` 用内联关键样式显示现有安装图标，避免 Web CSS 和 JS 尚未加载时出现空白；`client/src/js/platform/startup-transition.js` 在首屏壳层绘制后退场，不等待接口或动效播完。
- 模块加载超过 420 ms 显示等待文案；4 秒仍未启动时提供重新加载。减少动态效果设置下显示静态图标并直接退场。
- Web 构建、168 项单元测试、3 项启动浏览器测试及现有移动端浏览器主流程测试已通过。Android Gradle 已用 JDK 21 运行，但本机 Android SDK 路径不可用，APK 编译与真机过渡效果仍待验收。

### 2026-10-01 更新验证

上述 SDK 不可用为此前记录。现已使用 D 盘 SDK、Platform 36 和 JDK 23 构建 Debug 1.1.1；同日重新运行 194 项客户端单元测试及包含 3 项启动用例的 11 项浏览器回归，全部通过。更新包已在 Android 16 模拟器覆盖安装并完成 11 项原生模拟验收。真机原生 SplashScreen 与 Web 启动层衔接的视觉效果仍需实体设备复核；详见[App 更新报告](CLIENT-AI-MOTION-UPDATE-2026-10-01.md)。
