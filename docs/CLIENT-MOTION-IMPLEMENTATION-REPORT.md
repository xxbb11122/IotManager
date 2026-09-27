# IoT Manager 全 App 动效实施与自检报告

> 日期：2026-09-27。对应[开发方案 v1.1](CLIENT-MOTION-DEVELOPMENT-PLAN.md)、[全覆盖框架](CLIENT-MOTION-FULL-COVERAGE-FRAMEWORK.md)与[验收工作表](CLIENT-MOTION-PREFLIGHT-AND-ACCEPTANCE.md)。\
> 结论：客户端代码、开发态隔离预览及本轮浏览器回归已落地；**不是全 App 全平台最终验收通过**。真实后台、OIDC、BLE/PDA、读屏与性能仍有明确门禁。

## 1. 交付范围与版本归属

参考基线：`b1919022535e12d4b506628414ba4e7c9b5b5ef0`。验证对象为该基线上**动效实现提交前的工作区**，包含此前已有动效修改；不能把本报告当作该基线 SHA 的干净构建报告。本报告随动效实现一并提交，实际提交与推送记录以 Git 历史及远端为准。开发验证阶段没有执行生产发布、APK 安装、真实设备命令或清理用户工作区。原上传参考稿与无关 R1 文档未覆盖。

按要求先建立开发文档和前置基线，再实施代码并用失败用例反查边界。范围为 9 个页面、39 个点击分支、13 类字段、2 条手势流程、42 个 G/P/C 场景；39 包含新增的 A39 非手势刷新入口。自动检查比对**精确入口集合**，不只比对数量。

| 工作包 | 本轮落地 | 当前边界 |
| --- | --- | --- |
| DEV-01 | 修正决策、环境/工作区基线、42 场景工作表 | D13 记录身份/缓存兼容影响 |
| DEV-02/03 | UI 任务归属、运行时资源/请求代次、来源导航、实体/历史/滚动恢复 | Android 返回和软键盘顺序仍需真机 |
| DEV-04/05 | 动效策略、Token、稳定节点、错误/Toast/退出、取消与防重下拉 | 桌面触摸模拟不等于 PDA |
| DEV-06 | ACK 真值、未知结果、观察结束、只读与控件最终状态 | 未发送真实硬件指令 |
| DEV-07/08 | BLE 扫描与连接真实性、LAN 草稿与认领部分成功 | 原生权限/现场设备需独立验收 |
| DEV-09/10/11 | 站点/端点、字段校验、REST/WS 部分可用、天气/预报/定位、稳定列表 | 真实网络异常组合未全面运行 |
| DEV-12 | ready-first 启动、认证阶段、旧身份隔离、存储降级 | 外部身份页面与系统生命周期不由预览证明 |
| DEV-13/14 | 42 场景/144 变体预览、覆盖守卫、单元与浏览器回归 | 清单可渲染不等于所有状态转换通过 |
| DEV-15 | 浏览器视口/焦点/减少动态检查 | PDA、读屏、系统大字体、性能未完成 |
| DEV-16 | 本报告、证据索引、升级与回退说明 | 没有交付 APK 或生产发布证明 |

## 2. 实现位置与关键约束

| 文件 | 职责及实际行为 |
| --- | --- |
| [ui.js](../client/src/js/ui.js) | 9 页公共壳层；来源导航；表单/候选草稿；加载/空/错误/缓存；内联验证；定位/保存/认证阶段；部分结果；焦点/选区/滚动；有限进入和退出 |
| [motion.js](../client/src/js/motion.js)、[motion-policy.js](../client/src/js/motion-policy.js) | 导航与命令表现分类；运行中系统减少动态、隐藏和显式降级；最终开关 transform 保留 |
| [navigation-state.js](../client/src/js/navigation-state.js) | 以 screen/entity/scope 为键的来源栈和位置；浏览器历史含不透明 owner，不把表单或 token 放入 URL |
| [task-state.js](../client/src/js/task-state.js) | 同业务请求防重；结果/错误/finally 仅修改拥有其 scope/view/request 的 UI；离页不取消已发业务 |
| [runtime-resource-state.js](../client/src/js/runtime-resource-state.js) | 唯一资源状态模型、运行时请求代次、真实刷新结果、坐标校验 |
| [dom-reconcile.js](../client/src/js/dom-reconcile.js) | 当前页面按稳定键更新；输入/按压节点不因普通重绘被换掉；相同 live-region 文本不反复改写 |
| [pull-refresh.js](../client/src/js/pull-refresh.js) | 主指针、方向锁、反向撤销、取消、阈值和请求标识；按钮与手势互斥 |
| [main.js](../client/src/main.js) | 真实业务阶段、资源状态、迟到结果隔离、部分成功、启动与系统返回接线；协议状态不由动画推断 |
| [style.css](../client/src/css/style.css)、[index.html](../client/index.html) | 150/160/180/200ms 项目 Token、120ms 退出；静态首帧与 noscript；不强制等待启动动画 |
| [native-ble-adapter.js](../client/src/js/adapters/native-ble-adapter.js) | 停止失败保留可重试状态，拒绝旧扫描回调；旧设备断连不误伤新连接 |
| [endpoint-probe.js](../client/src/js/platform/endpoint-probe.js) | 明确 API 通过但实时连接失败；未检查 WS 不再宣称实时正常 |
| [store.js](../client/src/js/store.js)、[cache-repository.js](../client/src/js/platform/cache-repository.js) | 原子清理不兼容平台快照/回执；保留本地 BLE；站点/服务/组织/授权缓存隔离 |
| [oidc-session.js](../client/src/js/auth/oidc-session.js) | 会话绑定 Issuer/Client/不透明授权分区；正常续期保留分区；退出先撤销本地权限，迟到续期不恢复旧会话 |
| [预览目录说明](../client/src/dev/motion-preview/README.md) | serve-only `/__motion/`；真实 ClientUi/CSS + 合成模型与假任务；生产隔离检查 |

### 2.1 交互不变量

- 命令只有 ACKNOWLEDGED 可表现“已确认”。SENT/PENDING 观察次数耗尽只停止等待表现，保留协议真值，不改成 FAILED，不给自动重试。
- HTTP 请求完成、冷却结束、缓存恢复、预报失败均不能伪装成设备执行成功或“所有数据最新”。
- 实体/身份先失效再绘制新上下文；旧结果不能清掉新 busy、关闭新候选表单或把相同设备 ID 的旧回执套给新站点。
- pointercancel、横向意图、反向退回阈值内、非主指针和输入区域不触发刷新；减少动态下普通数据重绘不取消合法手势。
- 下拉只在页顶声明方向性 `touch-action`，保留上滑原生滚动与缩放。选择依据是 [Pointer Events 的下拉刷新说明](https://www.w3.org/TR/pointerevents3/#the-touch-action-css-property)；本轮另以 Chromium CDP 触摸输入验证，Android WebView 待实测。
- 退出残影只保留视觉，立即 inert/aria-hidden、移除所有 action/field/region/id 等查询键；业务和焦点不等 120ms 动画结束。
- BLE 缓存只代表上次数据，不代表恢复了 GATT 连接；新广播不自动改变用户选中候选；连接使用启动时捕获的候选身份。
- 动效降级不改变请求次数、只读约束、控件最终位置、焦点或数据语义。

### 2.2 必须知晓的升级与回退影响

1. **首次升级可能需要重新登录。** 缺少可信 Issuer、Client ID 或授权分区绑定的旧会话不复用。新分区为非凭据随机值，每次新授权变化，正常续期不变；无 token 写入路由键、URL 或预览。
2. **旧无站点/身份归属的缓存不自动导入。** IndexedDB 仍为原 v2 数据库；新记录使用显式分区。旧记录可能仍在存储中，但新读路径不采用，需要联网重新建立快照。本轮没有自动迁移、删除或宣称原缓存离线无缝兼容。
3. 本地 BLE 绑定与活动仍独立保留，恢复后标为离线/未连接，必须实际连接才能控制。
4. 源码回退不能仅凭“数据库版本未变”判为安全：旧版本可能重新读取未隔离缓存。回退前需在受控测试环境核对会话与缓存重建策略，不能执行全局清库或删除本地 BLE 来掩盖问题。真实旧 APK 数据回退尚未验证。
5. 缓存/绑定写入失败不把已经确认的远端操作判为失败；相关提示保留在界面，避免重复写入。旧上下文命令收据按原范围保存在内存，不承诺新增了持久离线命令队列。

## 3. 复验命令与证据

环境：Windows；项目要求 Node 22，本轮使用临时命令级 Node **v22.23.3**，未修改全局 Node/PATH；Playwright **1.62.0**、Chromium **151.0.7922.34**、Vite **5.4.21**。当前 shell 默认 Node 24 仅保留作环境事实，不作为本轮最终基线。

证据编号用于工作表映射，测试都是合成/假边界，除本地 Vite 模块读取外不依赖实际后台。

| 编号 | 来源 | 结果/覆盖，不扩大解释 |
| --- | --- | --- |
| E01 | `client/test/*.test.js` | 159 项单元测试通过；包括 17 项实际 main.js 函数体隔离测试、任务/导航/手势/策略、缓存、OIDC、BLE 与登记检查 |
| E02 | `motion-states.spec.js` | 1 项；命令上报/目标值与确认语义 |
| E03 | `motion-interruptions.spec.js` | 9 项；取消/轴向/反向、互斥、旧 scope/finally、离页/重入、来源/浏览器返回、reduce、草稿、横锚点、ACK 焦点 |
| E04 | `motion-render-integrity.spec.js` | 8 项；稳定节点、认证/观察状态、CDP 触摸、reduce 下手势、退出副本、表单兼容、BLE 身份、单次上下文入场 |
| E05 | `motion-preview.spec.js` | 6 项；42 场景/144 变体、隔离、9 页 × 4 宽度、确认/未知/重置、代表性状态、P19 真入口重放 |
| E06 | `mobile-client.spec.js`、`mobile-offline-recovery.spec.js` | 2 项；实际 main 启动链在模拟 REST/WS 下的导航、无溢出、刷新与离线恢复 |
| E07 | `motion-preview-visuals.spec.js` | 1 项；输出 9 页 normal/reduce 共 18 张截图及预览工作台图；截图生成不是逐像素自动视觉验收 |
| 合计 | 上述指定浏览器文件 | **27 通过、0 失败、0 跳过，36.6s**；不是仓库所有生产/认证/压力测试 |
| E08 | Node 22 Vite build + `check-production.mjs` | 生产构建通过（1818 modules，1.95s）；8 个输出文件无预览入口/合成 host/预览标识 |

本轮构建产物主入口：`dist/assets/index-B62XdnlD.js`（259.82 kB，gzip 78.90 kB）；CSS `index-CDQgSr0L.css`（29.72 kB，gzip 6.02 kB）。这是 Web 产物，不是 APK。依赖锁文件未因本轮开发升级。

最终浏览器输出：`client/test-results/motion-final-20260927-r4/`；机器可读报告：`client/test-results/motion-final-20260927-r4-report.json`。单元 XML：`client/test-results/motion-final-20260927-r4-unit.xml`。测试输出通常被 Git 忽略，需随实际交付另行归档，不把工作区截图当已提交资源。

截图子目录：`motion-preview-visuals-exp-86e3d-n-normal-and-reduced-motion/`。本轮人工查看了工作台、详情、连接设置与天气的代表性截图；四宽度无横向溢出来自 E05 自动断言，非所有字体、设备和长文案的视觉保证。

在 `E:\CC_testP\iot-manager\client` 执行；`npm test`/构建在使用 Node 22 的终端可直接运行，以下显式命令保留本轮复验方式：

```powershell
npx --yes --package=node@22 node --test --test-reporter=spec --test-reporter=junit --test-reporter-destination=stdout --test-reporter-destination=test-results/motion-final-20260927-r4-unit.xml

$env:IOT_RUNTIME_BASE_URL = ''
$env:IOT_PLAYWRIGHT_OUTPUT_DIR = 'test-results/motion-final-local'
$env:PLAYWRIGHT_JSON_OUTPUT_FILE = 'test-results/motion-final-local-report.json'
npx --yes --package=node@22 node node_modules/@playwright/test/cli.js test e2e/mobile-client.spec.js e2e/mobile-offline-recovery.spec.js e2e/motion-states.spec.js e2e/motion-interruptions.spec.js e2e/motion-render-integrity.spec.js e2e/motion-preview.spec.js e2e/motion-preview-visuals.spec.js --workers=1 --reporter=line,json

npx --yes --package=node@22 node node_modules/vite/bin/vite.js build
npx --yes --package=node@22 node src/dev/motion-preview/check-production.mjs
```

重跑应换一个新的输出目录/报告名，避免覆盖需要保留的证据。首次 npx 可能下载临时 Node 包，不升级项目依赖，不修改全局默认版本。

### 3.1 自检中发现并修正的事项

- 下拉 `touch-action` 方向最初与原生滚动冲突，改为页顶 `pan-x pan-down pinch-zoom` 后，真实 Chromium 输入链中下拉仅请求一次、上滑仍滚动。
- 减少动态时普通重绘误取消手势、退出残影残留字段查询键，已加专门回归。
- 跨站点/账号相同设备 ID、旧 receipt、缓存和位置状态可能串用，补原子清理、请求代次与缓存/会话分区。
- BLE 停止失败误报停止、已缓存连接误报在线、广播变更选中候选、连接期间使用后来的候选，已修复并加单元/DOM 回归。
- REST 成功但 WS 失败现在显示部分可用；没测 WS 不宣称其正常。
- 预览 iframe 的边框曾使“320”实际为 318px，已修正内容宽度；P19 重放错误动作键、连接页初始草稿缺失、BLE 假数据身份不一致也已修正。
- r3 浏览器复验的两处失败已留存：一个是预览草稿未初始化导致正常校验阻止请求；另一个是测试在详情补丁前未保留 activeDeviceId。修正后 r4 全部通过，没有删除或跳过失败断言。

## 4. 如何查看效果

```powershell
cd E:\CC_testP\iot-manager\client
npm run dev -- --host 127.0.0.1
```

打开 [本地合成动效预览](http://127.0.0.1:5175/__motion/)。可选择 G01–G11、P01–P20、C01–C11、状态变体、延迟/结果、normal/reduce、320/390/768/1280 宽度并重置。静态/系统托管场景会说明没有可重放 App 操作，不编造系统动画。

该 iframe 不导入 main 或真实适配器，CSP `connect-src 'none'`、Permissions-Policy 和传输 API 拒绝共同隔离；重置仅销毁合成任务，不清真实用户存储。Vite 插件仅 `serve`，生产构建扫描不得含预览入口、fixture host 或标识。

## 5. 尚未通过的验收门禁

| 门禁 | 缺少的输入或证据 | 完成要求 |
| --- | --- | --- |
| K2 真实联调 | 独立后台、两个站点/角色、OIDC 配置、可操作测试设备 | 真实 ACK/未知/拒绝、跨上下文迟到、缓存失效、认证冷/热回调与退出失败，逐条记录 X 子场景 |
| K3 Android 构建 | 当前 PATH/JAVA_HOME 为 Java 8；所查常见 Java 目录未见 JDK 21；SDK/adb 未配置 | 受控 JDK 21 + SDK 36/build-tools 36.0.0 后构建 debug APK；未安装 SDK或改全局配置 |
| PDA 平台 | 型号、Android/WebView、BLE 设备和允许操作范围 | 真实触摸/权限/设置/返回/键盘/断连/冷热启动，不用浏览器缩小视口替代 |
| 可访问性 | TalkBack/键盘全流程、大字体、横竖屏及系统窗口结果 | normal/reduce 下同样可操作，读屏无重复播报；目前只有部分 DOM/焦点断言 |
| 性能与长时间 | 目标设备负载、阈值、长任务/帧时间/内存采样 | 同设备同负载开关动效对照；未承诺 30/60fps 或已完成工业 PDA 测试 |
| 覆盖闭环 | X01–X18 的全部适用组合尚未逐条跑完 | 按工作表补齐，不用“27 tests/42 IDs/144 variants”取代完整矩阵 |

因此可交接的是**可运行、可演示、可回归的客户端实现与文档**。正式结论仍须分开写设计范围、实现、自动化、真实平台、性能和可访问性；不预勾选“工业 PDA 测试完成”。
