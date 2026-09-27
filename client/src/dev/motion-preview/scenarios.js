// This manifest is development/test data, never a production entry point.
export const PREVIEW_SCREENS = Object.freeze(['devices', 'detail', 'activity', 'add', 'ble', 'lan', 'sites', 'connections', 'weather']);

const scene = (id, title, screen, variants, expectation, platform = false) => Object.freeze({
  id, title, screen, variants: Object.freeze(variants.split(' ')), expectation,
  boundary: platform ? '仅展示 App 一侧合成状态；系统交接、读屏和 PDA 性能须真实环境验收。' : '合成 UI 演示，不代表真实后台或设备验收。'
});

export const MOTION_SCENARIOS = Object.freeze([
  scene('G01', '启动与首帧', 'devices', 'ready loading error', '就绪立即展示内容；不等待固定动画时长。', true),
  scene('G02', '前后台与恢复', 'devices', 'ready cache error', '恢复显示最新快照；后台不积攒装饰动效。', true),
  scene('G03', '登录与回调', 'connections', 'signed-out loading ready error', '认证结果依据会话状态；错误不得伪装登录成功。', true),
  scene('G04', '退出与失效', 'devices', 'ready signed-out error', '身份失效及时清理旧上下文；不保留敏感内容等待动画。', true),
  scene('G05', '主导航切换', 'devices', 'ready', '同级切换保持页面位置；重复选择不重播。'),
  scene('G06', '来源返回与层级', 'detail', 'ready', '通过页头进入天气/站点后，返回实际来源。', true),
  scene('G07', '上下文替换', 'sites', 'ready loading error', '站点/端点变化一次替换；迟到结果不污染新上下文。'),
  scene('G08', '离线与实时重连', 'devices', 'ready loading cache error', '缓存与已同步可区分；超时不永久忙碌。'),
  scene('G09', '权限与设置返回', 'ble', 'permission-denied bluetooth-off ready', '设置入口仅记录意图；此预览不打开系统设置。', true),
  scene('G10', '会话恢复与续期', 'connections', 'loading ready error', '续期失败可读；正常续期不重播页面。', true),
  scene('G11', '缓存与存储降级', 'devices', 'ready cache error partial', '主操作成功与缓存失败分开；不诱导重复写入。'),
  scene('P01', '设备加载与空状态', 'devices', 'ready loading empty error cache', '首次加载、真实空结果、缓存与失败各自表达。'),
  scene('P02', '设备列表更新', 'devices', 'ready empty cache', '按稳定设备 ID 更新；不逐行重播。'),
  scene('P03', '设备详情与实体', 'detail', 'ready second-device empty', '实体切换可分辨；详情失效回到可用页面。'),
  scene('P04', '命令确认全周期', 'detail', 'ready pending sent acknowledged failed unconfirmed', '只有 ACKNOWLEDGED 更新已上报值；未知不自动重试。'),
  scene('P05', 'BLE 断开与忘记', 'detail', 'ble-connected ble-disconnected error', '被动断开不表现为主动成功；忘记仅影响合成数据。', true),
  scene('P06', '活动与阅读锚点', 'activity', 'ready empty loading error', '重复活动 ID 不新增行，更新不抢阅读位置。'),
  scene('P07', '添加设备入口', 'add', 'ready', '入口直接响应，不虚构后台等待。'),
  scene('P08', 'BLE 扫描与停止', 'ble', 'empty scanning ready error', '扫描与停止分别反馈；RSSI 变化不移动按压行。', true),
  scene('P09', 'BLE 选择与连接', 'ble', 'ready loading ble-connected unknown-profile error', '连接失败保留候选；未知 Profile 不提供臆造控制。', true),
  scene('P10', 'LAN 发现', 'lan', 'ready loading empty error', '再次发现保留已有候选；空与失败不同。'),
  scene('P11', 'LAN 认领与取消', 'lan', 'selected loading error partial ready', '草稿保留；取消界面不等于撤回已发请求。'),
  scene('P12', '站点选择', 'sites', 'ready loading empty error', '无站点不无限同步；切换失败展示实际上下文。'),
  scene('P13', '连接模式与字段', 'connections', 'ready remote', '新增字段局部显现；隐藏字段不抢其他控件焦点。'),
  scene('P14', '连接测试与激活', 'connections', 'ready loading error partial', '测试通过不代表保存完成；REST/WS 部分可用单独说明。'),
  scene('P15', '天气与缓存', 'weather', 'ready loading cache expired empty error', '天气时间、来源与状态同时表达。'),
  scene('P16', '定位与待保存', 'weather', 'ready pending-location loading error partial', '定位与保存分开；待保存位置可重试，不调用 GPS。', true),
  scene('P17', '手动位置与冷却', 'weather', 'ready cooldown error', '空字段不能变成零坐标；冷却不等于数据最新。'),
  scene('P18', '小时与每日预报', 'weather', 'ready loading empty error partial', '两块独立状态；同站点保持横向阅读位置。'),
  scene('P19', '下拉完整周期', 'devices', 'ready loading error', '有效松手才请求；取消/横向/离页零请求，按钮可等效操作。'),
  scene('P20', '能力与只读', 'detail', 'ready unknown-profile cache empty', '权限和能力变化立即调整控件；缺失数据稳定说明。'),
  scene('C01', '通用按钮', 'connections', 'ready loading error', '聚焦、按下、忙碌与禁用均可辨。'),
  scene('C02', '四类能力控件', 'detail', 'ready pending acknowledged failed unconfirmed', '开关/选择/范围/action 均遵守真实命令结果。'),
  scene('C03', '输入与就地错误', 'weather', 'ready error', '错误持续可读；保留输入、焦点与选区。'),
  scene('C04', '加载与空状态', 'devices', 'loading empty ready error', '静态信息不依赖动画；不人为推迟结果。'),
  scene('C05', '持续 Notice', 'devices', 'error ready cache', '同一错误不反复入场；关闭外观不解除只读。'),
  scene('C06', 'Toast 去重与退出', 'devices', 'ready error', '相同提示不堆叠；重要结果留在页面中。'),
  scene('C07', '取消与移除', 'lan', 'selected ready error', '仅焦点在退出区域时转交；业务不等待动画。'),
  scene('C08', '响应式与键盘', 'connections', 'ready remote', '视口变化不算导航；键盘、横屏和字体放大需专项检查。', true),
  scene('C09', '页头与状态芯片', 'weather', 'ready cache cooldown error', '数值不滚动计数；风险不循环闪烁或影响权限。'),
  scene('C10', '原生输入与滚动', 'weather', 'ready loading', '横向预报与文本选择不触发下拉刷新。'),
  scene('C11', '运行中动效策略', 'detail', 'ready pending acknowledged', '切换减少动态立即停止装饰动画，保留开关最终位置。')
]);

export const scenarioById = (id) => MOTION_SCENARIOS.find((item) => item.id === id) ?? MOTION_SCENARIOS[0];
