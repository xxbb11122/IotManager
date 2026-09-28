# App 动画、闪屏与刷新治理：修复实施报告

> 日期：2026-09-27；版本：v1.0。
> 基线提交：`7675df84906732fa675e35c7520dfb7b75a5d1f7`；本报告对应其上的**未提交工作区修改**。
> 依据：[修复方案](APP-MOTION-FLICKER-REMEDIATION-PLAN-2026-09-27.md)、[修复前专项复审](APP-MOTION-FLICKER-REFRESH-REVIEW-2026-09-27.md)。

## 1. 结论

方案 FIX-01 至 FIX-08 的客户端代码、构建身份和 CI 回归接入已完成。本地客户端单元测试、浏览器回归及生产 Web 构建通过，新增稳定性用例另外重复两轮通过。

**准确状态：修复代码实现完成，本地回归通过；物理手机验收尚未完成。** 不能将本报告解释为“所有型号手机均已无闪屏”或“用户手机已经安装了修复版本”。本轮没有构建/安装 APK，没有提交或推送 GitHub，没有启动真实后端、数据库或设备控制。

修复前报告保留为历史证据，不反向改写其结论；本报告仅更新本轮实际处理的客户端事项，不替代全项目发布、安全或硬件验收。

## 2. 已完成的修复

| 工作包 | 实际实现 | 对应文件 |
| --- | --- | --- |
| FIX-01 状态去重 | 规范化 Store 状态相同时保留原快照，不发布；对象字段排列不同不构成变化；本地 `clientState` 相同时不再排队渲染 | `client/src/js/value-equality.js`、`store.js`、`client/src/main.js` |
| FIX-02 稳定 DOM | 详情标题、连接、状态、命令、控件、活动、天气、预报、冷却及刷新按钮采用键控协调；保留原控件节点，仅在结构真的改变时增删 | `client/src/js/dom-reconcile.js`、`ui.js` |
| FIX-03 操作意图 | 按下时记录节点、命令数据、scope/view；点击前重新核对；值变化、节点消失、权限/只读变化、账号分区变化、取消或后台切换使旧手势失效；取消有提示 | `client/src/js/ui.js` |
| FIX-04 合并/动效 | 同批设备与命令/连接不重复处理控件；页面级补丁覆盖已包含的子区域；天气+预报合批不重复补丁；天气提示改在稳定的更新时间标签上，不再整片淡入 | `render-coordinator.js`、`ui.js`、`main.js` |
| FIX-05 请求调度 | 同端点、组织、站点、账号和会话共享一个在途设备列表请求；自动读取按最近尝试冷却 120 秒，成功和失败均计入；使用单调时钟；新上下文隔离 | `snapshot-refresh-gate.js`、`main.js` |
| FIX-06 遥测展示限频 | 对明确的普通测量字段，Store 持续接收最新状态，UI 至多每秒合并展示一次；支持 `telemetry_update` 和测量变化型 `device_update`；未知变化保守走优先路径 | `store.js`、`render-coordinator.js` |
| FIX-07 诊断/版本身份 | 记录区域补丁、UI 渲染入口、DOM 协调变更/替换、取消意图、快照启动/共享/冷却计数；连接设置页显示提交、构建时间、工作区修改标志；生产生成 `build-info.json` | `render-metrics.js`、`ui.js`、`build-info.js`、`vite.config.js` |
| FIX-08 必跑回归 | 新增 12 个浏览器场景、8 个纯逻辑测试和 1 个实际运行入口测试；严格 Bash/PowerShell 验证加入离线、动效、预览及稳定性套件；每次客户端 build 执行生产预览隔离检查；CI 静态契约保护清单 | `client/test/refresh-stability.test.js`、`runtime-presentation.test.js`、`client/e2e/refresh-stability.spec.js`、`scripts/verify.*`、`scripts/ci/tests/release-workflows.test.mjs`、`client/package.json` |

### 2.1 保留的功能与安全边界

- WebSocket 未关闭；必要命令回执轮询仍保留，重复回执只抑制无效呈现。
- `reportedState`、`desiredState`、命令状态、连接、权限/结构及未知字段变化不会被归入普通测量限频。
- 优先变化可以提前结束遥测等待，仍使用原有短突发合并窗口；结构变化立即调度。未宣称硬实时性能保证。
- 下拉刷新及 60 秒主动刷新冷却保留；天气主读 10 分钟、预报 30 分钟的缓存策略未削减。
- 自动 120 秒冷却**不是新增定时轮询**。冷却内保留错误/缓存状态，不伪装“已更新”；主动下拉仍可按原规则读取。
- 同一实体/同一页面保留节点；切页面、设备被删除或安全状态要求更换结构时仍允许必要的节点变化。
- 键盘/辅助技术的无指针点击按新的当前意图处理，不会因遗留的取消手势而永久禁用。
- 动效仍遵守 reduced-motion、后台和降级策略；没有通过全局禁用动画掩盖问题。

### 2.2 本轮自检中补修的回归

首次完整浏览器回归有 1 项失败：稳定 DOM 后，滑块结束拖动仍持有焦点，通用输入保护将旧拖动值保留下来，阻止最新状态回填。

已将 range 保护限定为有效拖动期间；拖动结束后恢复状态同步，pending/只读仍及时执行。原用例未删除或放松数值断言，最终全套通过。同时核对后端实际遥测字段，将 CPU 和运行时长等纳入普通测量白名单；状态/控制字段仍优先。

## 3. 修复前后对比

下表的“修复前”来自历史专项复审的浏览器模拟证据；“修复后”来自新增断言与保留的原回归。它们均不是物理手机录屏结论。

| 场景 | 修复前 | 修复后实测 |
| --- | --- | --- |
| 20 次相同设备推送，每次间隔 200ms | 详情的标题、连接、状态、控件区域分别替换 20 次，`fullRenderCount` 仍为 0 | 0 次 Store 发布、0 次被观察详情内容 DOM 变更、0 次设备补丁；关键节点不变 |
| 鼠标按下途中相同数据补丁 | 合法点击丢失，命令数 0 | 原按钮保留；命令恰好 1 次，参数仍为开启 |
| 可信触摸按下途中相同补丁 | 节点替换，虽然该浏览器场景仍可能产生点击 | 原按钮保留；命令恰好 1 次 |
| 鼠标/可信触摸按下“开启”，松手前推送变为已开启 | 可信触摸场景实际提交了反向关闭 | 本次命令 0 次，显示取消提示，不执行相反参数 |
| 实际开关 off→on 补丁 | 新节点直接呈现终态，无实际滑块过渡事件 | 同一按钮触发 `::after` 的 `transform` 过渡；reduce 下终态正确且无该过渡 |
| 一次新天气 + 预报补丁 + 重复天气 | 整个天气区淡入启动 3 次 | 更新时间标签提示 1 次；天气主体透明度保持 1；天气/头部/按钮节点保留 |
| 首次命令回执 + 重复相同回执 | 重复回执不断更新，单批设备+命令还重复处理控件 | 首次与连接域合批只做 1 次控件补丁，后续 4 次重复被抑制 |
| REST 503 启动失败，随后 WS 重连 3 次 | 启动 2 次读，再增加 3 次，合计 5 次 | 整段只有 1 次设备列表读；错误不被隐藏 |
| 持续普通遥测 | 短批次合并不能约束持续更新频率 | 纯逻辑 300 次/约 3 秒输入合为 4 次呈现，间隔至少 1000ms；浏览器连续 60 次输入也受限，最终显示最新样本 |
| 短暂只读后恢复、pointercancel、账号切换 | 缺少完整按压意图校验 | 旧手势不提交；新的键盘操作仍可执行 |

`domMutationCount` 统计本轮接入的 DOM 协调操作及显式页面替换，不是浏览器所有绘制、GPU 帧或页面任意脚本变更的总计。因此还保留了原生 `MutationObserver`、节点引用、`animationstart`、`transitionrun` 和实际请求数断言，不再只凭 `fullRenderCount` 判断稳定。

## 4. 验证结果及原始证据

最终正式验证环境：Windows，Node.js **22.23.3**，Playwright **1.62.0**，Chromium **151.0.7922.34**，移动视口 390×844；触摸场景使用 `isMobile/hasTouch` 及可信 CDP 触摸事件。Vite 测试服务只监听 `127.0.0.1:6189`，不连接真实后端。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 客户端完整 Node 单元测试 | **168/168 通过**；0 失败、0 跳过 | `client/test/`，含 `refresh-stability.test.js` |
| 客户端 8 个浏览器测试文件 | **39/39 通过**；0 跳过、0 flaky；约 59.1 秒 | `client/e2e/`，含 `refresh-stability.spec.js` |
| 新增稳定性用例重复两轮 | **24/24 次执行通过**（12 个场景×2）；0 跳过、0 flaky；约 51.2 秒 | `client/e2e/refresh-stability.spec.js --repeat-each=2` |
| 发布工具/工作流静态契约文件 | **2/2 文件通过**，包含本轮 CI 清单和 build 隔离断言 | `scripts/ci/tests/release-workflows.test.mjs` |
| 客户端生产构建 | **通过**，1821 个模块转换 | `client/dist/`，本地生成物 |
| 生产预览隔离检查 | **通过**，扫描 9 个输出文件，无开发预览入口/模拟主机/预览运行标识 | 构建脚本强制调用 `check-production.mjs` |
| Bash / PowerShell 修改语法 | **通过** | `bash -n scripts/verify.sh`、PowerShell Parser |
| 差异空白检查 | **通过** | `git diff --check` |

39 个浏览器场景中含新增的 12 个场景；24 次重复执行不应再计作 24 个不同功能。2 个发布契约测试是静态/本地工具检查，**不是**实际 GitHub Actions、Docker 生产链或发布签名验证。

本地原始 Playwright/截图/XML 记录含绝对开发机路径，故不纳入公开仓库；报告保留可复现命令、测试名与结果摘要。截图用于布局核对，动画是否真实发生以事件断言为准，不用静态图替代动画验收。

### 4.1 构建身份

本次生产 Web 产物的公开身份：

```json
{
  "commit": "7675df84906732fa675e35c7520dfb7b75a5d1f7",
  "builtAt": "2026-09-27T15:19:03.891Z",
  "dirty": true,
  "version": "1.0.0"
}
```

`dirty: true` 表示包含尚未提交的修改，不能当作该 SHA 的干净发行版。身份仅包含上述公开字段，不序列化环境变量、机器目录、Token 或密钥。

- `client/dist/build-info.json` SHA-256：`C041F4DB7AFEC6EA307E50509DFEA579C9BAD838F8DAA728BA58A6A79E5D7A9C`。
- `client/dist/assets/index-CK18a0Xe.js` SHA-256：`22EDD2ABB4FD80D2FDDF8F90E64465DC2DA729CFD58C061E6BED0BE7F0E201A6`。

以后打包时会重新生成身份。新客户端的“连接设置 → 当前安装版本”可核对 SHA、构建时间和工作区标志；Web 产物有这个字段并不证明手机上已安装同一包。

## 5. 复验方式

使用 Node 22。在 `client` 目录执行：

```powershell
npm test
npm run build
npx playwright test e2e/mobile-client.spec.js e2e/mobile-offline-recovery.spec.js e2e/motion-states.spec.js e2e/motion-interruptions.spec.js e2e/motion-render-integrity.spec.js e2e/motion-preview.spec.js e2e/motion-preview-visuals.spec.js e2e/refresh-stability.spec.js --workers=1
npx playwright test e2e/refresh-stability.spec.js --repeat-each=2 --workers=1
```

Playwright 默认管理本地 Vite；若设置 `IOT_RUNTIME_BASE_URL`，必须指向专门的测试服务，不能指向生产系统。上述浏览器场景使用隔离夹具/拦截 API；不包含实际平台的 `runtime-auth`、`runtime-load`、`rollback-data-compatibility` 套件。

在仓库根目录执行 CI 静态契约：

```powershell
node --test scripts/ci/tests/release-workflows.test.mjs scripts/ci/tests/release-tools.test.mjs
```

本轮没有运行整套 `verify --strict` 的其他模块/部署链，只执行了其本轮涉及的客户端必跑集合、生产构建及相关契约/语法检查；不可将此记录扩大解释为整个仓库所有验证已重跑。

## 6. 仍需完成的实机发布验收

以下不影响本轮代码已落地的事实，但影响是否能对“手机闪屏已完全修复”签字：

1. 在可用 Android SDK/JDK 环境生成新的 APK，保存 SHA-256、构建身份和签名类型；不能继续分发旧 APK 来验证新代码。
2. 安装到用户实际反馈问题的手机，核对“当前安装版本”；记录手机型号、Android/WebView 版本、系统动画/减少动态效果设置。
3. 在真实推送和 BLE 操作中复验：按下期间推送、开关连续操作、拖动滑块、输入草稿、天气/预报变化、横向阅读、下拉、前后台、断网与重连。
4. 保存屏幕录制和可取得的帧/请求日志，验证没有整页/整片天气淡入反复播放，没有反向命令、数据清空、焦点跳跃或读取风暴。
5. 本地发布后还需真实 GitHub CI 回执；Release 签名和生产发布门禁按原流程执行，不因本报告自动通过。

本轮未安装或切换手机 App。手机上原有安装包不会因工作区代码修改而自动改变；应在新包安装并核对版本后再进行实机结论对比。

## 7. 交付边界

- 本轮修改：客户端状态/呈现/请求调度、客户端构建身份、相关测试和 CI 验证清单。
- 本轮保留：已有项目报告、历史复审/测试证据和其他未提交文件；没有清理或覆盖它们。
- 本轮没有：修改后端数据协议、放宽安全策略、操作真实设备、删除用户数据、提交 GitHub、安装旧包冒充新包。
- 本轮测试服务为临时本机服务，验证结束后停止；不作为项目持续运行服务交付。

最终审批建议：**客户端修复代码允许进入新 APK 构建和真机回归阶段；暂不签发“真机问题全部关闭”。**
