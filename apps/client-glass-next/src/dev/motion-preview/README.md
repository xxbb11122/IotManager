# 开发态合成动效预览

在 `client/` 执行 `npm run dev -- --host 127.0.0.1`，打开 `http://127.0.0.1:5175/__motion/`。

该入口由 Vite 的 serve-only 中间件提供，不是生产路由，也没有加入生产构建输入。它通过独立 iframe 装载真实 `ClientUi` 和同一份 App CSS，不导入 `src/main.js`、后台/认证/存储或原生适配器。CSP 禁止连接，Permissions-Policy 拒绝定位和蓝牙等能力；iframe 内另有传输 API 拒绝保护。

## 使用

- 选择 42 个 G/P/C 场景之一，再选择其适用状态。当前共有 144 个合成状态变体。
- “重放主要交互”点击相应真实 UI 控件；没有自动操作的静态/平台交接状态会明确提示。也可直接点击 App 内控件。
- 调整合成延迟与结果，再发起新任务。命令未知不会 ACK 或自动重发；部分成功仅供非命令流程查看。
- “重置当前场景”取消假适配器计时器、销毁旧 UI 并替换 DOM 根节点；旧回调不能改写新场景。不访问或清除真实本地存储。
- “减少动态效果”走 ClientUi 的运行中降级接口，同时停用 iframe 动画和过渡；不清除表达最终开关位置的 transform。“正常”仍尊重操作系统的减少动态设置。
- 320/390/768/1280 预设控制 iframe 的内容宽度；外层工作台可横向查看较宽布局。这是浏览器 CSS 视口，不等同于 PDA 型号或原生 dp。

## 调试 API

外层 `window.__motionPreview` 提供：

```js
__motionPreview.select('P04', 'ready');
__motionPreview.configure({ delayMs: 800, outcome: 'unconfirmed', motion: 'reduce' });
__motionPreview.run();
__motionPreview.snapshot(); // 当前合成模型、意图记录、待完成计时器、被阻止的外部操作
__motionPreview.reset();
```

`outcome` 为 `success`、`failed`、`unconfirmed` 或 `partial`；`delayMs` 限制为 0–10000；`motion` 为 `normal` 或 `reduce`。更新策略不改变已开始任务捕获的延迟与结果。iframe 内对应 API 为 `window.__motionFixture`。

## 自动检查

```powershell
$env:IOT_RUNTIME_BASE_URL = ''
$env:IOT_PLAYWRIGHT_OUTPUT_DIR = 'test-results/motion-preview-local'
npm run test:e2e -- e2e/motion-preview.spec.js --workers=1
npm run build
node src/dev/motion-preview/check-production.mjs
```

浏览器检查覆盖清单、全部变体可渲染、9 页四种视口、无真实入口/传输、ACK/未知语义、重置、最终开关状态和部分代表性状态。不要将“42 个 ID/144 个变体可打开”写为 42 个完整业务流程通过。真实账号、后台、OAuth 回调、Android 返回、原生权限、BLE 设备、读屏和 PDA 性能依然按开发验收工作表单独验证。
