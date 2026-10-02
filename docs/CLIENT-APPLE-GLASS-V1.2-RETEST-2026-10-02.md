# Client Apple 轻毛玻璃 v1.2 方案完善与复测

日期：2026-10-02。对象：[v1.2 开发方案](E:/CC_testP/iot-manager/docs/CLIENT-APPLE-GLASS-DEVELOPMENT-DOCUMENT-2026-10-01.md)。

**结论：上轮 1 项 P1、2 项 P2 在方案及隔离原型层面通过针对性验证，可以进入 App 实施。27 项隔离验证、33 项相关现有单元回归均通过。** 本次没有把示例合并到生产源码，不构成 App 修复完成、全量回归或原生发布验收。

## 1. 本版补齐的实现

| 复审问题 | 完善内容 | 接入位置 |
| --- | --- | --- |
| 多指取消仍会提交 | 保存设备/能力/范围/上下文快照；取消时废弃并移除旧 input，按当前模型重建；迟到事件不再提交 | UI 的 pointer、input/change、整页/局部模型更新、控制区 patch、路由和销毁入口 |
| 无效范围及显示不一致 | 新增纯范围契约；原始非法定义保留错误标记；无效或未知值禁用并显示原因；显示与提交统一原生 value | range-contract.js、normalizeCapability、range 构建与提交 |
| 强制颜色中轨道消失 | 使用系统颜色、实线轨道边界、焦点轮廓和禁用颜色 | range 的 Chromium / Firefox 伪元素样式 |

方案继续沿用现有能力模型、DOM 协调器和事件委托，不增加滑块实例的全局监听器。普通拖动与正常设备上报保留当前节点；取消后的新节点可用键盘重新操作。待确认使旧意图失效，ACK 后沿用原焦点恢复机制。UI 门禁不能替代 main.js 和 adapter 的鉴权、路由与幂等保护。

## 2. 测试方法与结果

隔离页面导入实际生产模块，按文档的挂载表在浏览器响应中临时接入示例。原始源码在磁盘上保持不变，sendCommand 使用内存记录，AI API 使用内存 fixture。各插入位置均校验生产源码锚点，缺失或重复时失败。

先复现原行为作为对照：原 UI 在第二指介入后仍产生一次 `set_level(82)` 回调；倒置范围 `min=20,max=10,reported=30` 时，input=20、output=30、disabled=false。接入 v1.2 后再运行正向与取消测试，未将对照失败计为方案通过项。

| 检查 | 结果 |
| --- | --- |
| 7 段 JavaScript、3 段 CSS 解析 | 通过 |
| 原生多指、touchCancel、取消后迟到 change | 通过；取消回调为 0，旧节点已废弃 |
| 正常拖动与 input/提交分离 | 通过；input 不提交，释放后一次回调，不修改真实上报状态 |
| 取消后键盘操作、无指针 change 入口 | 通过；新意图可提交。无指针模拟只覆盖接口语义，不能代替 TalkBack 真机测试 |
| 站点、实际设备切换、缓存只读、SENT、范围变化和销毁 | 通过；旧意图不能提交 |
| 待确认后的 ACK 焦点恢复 | 通过 |
| 普通上报更新中继续拖动 | 通过；节点及预览保留，最终只提交一次 |
| 倒置、相等、零/负步长、Infinity 字符串和非数字上限 | 通过；归一化后仍禁用、显示原因且无命令 |
| 负数小数范围、步长不整除上限、0.000001 步长 | 通过；input/output/读屏一致 |
| 强制颜色中的轨道、焦点及禁用样式 | 规则检查及截图人工复核通过 |
| AI 真实控制器草稿桥接、重复 patch、聚焦节点与稳定预设 | 通过；输入、草稿、字符计数一致，忙碌及未知 ID 拒绝填写 |
| 页面运行错误 | 0 |

上述合计 **27 项通过、0 失败**，包括一项片段语法检查与一项页面运行错误检查；不是 27 个 App 端到端用例。结果与实际执行时的文档、源码、临时模块 SHA-256 保存在[原型测试结果](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/results.json)。[受测文档快照](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/design-v1.2-tested.md)保存测试前正文；最终版本只追加结果与完善验收文字，可执行片段另以摘要比对。

现有的 device-capabilities、command-state、task-state、motion-policy 与 ai-controller 五个测试文件共 **33 项通过、0 失败、0 跳过，退出码 0**。[单元回归记录](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/existing-regression.json)。这些用例验证现有模块，没有把隔离原型的结果冒充生产源码已实现。

## 3. 视觉证据

强制颜色模式下已恢复可见轨道和焦点轮廓：

![强制颜色模式下的可见轨道与焦点](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/range-forced-colors-focus.png)

禁用状态保留轨道及系统颜色：

![强制颜色模式下的禁用滑块](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/range-forced-colors-disabled.png)

截图为 390×844 CSS px 的 Chromium 模拟结果，仅覆盖本次控制区样例，不代表完整 App 或全部引擎的视觉验收。

## 4. 复现命令

在仓库根目录的一个终端启动测试用 Vite：

```powershell
node client/node_modules/vite/bin/vite.js --config client/vite.config.js client --host 127.0.0.1 --port 5187 --strictPort
```

或在 client 目录执行：

```powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5187 --strictPort
```

在另一个终端、仓库根目录运行[原型复测脚本](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/retest.mjs)：

```powershell
node --experimental-vm-modules artifacts/client-apple-glass-review/2026-10-02/v1.2/retest.mjs
```

已启动其他测试地址时可通过 IOT_GLASS_PROBE_BASE_URL 指定。脚本从当前开发文档提取片段，输出新的结果记录和截图；测试依赖随实际工作树版本变化，源码锚点不匹配时应检查并更新接入位置。

本次相关单元回归在 client 目录执行：

```powershell
node --test --test-timeout=15000 test/device-capabilities.test.js test/command-state.test.js test/task-state.test.js test/motion-policy.test.js test/ai-controller.test.js
```

## 5. 尚待完成的验收

正式 App 需合并方案中的范围契约、归一化标记、range 构建器、全部门禁入口及样式，再执行完整客户端回归与构建。还需验证顶栏/卡片的全部断点、200% 字体、四方向安全区、键盘和 TalkBack，以及目标 Android/WebView/PDA 的多指事件顺序、滤镜性能、前后台和内存。

原生产模块中仍能复现对照行为，因此本次状态为“方案已完善并通过原型复测”；第 8 节发布门禁继续适用，不能标记为 App 已修复或真机已通过。
