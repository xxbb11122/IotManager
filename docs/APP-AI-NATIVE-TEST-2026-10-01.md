# App AI 原生测试与复现

日期：2026-10-01。对应[开发与验收记录](APP-AI-IMPLEMENTATION-2026-10-01.md)中的 Android Debug 1.1.1 / versionCode 3，包含同日底栏动效更新。

## 1. 实际完成的验证

现有 IotManagerApi36 模拟器已启动，系统为 Android 16。前轮核对原安装包 1.0.0 的证书并升级至 1.1.0；本次同签名覆盖升级至 1.1.1。原生测试读取已安装 APK 的 SHA-256，与[交付构建清单](../artifacts/release/app-ai-motion-20261001/build-manifest.json)进行比对。

| 验证 | 实际结果 |
| --- | --- |
| 版本及原生运行环境 | applicationId、versionName、versionCode 与交付包一致；Capacitor 原生运行。 |
| 底栏动效 | 四个入口选中底板几何位置正确；快速切换保留导航节点；AI 子页继续高亮 AI，媒体模拟减少动态效果后直接定位；没有触发 Chat POST。 |
| 原生问答与文本安全 | 经 CapacitorHttp 提交一条问题，得到 USER / ASSISTANT 消息对；恶意 HTML 按文字展示；单次提交仅一个 POST。 |
| 软键盘 | 输入区打开系统键盘，第一次系统返回收起键盘，仍保留聊天页。 |
| 历史及返回栈 | 读取会话历史；键盘收起后，系统返回从历史回到聊天。 |
| 性格 | 保存完整 4000 字符，含尾部标记；通过独立 expectedActiveVersion 启用。 |
| 本地恢复元数据 | 原生 Preferences 只记录请求编号、会话编号及时间戳。 |
| 后台 | 系统 HOME 后暂停结果轮询。 |
| 进程重启 | 强制停止测试 App、重新启动后取回服务端模拟结果；两次问题合计两个 POST，恢复没有新增 POST。 |
| 横屏与安全区 | 聊天保留、无横向溢出；标题栏点击区域位于系统顶部安全区以下。 |
| 原生浏览器 | Browser 插件打开独立模拟页面，系统返回回到 App。 |

证据：[11 项结果](../artifacts/release/app-ai-motion-20261001/native-ai-results.json)、[测试日志](../artifacts/release/app-ai-motion-20261001/native-ai-smoke.log)、[模拟器冷启动](../artifacts/release/app-ai-motion-20261001/emulator-start.log)。截图：[底栏](../artifacts/release/app-ai-motion-20261001/native-ai-bottom-navigation.png)、[聊天](../artifacts/release/app-ai-motion-20261001/native-ai-chat.png)、[键盘](../artifacts/release/app-ai-motion-20261001/native-ai-keyboard.png)、[恢复](../artifacts/release/app-ai-motion-20261001/native-ai-recovered.png)、[横屏](../artifacts/release/app-ai-motion-20261001/native-ai-landscape.png)。

模拟接口运行于本机，供应商和 Embedding 调用均为零。浏览器测试未进行身份认证。

本次底栏快速切换通过实际安装包 WebView 内的连续 DOM 点击触发，减少动态效果通过媒体设置模拟；Android 系统设置与实体设备触感仍待验收。原生测试脚本从源码版本或 IOT_RELEASE_VERSION_NAME / IOT_RELEASE_VERSION_CODE 获取预期版本。

## 2. 本轮修复

1. 启动时用户先打开 AI、随后取得授权站点时，自动加载当前页面、性格及待恢复结果；新建会话使尚未完成的恢复记录读取失效。对应四项新增控制器回归，客户端合计 194 项通过。
2. 宽屏样式保留顶部安全区内边距，避免 Android 横屏状态栏影响标题和点击区域。AI 浏览器测试增加宽屏安全区用例，合计 6 项通过。
3. 模拟器使用英文 SDK 路径别名和独立临时目录，并采用 WHPX、SwiftShader 和关闭 Vulkan 的启动组合。已用新脚本冷启动验证。命令参考[Android 模拟器命令行](https://developer.android.com/studio/run/emulator-commandline)和[官方故障排查](https://developer.android.com/studio/run/emulator-troubleshooting)。

SDK 实体仍位于 D 盘。别名及测试日志位于忽略提交的 artifacts/android-test-runtime；没有重置现有 AVD 数据。

## 3. 复现命令

在项目根目录启动现有模拟器：

```powershell
pwsh -NoProfile -File scripts/start-android-test-emulator.ps1 -SdkPath 'D:/电脑管家迁移文件/C盘迁移/AppData/Local/Android/Sdk'
```

连接 emulator-5554 后安装交付包：

```powershell
$testAdb = 'E:/CC_testP/iot-manager/artifacts/android-test-runtime/sdk/platform-tools/adb.exe'
& $testAdb -s emulator-5554 install -r 'E:/CC_testP/iot-manager/artifacts/release/app-ai-motion-20261001/iot-manager-ai-1.1.1-debug.apk'
```

在 client 目录执行：

```powershell
$env:IOT_ANDROID_ADB = 'E:/CC_testP/iot-manager/artifacts/android-test-runtime/sdk/platform-tools/adb.exe'
npm.cmd run android:ai:smoke
```

脚本仅接受模拟器序列号，要求已安装并启动过一次目标 Debug App。测试使用主机 127.0.0.1:8080 和 ADB 转发的设备 127.0.0.1:18891；端口冲突会终止测试。独立端口可避免既有 10.0.2.2 地址迁移覆盖测试配置。

测试前停止测试 App，将原 Preferences 暂存内存后配置模拟地址；结束时恢复 Preferences、屏幕方向、网络状态及测试端口。浏览器使用 Chromium 的临时首次启动测试参数，随后恢复参数与调试设置，参照[Chromium Android 调试说明](https://github.com/chromium/chromium/blob/main/docs/android_debugging_instructions.md)和[命令行初始化实现](https://chromium.googlesource.com/chromium/src/+/main/base/android/java/src/org/chromium/base/CommandLineInitUtil.java)。没有登录浏览器账号或调整证书信任设置。

脚本与模拟服务器位于 client/scripts，参与开发验收；App 构建入口仍为 client/src/main.js。

## 4. 正式验收的剩余条件

- 手机可访问且证书受信任的 HTTPS API、WebSocket 和 OIDC 地址；公开客户端 iot-mobile 与原生回调正确注册。
- 一台测试真机，用最终包执行安装、权限、软键盘、网络切换及进程恢复验收。
- 完整 PKCE 登录的热 / 冷启动、取消、失败与回调关闭竞争，以及实际证书、原生 HTTP 超时和中断测试。
- 新 APK 通过项目服务器执行少量真实 DeepSeek 通用问答，核对用量、审计及零 Embedding 调用。
- 受保护的正式发布签名及旧包证书核对，构建正式 APK / AAB。

当前交付为可安装的 Debug 包及已验证的模拟功能。以上条件补齐后执行正式联调与发布验收。
