export const FIELD_LABELS = Object.freeze({
  temperature: '温度', humidity: '湿度', pressure: '气压', signalStrength: '信号',
  power: '开关反馈', voltage: '电压', current: '电流', powerWatts: '有功功率',
  totalEnergyWh: '总电量', battery: '电池电量'
});

export const LINK_LABELS = Object.freeze({
  RECENT: '近期有通信', CONNECTED: '已核验连接', DISCONNECTED: '已断开',
  NOT_SEEN: '超期未见', UNKNOWN: '状态未知', BOUND: '历史绑定，未核验连接'
});

export const VALIDITY_LABELS = Object.freeze({
  FRESH: '有效', STALE: '过期', NO_SAMPLE: '无有效上报',
  AGE_UNVERIFIED: '实时性未确认', RECEIPT_ONLY: '命令反馈', LIVE_READ: '本次只读采样'
});

const uncertainCommand = new Set(['PENDING', 'SENT', 'UNCONFIRMED', 'FAILED', 'REJECTED']);
const noData = new Set(['NO_SAMPLE', 'STALE']);
const step = (actor, instruction) => ({ actor, instruction });
const UNKNOWN_VERIFY = Object.freeze({ state: 'NOT_VERIFIED', message: '尚无符合条件的新证据。任务不会自动刷新。' });
export const timeValue = (value) => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' ? Date.parse(value) : NaN;
export const fieldLabel = (key) => Object.hasOwn(FIELD_LABELS, key) ? FIELD_LABELS[key] : key;

function planAt(device, changes) {
  return {
    key: device.key, source: device.source, name: device.name, asOf: device.asOf,
    demo: device.demo === true, profileId: device.profileId ?? null, firmwareVersion: device.firmwareVersion ?? null,
    confidence: 'NEEDS_CHECK', ruleVersion: 1, verification: 'NONE', field: null,
    evidence: [], steps: [], escalation: '保留状态时间和脱敏错误信息，交给维护人员继续核对。',
    ...changes
  };
}

/** Repair steps come from versioned rules. A model may explain them, but cannot choose verifier conditions. */
export function makeRepairPlan(device, requestedField = null) {
  const bluetooth = device.source === 'MOBILE_BLE';
  const field = device.fields?.find((entry) => entry.key === requestedField)
    ?? (!requestedField ? device.fields?.find((entry) => entry.validity === 'STALE')
      ?? device.fields?.find((entry) => entry.validity === 'NO_SAMPLE') : null);
  const onlyOneFieldStale = field?.validity === 'STALE' && device.linkState === 'RECENT'
    && device.fields?.some((other) => other.key !== field.key && other.validity === 'FRESH');
  if (!requestedField && uncertainCommand.has(device.command?.state)) {
    return planAt(device, {
      issue: 'COMMAND_UNCONFIRMED', title: '核对原命令结果', confidence: 'CONFIRMED',
      evidence: ['原命令状态：' + device.command.state, '没有匹配的成功回执时，不能推断负载动作。'],
      steps: [
        step('操作人员', '保留原命令编号和时间，不重复发送同一个控制请求。打开该设备活动记录，核对原请求是否已返回确认或有拒绝原因。'),
        step('维护人员', '如果链路已恢复，读取设备本身的实际反馈。若状态匹配但没有原请求的确认，记录为状态已核实、原命令未确认；若不匹配，先处理链路或设备错误，再决定下一次经批准的操作。')
      ],
      verification: 'COMMAND', commandId: device.command.id, requestedPower: device.command.requestedPower,
      check: '只核对同一条命令；独立读回不能改写原命令结果。',
      escalation: '不确定负载状态时暂停控制，交由现场操作人员核实。'
    });
  }
  if (bluetooth && device.linkState !== 'CONNECTED') {
    const permission = device.errorCode === 'BLE_PERMISSION_DENIED';
    const disabled = device.errorCode === 'BLE_DISABLED';
    return planAt(device, {
      issue: 'BLE_CONNECT', title: permission ? '恢复 App 蓝牙访问权限' : disabled ? '恢复手机蓝牙' : '恢复 App 与外设的连接',
      confidence: permission || disabled ? 'CONFIRMED' : 'NEEDS_CHECK',
      evidence: [LINK_LABELS[device.linkState] ?? '状态未知',
        ...(permission ? ['本机报告蓝牙权限被拒绝。'] : disabled ? ['本机报告蓝牙已关闭。'] : [])],
      steps: [
        permission ? step('手机用户', '在系统应用设置中允许本 App 访问附近设备，然后回到 App。')
          : disabled ? step('手机用户', '在手机系统设置中启用蓝牙。')
            : step('现场人员', '核对外设是否上电、处于可连接模式，并确认没有被另一台手机独占。若只见历史绑定，不能当作已连接。'),
        step('手机用户', '从 App 的添加或设备详情页，手动连接刚核对的外设一次；若之前的连接尚未释放，先让上一条连接正常结束。')
      ],
      verification: 'BLE_LINK', check: '本 App 持有的目标连接核验成功，而不是仅发现系统范围内的设备。',
      escalation: '若仍失败，记录设备型号、App 错误码和发生时间；不要改动系统安全策略。'
    });
  }
  if (!bluetooth && device.source === 'EDGE_AGENT' && !onlyOneFieldStale && (field || device.linkState !== 'RECENT')) {
    return planAt(device, {
      issue: 'EDGE_DELIVERY', title: '定位边缘到平台的停更环节', field: field?.key ?? null,
      evidence: [field ? fieldLabel(field.key) + '：' + (VALIDITY_LABELS[field.validity] ?? '待核对') : '平台缺少近期设备通信',
        '边缘代理状态：' + (device.links?.find((route) => route.transport === 'LAN_AGENT')?.agentStatus ?? 'UNKNOWN') + '。代理在线不等于已读到该设备。'],
      steps: [
        step('现场人员', '在 Edge Agent 本地记录中确认同一台设备是否出现新的采样。没有新采样，先核对设备与网关的连接、驱动身份和配置，不改平台。'),
        step('管理员', '若本地有新样本而平台无，核对代理登记站点、上报目标和失败码。仅当证据指向登记错误或鉴权失败时，按部署流程修正登记或更换失效凭据，保持鉴权启用。')
      ],
      verification: field ? 'PLATFORM_FIELD' : 'PLATFORM_LINK',
      check: field ? '正确站点记录目标字段至少两个不同时间桶的新有效样本。'
        : '正确站点收到该设备的新通信，不仅是网关心跳。',
      escalation: '变更导致其他设备停报时恢复上一版有效配置；保留同一设备两端的时间、站点和脱敏失败码。'
    });
  }
  if (field?.validity === 'STALE') {
    return planAt(device, {
      issue: 'FIELD_STALE', title: '恢复' + fieldLabel(field.key) + '上报', field: field.key,
      evidence: [fieldLabel(field.key) + '有历史样本，但已超过该字段配置的时限。',
        device.fields.some((other) => other.key !== field.key && other.validity === 'FRESH') ? '同板其他字段仍有有效样本。' : '尚未证实其他通道是否正常。'],
      steps: [
        step('维护人员', '对照同一时段的板端采集结果。如果源端缺少这个字段，检查该通道的采集错误、供电与配置；实物接线由现场人员在安全条件下确认。'),
        step('维护人员', '如果源端有新值，核对该固件版本的字段名、单位和采集映射。只在确认不匹配后修正对应映射或恢复已验证的配置。')
      ],
      verification: bluetooth ? 'BLE_FIELD' : 'PLATFORM_FIELD',
      check: bluetooth ? '同一设备有新的受支持只读样本。' : '不同时间桶的两条新有效样本，字段及单位正确。',
      escalation: '改动未生效时恢复原映射；带上固件版本和脱敏样本继续排查。'
    });
  }
  if (bluetooth || field) {
    return planAt(device, {
      issue: bluetooth ? 'BLE_NO_DATA' : 'FIELD_NO_DATA',
      title: '定位连接正常但读不到数据的原因', field: field?.key ?? requestedField,
      confidence: field?.samples?.length ? 'NEEDS_CHECK' : 'INSUFFICIENT',
      evidence: [
        bluetooth ? '连接成立不代表固件提供目标数据。' : '设备记录不能证明该字段已采样。',
        device.profileId ? '匹配的 Profile：' + device.profileId : '缺少已确认的型号或 Profile。'
      ],
      steps: [
        step('维护人员', '按实物型号和固件版本核对目标字段是否对外提供。若不提供，标记为不可采集，选择有对应只读接口的受支持固件或模块；不要把参考资料当成这台设备的接线。'),
        step('维护人员', '如果设备确实提供字段，核对发出的字段名、单位和订阅/映射。只修已确认的订阅或映射错误；必要时恢复到已验证的配置。')
      ],
      verification: field ? (bluetooth ? 'BLE_FIELD' : 'PLATFORM_FIELD') : 'NONE',
      check: !field ? '缺少可验证的字段，先确认实际型号、固件和数据能力。'
        : bluetooth ? '从目标设备读到新的、受支持的只读数据；命令回执不算传感器样本。'
          : '平台收到同字段两个不同时间桶的新有效样本。'
    });
  }
  return planAt(device, {
    issue: 'PLATFORM_LINK', title: '核对平台设备的上报通路',
    confidence: 'NEEDS_CHECK', evidence: [LINK_LABELS[device.linkState] ?? '无可信状态'],
    steps: [step('现场人员', '按设备编号确认仍在当前授权站点，检查设备自身是否在采样和向已配置的上报地址发送。'),
      step('管理员', '如果设备有新记录而平台没有，对照该设备最近接收时间和服务拒绝记录，修正已确认的连接或登记问题。')],
    verification: 'PLATFORM_LINK', check: '当前站点收到该设备的新通信。'
  });
}

export function verifyRepair(plan, current) {
  if (!current || current.key !== plan.key || current.source !== plan.source || current.cached || plan.demo || current.demo)
    return { ...UNKNOWN_VERIFY, message: plan.demo ? '演示设备不能用于证明现场恢复。' : '无法取得同一设备的实时证据。' };
  const cutoff = timeValue(plan.asOf);
  const observed = timeValue(current.asOf);
  if (!Number.isFinite(cutoff) || !Number.isFinite(observed) || observed <= cutoff) return UNKNOWN_VERIFY;
  const freshAt = (value) => timeValue(value) > cutoff && timeValue(value) <= observed;
  const recover = (message) => ({ state: 'RECOVERED', message });
  const fault = (message) => ({ state: 'STILL_FAULTY', message });
  switch (plan.verification) {
    case 'BLE_LINK':
      if (current.linkState === 'CONNECTED') return recover(plan.key === 'ble-setup'
        ? '本 App 已核验一条活动 BLE 连接；此修复卡未指定某台外设。'
        : '已重新核验本 App 持有的目标 BLE 连接。');
      if (current.linkState === 'DISCONNECTED' || current.errorCode === 'BLE_DISABLED')
        return fault('目标 BLE 连接仍未建立。');
      return UNKNOWN_VERIFY;
    case 'PLATFORM_LINK':
      if (current.linkState === 'RECENT' && freshAt(current.lastCommunicationAt)) return recover('平台收到该设备的新通信。');
      return current.linkState === 'NOT_SEEN' ? fault('平台仍未收到近期通信。') : UNKNOWN_VERIFY;
    case 'PLATFORM_FIELD': {
      const metric = current.fields?.find((item) => item.key === plan.field);
      const validBuckets = new Set((metric?.samples ?? []).filter((sample) =>
        sample.timeTrust === 'TRUSTED' && sample.source !== 'SIMULATOR'
        && freshAt(sample.receivedAt) && freshAt(sample.observedAt)
        && Number.isFinite(timeValue(sample.bucketStart)))
        .map((sample) => timeValue(sample.bucketStart)));
      if (validBuckets.size >= 2 && metric?.validity === 'FRESH' && current.linkState === 'RECENT')
        return recover('该字段有两个不同时间桶的新有效样本。');
      if (metric?.validity === 'STALE' || metric?.validity === 'NO_SAMPLE' || current.linkState === 'NOT_SEEN')
        return fault('该字段或设备仍缺少可用的近期数据。');
      if (validBuckets.size >= 2 && metric?.validity === 'AGE_UNVERIFIED')
        return { ...UNKNOWN_VERIFY, message: '已有新样本，但当前不能核验时效；请检查字段上报周期和采样时钟。' };
      return { ...UNKNOWN_VERIFY, message: '尚未取得两个不同时间桶、采样时间可信的新样本。' };
    }
    case 'BLE_FIELD': {
      const reading = current.fields?.find((item) => item.key === plan.field)?.samples?.[0];
      if (reading?.source === 'BLE_READ' && freshAt(reading.observedAt)) return recover('从目标设备读到了新的只读样本。');
      return { ...UNKNOWN_VERIFY, message: '未读到受支持的只读样本；连接或命令回执不能替代读数。' };
    }
    case 'COMMAND': {
      const command = current.command?.id === plan.commandId ? current.command : null;
      if (command?.state === 'ACKNOWLEDGED' && freshAt(command.completedAt))
        return recover('同一条命令已取得新确认；这不等于负载侧实测。');
      const feedback = current.fields?.find((item) => item.key === 'power')?.samples?.[0];
      if (typeof plan.requestedPower === 'boolean' && feedback?.value === plan.requestedPower
        && ['BLE_READ', 'EDGE_AGENT', 'DEVICE', 'API'].includes(feedback.source)
        && feedback.timeTrust === 'TRUSTED' && freshAt(feedback.observedAt) && freshAt(feedback.receivedAt))
        return { ...UNKNOWN_VERIFY, message: '设备最新读回与目标一致，原命令仍未确认。' };
      if (command && ['FAILED', 'REJECTED', 'UNCONFIRMED'].includes(command.state))
        return fault('原命令仍未获成功确认；未重发任何命令。');
      return UNKNOWN_VERIFY;
    }
    default: return UNKNOWN_VERIFY;
  }
}
