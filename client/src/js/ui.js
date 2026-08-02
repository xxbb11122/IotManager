import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bluetooth,
  BluetoothSearching,
  Boxes,
  Camera,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock3,
  Cpu,
  Gauge,
  Info,
  Lightbulb,
  Link,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  Network,
  Plus,
  Radar,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Router,
  SearchX,
  ShieldAlert,
  Target,
  TriangleAlert,
  Workflow,
  X
} from 'lucide';

const icons = {
  Activity,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bluetooth,
  BluetoothSearching,
  Boxes,
  Camera,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock3,
  Cpu,
  Gauge,
  Info,
  Lightbulb,
  Link,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  Network,
  Plus,
  Radar,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Router,
  SearchX,
  ShieldAlert,
  Target,
  TriangleAlert,
  Workflow,
  X
};

const DEFAULT_CONTEXT = {
  organizationName: '演示组织',
  organizationCode: 'demo-org',
  siteName: '演示站点',
  siteCode: 'demo-site',
  spacePath: '/operations/field'
};

const CAPABILITY_ALIASES = {
  power: 'power',
  switch: 'power',
  on_off: 'power',
  set_power: 'power',
  level: 'level',
  brightness: 'level',
  dimmer: 'level',
  set_level: 'level',
  mode: 'mode',
  set_mode: 'mode',
  read_only_telemetry: 'read_only_telemetry',
  generic_information: 'generic_information'
};

let activeUi = null;

/**
 * Converts a device view into the screen-level capability decision.  It stays
 * DOM-free so client tests can verify that unknown BLE profiles remain safe.
 */
export function deviceScreenState(device = {}, runtime = {}) {
  const connection = getPrimaryConnection(device);
  const capabilities = normalizeCapabilities(
    capabilityList(device.capabilities ?? connection.capabilities ?? connection.profileCapabilities ?? [])
  );
  const controlCapabilities = capabilities.filter((capability) => (
    capability.id === 'power' || capability.id === 'level' || capability.id === 'mode'
  ));
  const transport = normalizeTransport(connection.transport ?? device.transport);
  const profileId = connection.profileId ?? connection.profile ?? device.profileId ?? null;
  const unknownBleProfile = transport === 'BLE_DIRECT' && !profileId;

  if (runtime.stale === true && runtime.accessRoute !== 'BLE_LOCAL') {
    return {
      showControls: false,
      controls: controlCapabilities,
      unknownBleProfile: false,
      notice: '当前显示缓存状态，请等待平台同步后再控制。'
    };
  }

  if (unknownBleProfile && controlCapabilities.length === 0) {
    return {
      showControls: false,
      controls: [],
      unknownBleProfile: true,
      notice: '该蓝牙设备已连接，但暂无可用控制能力。'
    };
  }

  if (controlCapabilities.length === 0) {
    return {
      showControls: false,
      controls: [],
      unknownBleProfile: false,
      notice: '设备尚未提供可用控制能力。'
    };
  }

  return {
    showControls: true,
    controls: controlCapabilities,
    unknownBleProfile: false,
    notice: ''
  };
}

/**
 * The UI only receives a view model plus user-intent callbacks.  It never
 * imports the store, adapters, Web Bluetooth, or REST client directly.
 */
export function createClientUi(root = document.getElementById('app'), handlers = {}) {
  if (!root || typeof root.replaceChildren !== 'function') {
    throw new Error('createClientUi requires a DOM root element.');
  }

  if (activeUi) activeUi.destroy();
  activeUi = new ClientUi(root, handlers);
  return activeUi;
}

export const mountUi = createClientUi;

export function bleSelectionDescription(native = false) {
  return native
    ? '手机客户端会扫描并列出附近的蓝牙设备。'
    : '选择操作将打开浏览器提供的蓝牙设备窗口。';
}

/**
 * Convenience exports for a minimal main.js integration:
 * const ui = createClientUi(document.querySelector('#app'), handlers);
 * store.subscribe((snapshot) => ui.render(snapshot));
 */
export function bindEvents(handlers = {}) {
  if (!activeUi) {
    activeUi = createClientUi(document.getElementById('app'), handlers);
    return activeUi;
  }
  activeUi.bindEvents(handlers);
  return activeUi;
}

export function renderApp(viewModel = {}) {
  if (!activeUi) activeUi = createClientUi(document.getElementById('app'));
  activeUi.render(viewModel);
  return activeUi;
}

export function toast(message, isError = false) {
  activeUi?.notify(message, isError ? 'danger' : 'success');
}

// Kept only so an in-flight old main.js import can still bundle while it is replaced.
export function renderHome() { activeUi?.render(activeUi.model); }
export function renderControl() { activeUi?.render(activeUi.model); }
export function renderLogs() { activeUi?.render(activeUi.model); }
export function renderBleModal() { activeUi?.render(activeUi.model); }

class ClientUi {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = { ...handlers };
    this.model = normalizeViewModel({});
    this.local = {
      screen: 'devices',
      selectedCandidateId: null,
      claim: {
        displayName: '',
        siteCode: DEFAULT_CONTEXT.siteCode,
        spacePath: DEFAULT_CONTEXT.spacePath
      },
      endpointTest: null,
      commandValues: {},
      endpointDraft: {
        accessRoute: this.model.runtime?.accessRoute ?? 'SITE_API',
        apiBaseUrl: this.model.endpointProfile?.apiBaseUrl ?? '',
        wsUrl: this.model.endpointProfile?.wsUrl ?? ''
      },
      busyActions: new Set(),
      transientError: null
    };

    this.onClick = this.onClick.bind(this);
    this.onInput = this.onInput.bind(this);
    this.onChange = this.onChange.bind(this);
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);
    this.root.addEventListener('change', this.onChange);
    this.render(this.model);
  }

  bindEvents(handlers = {}) {
    this.handlers = { ...this.handlers, ...handlers };
  }

  render(viewModel = {}) {
    this.model = normalizeViewModel(viewModel);
    this.reconcileLocalState();
    this.root.replaceChildren(this.buildShell());
  }

  destroy() {
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('input', this.onInput);
    this.root.removeEventListener('change', this.onChange);
    if (activeUi === this) activeUi = null;
  }

  notify(message, tone = 'default') {
    if (!message) return;
    const region = this.root.querySelector('.toast-region');
    if (!region) return;

    const notification = element('div', `toast toast--${tone}`, { role: 'status' });
    notification.append(icon(tone === 'danger' ? 'CircleAlert' : tone === 'success' ? 'CircleCheck' : 'Info', 18));
    notification.append(textNode(message));
    region.replaceChildren(notification);

    window.setTimeout(() => {
      if (notification.parentNode === region) region.replaceChildren();
    }, 3500);
  }

  reconcileLocalState() {
    const active = this.getActiveDevice();
    if (this.local.screen === 'detail' && !active) this.local.screen = 'devices';
    if (this.local.selectedCandidateId && !this.getSelectedCandidate()) {
      this.local.selectedCandidateId = null;
    }
    if (!this.local.claim.siteCode) this.local.claim.siteCode = this.model.context.siteCode;
    if (!this.local.claim.spacePath) this.local.claim.spacePath = this.model.context.spacePath;
  }

  buildShell() {
    const shell = element('div', 'app-shell');
    shell.append(this.buildHeader());

    const workspace = element('div', 'workspace');
    workspace.append(this.buildDesktopNav());
    const main = element('main', 'screen-region', { id: 'client-screen', ariaLive: 'polite' });
    main.append(this.buildCurrentScreen());
    workspace.append(main);
    shell.append(workspace);
    shell.append(this.buildMobileNav());
    shell.append(element('div', 'toast-region', { ariaLive: 'polite', ariaAtomic: 'true' }));
    return shell;
  }

  buildHeader() {
    const header = element('header', 'app-header');
    const brand = element('div', 'app-brand');
    const mark = element('div', 'brand-mark', { ariaHidden: 'true' });
    mark.append(icon('Workflow', 19));
    brand.append(mark);
    const copy = element('div');
    copy.append(element('h1', '', { text: '设备运营' }));
    copy.append(element('p', '', { text: `${this.model.context.organizationName} / ${this.model.context.siteName}` }));
    brand.append(copy);
    header.append(brand);

    const actions = element('div', 'header-actions');
    actions.append(actionButton('连接设置', 'open-connection-settings', {
      className: 'button button--quiet button--small',
      iconName: 'Link'
    }));
    const health = connectionHealth(this.model.connectionHealth);
    const status = statusChip(accessRouteLabel(this.model.runtime.accessRoute), health.tone, health.icon === 'RefreshCw');
    status.classList.add('header-status');
    actions.append(status);
    header.append(actions);
    return header;
  }

  buildDesktopNav() {
    const nav = element('nav', 'primary-nav', { ariaLabel: '主导航' });
    nav.append(this.navButton('devices', '设备', 'Boxes'));
    nav.append(this.navButton('activity', '动态', 'Activity'));
    nav.append(this.navButton('add', '添加设备', 'Plus'));
    return nav;
  }

  buildMobileNav() {
    const nav = element('nav', 'bottom-nav', { ariaLabel: '主导航' });
    nav.append(this.navButton('devices', '设备', 'Boxes', true));
    nav.append(this.navButton('activity', '动态', 'Activity', true));
    nav.append(this.navButton('add', '添加', 'Plus', true));
    return nav;
  }

  navButton(screen, label, iconName, mobile = false) {
    const className = mobile ? 'nav-button' : 'desktop-nav-button';
    const button = actionButton(label, 'navigate', {
      className: `${className}${this.local.screen === screen ? ` ${className}--active` : ''}`,
      iconName,
      data: { screen },
      ariaLabel: label
    });
    return button;
  }

  buildCurrentScreen() {
    const screen = element('section', 'screen');
    const issue = this.model.error ?? this.local.transientError;
    if (issue) screen.append(this.buildNotice(issue, 'danger', 'dismiss-error'));

    switch (this.local.screen) {
      case 'add':
        screen.append(this.buildAddScreen());
        break;
      case 'ble':
        screen.append(this.buildBleScreen());
        break;
      case 'lan':
        screen.append(this.buildLanScreen());
        break;
      case 'detail':
        screen.append(this.buildDetailScreen());
        break;
      case 'activity':
        screen.append(this.buildActivityScreen());
        break;
      case 'connections':
        screen.append(this.buildConnectionSettingsScreen());
        break;
      case 'devices':
      default:
        screen.append(this.buildDeviceListScreen());
        break;
    }
    return screen;
  }

  buildDeviceListScreen() {
    const fragment = document.createDocumentFragment();
    fragment.append(screenHeading('我的设备', '查看当前站点已认领的设备。', actionButton('添加设备', 'open-add-device', {
      className: 'button button--primary',
      iconName: 'Plus'
    })));
    fragment.append(this.buildContextRow());

    if (this.model.runtime.stale && this.model.runtime.accessRoute !== 'BLE_LOCAL') {
      const lastSync = this.model.runtime.lastSyncedAt ? `，最后同步 ${formatDate(this.model.runtime.lastSyncedAt)}` : '';
      fragment.append(this.buildNotice(`缓存状态${lastSync}。平台恢复同步前设备控制保持只读。`, 'warning', null, '离线快照'));
    }

    const health = connectionHealth(this.model.connectionHealth);
    if (health.tone === 'warning' || health.tone === 'danger') {
      fragment.append(this.buildNotice(health.description, health.tone, 'reconnect-realtime', '连接状态'));
    }

    const devices = this.model.devices;
    const surface = element('section', 'surface', { ariaLabel: '设备列表' });
    if (devices.length === 0) {
      const empty = element('div', 'empty-state');
      const iconWrap = element('div', 'empty-state__icon', { ariaHidden: 'true' });
      iconWrap.append(icon('Boxes', 27));
      empty.append(iconWrap);
      empty.append(element('h3', '', { text: '还没有设备' }));
      empty.append(element('p', '', { text: '可先连接附近的蓝牙设备，或通过局域网模拟发现认领设备。' }));
      empty.append(actionButton('添加设备', 'open-add-device', {
        className: 'button button--primary',
        iconName: 'Plus'
      }));
      surface.append(empty);
    } else {
      const titleRow = element('div', 'surface-title-row');
      const titleGroup = element('div');
      titleGroup.append(element('h3', 'surface-title', { text: `已认领设备 (${devices.length})` }));
      titleGroup.append(element('p', 'surface-subtitle', { text: '状态以设备最近一次上报为准。' }));
      titleRow.append(titleGroup);
      titleRow.append(statusChip(`${onlineDeviceCount(devices)} 在线`, onlineDeviceCount(devices) ? 'success' : 'warning'));
      surface.append(titleRow);

      const list = element('div', 'device-list');
      devices.forEach((device) => list.append(this.buildDeviceRow(device)));
      surface.append(list);
    }
    fragment.append(surface);
    return fragment;
  }

  buildContextRow() {
    const row = element('section', 'context-row', { ariaLabel: '组织与站点上下文' });
    const location = element('div', 'context-row__location');
    location.append(icon('MapPin', 17));
    location.append(element('span', '', {
      text: `${this.model.context.organizationName} / ${this.model.context.siteName} / ${this.model.context.spaceName}`
    }));
    row.append(location);
    const health = connectionHealth(this.model.connectionHealth);
    row.append(statusChip(health.label, health.tone));
    return row;
  }

  buildDeviceRow(device) {
    const id = deviceKey(device);
    const online = deviceOnline(device, this.model.connectionHealth);
    const row = actionButton('', 'open-device', {
      className: 'device-row',
      data: { deviceId: id },
      ariaLabel: `打开设备 ${deviceName(device)}`
    });
    const deviceIcon = element('div', `device-icon${online ? '' : ' device-icon--offline'}`, { ariaHidden: 'true' });
    deviceIcon.append(icon(deviceIconName(device), 20));
    row.append(deviceIcon);

    const body = element('div', 'device-row__body');
    body.append(element('div', 'device-row__title', { text: deviceName(device) }));
    body.append(element('div', 'device-row__meta', { text: deviceMeta(device) }));
    row.append(body);

    const aside = element('div', 'device-row__aside');
    aside.append(statusChip(online ? '在线' : connectionStateLabel(getPrimaryConnection(device).status), online ? 'success' : 'warning'));
    aside.append(icon('ChevronRight', 17));
    row.append(aside);
    return row;
  }

  buildAddScreen() {
    const fragment = document.createDocumentFragment();
    fragment.append(screenHeading('添加设备', '选择设备可用的连接路径。', backButton('devices')));

    const choiceGrid = element('div', 'path-grid');
    choiceGrid.append(this.buildPathChoice(
      'ble',
      '蓝牙直连',
      this.model.ble.native ? '使用手机客户端扫描并连接附近的 BLE 设备。' : '使用当前浏览器选择并连接附近的 BLE 设备。',
      'Bluetooth'
    ));
    choiceGrid.append(this.buildPathChoice('lan', '局域网模拟发现', '从演示站点获取候选设备并认领到空间。', 'Network'));
    fragment.append(choiceGrid);

    fragment.append(this.buildNotice(
      '局域网发现由平台模拟；浏览器不会扫描局域网。实际扫描将由后续 Edge Agent 或原生客户端承接。',
      'info',
      null,
      '当前演示边界'
    ));
    return fragment;
  }

  buildPathChoice(path, title, description, iconName) {
    const button = actionButton('', 'choose-add-path', {
      className: 'path-choice',
      data: { path },
      ariaLabel: title
    });
    const iconWrap = element('div', `path-choice__icon${path === 'lan' ? ' path-choice__icon--lan' : ''}`, { ariaHidden: 'true' });
    iconWrap.append(icon(iconName, 22));
    button.append(iconWrap);
    const copy = element('div');
    copy.append(element('h3', '', { text: title }));
    copy.append(element('p', '', { text: description }));
    button.append(copy);
    button.append(icon('ChevronRight', 19));
    return button;
  }

  buildBleScreen() {
    const fragment = document.createDocumentFragment();
    fragment.append(screenHeading(
      '蓝牙直连',
      this.model.ble.native ? '使用手机客户端扫描附近设备。' : '从浏览器发起附近设备选择。',
      backButton('add')
    ));

    const ble = this.model.ble;
    const availability = ble.availability ?? ble.supported ?? ble.available;
    if (availability === false) {
      fragment.append(this.buildNotice(
        '当前浏览器不支持 Web Bluetooth。请使用 Android Chrome、桌面 Chrome 或 Edge；局域网模拟路径仍可使用。',
        'warning',
        'choose-lan',
        '无法使用蓝牙直连'
      ));
    }

    const surface = element('section', 'surface surface--padded');
    surface.append(surfaceHeading('设备选择', bleSelectionDescription(this.model.ble.native)));
    const candidate = ble.candidate ?? ble.device ?? this.model.activeConnection?.candidate ?? null;
    const connection = ble.connection ?? this.model.activeConnection ?? {};

    if (candidate) {
      surface.append(this.buildBleCandidate(candidate, connection));
      const profileId = connection.profileId ?? candidate.profileId ?? null;
      if (!profileId) {
        surface.append(this.buildNotice(
          '已识别为未知 GATT Profile。可以保留连接与查看通用信息，但不会显示未经定义的控制项。',
          'warning',
          null,
          '未知设备 Profile'
        ));
      }
      const connected = normalizeConnectionStatus(connection.status) === 'CONNECTED';
      surface.append(actionButton(connected ? '已连接' : '连接此设备', 'connect-ble', {
        className: 'button button--primary button--full',
        iconName: connected ? 'CircleCheck' : 'Link',
        disabled: connected || availability === false || this.isBusy('connect-ble')
      }));
    } else {
      const prompt = element('div', 'empty-inline', {
        text: this.model.ble.native
          ? '尚未发现蓝牙设备。扫描结果会显示在此处。'
          : '尚未选择蓝牙设备。蓝牙设备选择必须由此按钮的直接点击触发。'
      });
      surface.append(prompt);
      const requestLabel = this.model.ble.native ? '扫描附近设备' : '选择附近设备';
      surface.append(actionButton(this.isBusy('request-ble') ? '正在扫描…' : requestLabel, 'request-ble', {
        className: 'button button--primary button--full',
        iconName: 'BluetoothSearching',
        disabled: availability === false || this.isBusy('request-ble')
      }));
    }
    if (ble.errorCode === 'BLE_PERMISSION_DENIED') {
      surface.append(actionButton('前往应用设置', 'open-app-settings', { className: 'button button--secondary button--full' }));
    }
    if (ble.errorCode === 'BLE_DISABLED') {
      surface.append(actionButton('打开蓝牙设置', 'open-bluetooth-settings', { className: 'button button--secondary button--full' }));
    }
    fragment.append(surface);

    if (candidate) {
      const metadata = genericMetadata(candidate, connection);
      if (metadata.length) fragment.append(this.buildMetadataSurface(metadata));
    }
    return fragment;
  }

  buildBleCandidate(candidate, connection) {
    const summary = element('div', 'ble-device-summary');
    const iconWrap = element('div', 'ble-device-summary__icon', { ariaHidden: 'true' });
    iconWrap.append(icon('Bluetooth', 20));
    summary.append(iconWrap);
    const copy = element('div');
    copy.append(element('div', 'ble-device-summary__name', { text: deviceName(candidate) }));
    copy.append(element('div', 'ble-device-summary__meta', {
      text: String(candidate.id ?? candidate.deviceId ?? connection.deviceId ?? '浏览器本地设备标识')
    }));
    summary.append(copy);
    return summary;
  }

  buildLanScreen() {
    const fragment = document.createDocumentFragment();
    const discover = actionButton(this.isBusy('discover-lan') || isLoading(this.model, 'lanDiscovery') ? '发现中…' : '发现设备', 'discover-lan', {
      className: 'button button--primary',
      iconName: this.isBusy('discover-lan') || isLoading(this.model, 'lanDiscovery') ? 'LoaderCircle' : 'Radar',
      disabled: this.isBusy('discover-lan') || isLoading(this.model, 'lanDiscovery')
    });
    fragment.append(screenHeading('局域网模拟发现', '当前站点的可认领候选设备。', discover));
    fragment.append(this.buildContextRow());

    const candidates = this.model.lanCandidates;
    const surface = element('section', 'surface');
    const titleRow = element('div', 'surface-title-row');
    const titleGroup = element('div');
    titleGroup.append(element('h3', 'surface-title', { text: '候选设备' }));
    titleGroup.append(element('p', 'surface-subtitle', {
      text: candidates.length ? `发现 ${candidates.length} 台可认领设备。` : '尚未加载候选设备。'
    }));
    titleRow.append(titleGroup);
    surface.append(titleRow);

    if (isLoading(this.model, 'lanDiscovery') || this.isBusy('discover-lan')) {
      const loading = element('div', 'surface--padded');
      const row = element('div', 'loading-row');
      row.append(element('span', 'spinner', { ariaHidden: 'true' }));
      row.append(textNode('正在从模拟服务获取候选设备…'));
      loading.append(row);
      surface.append(loading);
    } else if (!candidates.length) {
      const empty = element('div', 'empty-state');
      const iconWrap = element('div', 'empty-state__icon', { ariaHidden: 'true' });
      iconWrap.append(icon('Radar', 27));
      empty.append(iconWrap);
      empty.append(element('h3', '', { text: '没有待认领设备' }));
      empty.append(element('p', '', { text: '开始发现后，模拟服务会返回当前站点中的可认领设备。' }));
      empty.append(actionButton('开始发现', 'discover-lan', {
        className: 'button button--primary',
        iconName: 'Radar'
      }));
      surface.append(empty);
    } else {
      const list = element('div', 'candidate-list');
      candidates.forEach((candidate) => list.append(this.buildCandidateRow(candidate)));
      surface.append(list);
    }
    fragment.append(surface);

    const selected = this.getSelectedCandidate();
    if (selected) fragment.append(this.buildClaimForm(selected));
    return fragment;
  }

  buildCandidateRow(candidate) {
    const candidateId = candidateKey(candidate);
    const row = actionButton('', 'select-candidate', {
      className: 'candidate-row',
      data: { candidateId },
      ariaLabel: `认领 ${candidateName(candidate)}`
    });
    const iconWrap = element('div', 'device-icon', { ariaHidden: 'true' });
    iconWrap.append(icon(deviceIconName(candidate), 20));
    row.append(iconWrap);
    const body = element('div', 'candidate-row__body');
    body.append(element('div', 'candidate-row__title', { text: candidateName(candidate) }));
    body.append(element('div', 'candidate-row__meta', { text: candidateMeta(candidate) }));
    row.append(body);
    const aside = element('div', 'candidate-row__aside');
    aside.append(statusChip('待认领', 'info'));
    aside.append(icon('ChevronRight', 17));
    row.append(aside);
    return row;
  }

  buildClaimForm(candidate) {
    const surface = element('section', 'surface surface--padded');
    surface.append(surfaceHeading('认领设备', '确认设备名称与所属空间后完成注册。'));
    surface.append(this.buildBleCandidate(candidate, { deviceId: candidateKey(candidate) }));

    const form = element('div', 'form-grid');
    form.append(this.textField('设备显示名称', 'claim-display-name', this.local.claim.displayName, '例如：装配工位照明', 'displayName'));
    form.append(this.textField('站点代码', 'claim-site-code', this.local.claim.siteCode, '演示环境使用 demo-site', 'siteCode'));
    form.append(this.textField('空间路径', 'claim-space-path', this.local.claim.spacePath, '/operations/field', 'spacePath'));
    const actions = element('div', 'form-actions');
    actions.append(actionButton('取消', 'cancel-claim', { className: 'button' }));
    actions.append(actionButton(this.isBusy('claim-lan') ? '认领中…' : '确认认领', 'claim-lan', {
      className: 'button button--primary',
      iconName: 'BadgeCheck',
      disabled: this.isBusy('claim-lan') || !this.local.claim.displayName.trim(),
      data: { candidateId: candidateKey(candidate) }
    }));
    form.append(actions);
    surface.append(form);
    return surface;
  }

  textField(label, id, value, hint, field) {
    const wrapper = element('div', 'field');
    wrapper.append(element('label', '', { text: label, htmlFor: id }));
    const input = element('input', 'input', {
      id,
      type: 'text',
      value,
      autocomplete: 'off',
      data: { field },
      ariaDescribedby: `${id}-hint`
    });
    wrapper.append(input);
    wrapper.append(element('p', 'field__hint', { id: `${id}-hint`, text: hint }));
    return wrapper;
  }

  buildConnectionSettingsScreen() {
    const fragment = document.createDocumentFragment();
    fragment.append(screenHeading('连接设置', '切换现场或互联网平台连接。', backButton('devices')));
    const surface = element('section', 'surface surface--padded');
    const modes = element('div', 'segmented-control', { role: 'group', ariaLabel: '平台连接方式' });
    for (const [route, label] of [['SITE_API', '现场 LAN'], ['CLOUD_API', '互联网远程']]) {
      modes.append(actionButton(label, 'choose-endpoint-route', {
        className: `segment${this.local.endpointDraft.accessRoute === route ? ' segment--active' : ''}`,
        data: { route }
      }));
    }
    surface.append(modes);
    surface.append(this.textField('API 地址', 'endpoint-api-url', this.local.endpointDraft.apiBaseUrl, '例如：http://10.0.0.8:8080/api', 'endpointApiUrl'));
    surface.append(this.textField('WebSocket 地址', 'endpoint-ws-url', this.local.endpointDraft.wsUrl, '例如：ws://10.0.0.8:8080/ws/devices', 'endpointWsUrl'));
    surface.append(actionButton(this.isBusy('test-endpoint') ? '测试中…' : '测试连接', 'test-endpoint', {
      className: 'button button--secondary',
      disabled: this.isBusy('test-endpoint') || this.isBusy('switch-endpoint')
    }));
    if (this.local.endpointTest) {
      surface.append(this.buildNotice(
        this.local.endpointTest.message,
        this.local.endpointTest.ok ? 'success' : 'danger',
        null,
        this.local.endpointTest.ok ? '连接正常' : '连接失败'
      ));
    }
    surface.append(actionButton(this.isBusy('switch-endpoint') ? '切换中…' : '保存并切换', 'save-endpoint', {
      className: 'button button--primary',
      disabled: this.isBusy('switch-endpoint')
    }));
    fragment.append(surface);
    return fragment;
  }

  buildDetailScreen() {
    const device = this.getActiveDevice();
    if (!device) return this.buildMissingDetail();

    const fragment = document.createDocumentFragment();
    const connection = getPrimaryConnection(device, this.model.activeConnection);
    const online = deviceOnline(device, this.model.connectionHealth);
    const header = element('div', 'detail-heading');
    const title = element('div', 'detail-heading__title');
    title.append(backButton('devices'));
    const copy = element('div');
    copy.append(element('h2', '', { text: deviceName(device) }));
    copy.append(element('p', '', { text: deviceMeta(device) }));
    title.append(copy);
    header.append(title);
    header.append(statusChip(online ? '在线' : connectionStateLabel(connection.status), online ? 'success' : 'warning'));
    fragment.append(header);

    const screenState = deviceScreenState(device, this.model.runtime);
    if (screenState.unknownBleProfile) {
      fragment.append(this.buildNotice(screenState.notice, 'warning', null, '安全控制已关闭'));
    }

    const layout = element('div', 'detail-layout');
    const main = element('div', 'detail-layout__main');
    main.append(this.buildConnectionSurface(device, connection));
    main.append(this.buildStateSurface(device));
    main.append(this.buildControlsSurface(device, screenState));
    layout.append(main);

    const aside = element('div', 'detail-layout__aside');
    aside.append(this.buildCommandSurface(device));
    aside.append(this.buildActivitySurface(device, 6));
    layout.append(aside);

    const metadata = genericMetadata(device, connection);
    if (metadata.length) {
      const extra = this.buildMetadataSurface(metadata);
      extra.classList.add('detail-layout__full');
      layout.append(extra);
    }
    fragment.append(layout);
    return fragment;
  }

  buildMissingDetail() {
    const wrapper = element('div', 'empty-state surface');
    const iconWrap = element('div', 'empty-state__icon', { ariaHidden: 'true' });
    iconWrap.append(icon('SearchX', 27));
    wrapper.append(iconWrap);
    wrapper.append(element('h3', '', { text: '未找到设备' }));
    wrapper.append(element('p', '', { text: '设备可能已被移除，或当前列表尚未同步。' }));
    wrapper.append(actionButton('返回设备列表', 'navigate', {
      className: 'button button--primary',
      data: { screen: 'devices' },
      iconName: 'ArrowLeft'
    }));
    return wrapper;
  }

  buildConnectionSurface(device, connection) {
    const surface = element('section', 'surface surface--padded');
    surface.append(surfaceHeading('连接状态', '设备控制结果需要由连接回执确认。'));
    const summary = element('div', 'connection-summary');
    const top = element('div', 'connection-summary__top');
    const route = element('div', 'connection-summary__route');
    route.append(icon(connectionIcon(connection.transport), 17));
    const routeValue = device.localOnly ? 'BLE_LOCAL' : this.model.runtime.accessRoute;
    route.append(textNode(`${accessRouteLabel(routeValue)} / ${deviceTransportLabel(connection.transport)}`));
    top.append(route);
    const normalized = normalizeConnectionStatus(connection.status ?? device.status);
    top.append(statusChip(connectionStateLabel(normalized), connectionTone(normalized)));
    summary.append(top);
    summary.append(element('div', 'connection-summary__meta', {
      text: connectionDetail(connection, this.model.connectionHealth)
    }));
    const health = connectionHealth(this.model.connectionHealth);
    if (health.tone === 'warning' || health.tone === 'danger') {
      summary.append(actionButton('重新连接实时事件', 'reconnect-realtime', {
        className: 'button button--small',
        iconName: 'RefreshCw',
        disabled: this.isBusy('reconnect-realtime')
      }));
    }
    surface.append(summary);
    return surface;
  }

  buildStateSurface(device) {
    const surface = element('section', 'surface surface--padded');
    surface.append(surfaceHeading('设备状态', '期望状态不会覆盖设备已上报的真实状态。'));
    const comparison = element('div', 'state-comparison');
    comparison.append(this.buildStatePanel('期望状态', device.desiredState ?? {}, 'desired'));
    comparison.append(this.buildStatePanel('已上报状态', device.reportedState ?? device.state ?? {}, 'reported'));
    surface.append(comparison);
    return surface;
  }

  buildStatePanel(title, state, kind) {
    const panel = element('section', 'state-panel');
    const titleRow = element('h4', `state-panel__title state-panel__title--${kind}`);
    titleRow.append(icon(kind === 'desired' ? 'Target' : 'RadioTower', 15));
    titleRow.append(textNode(title));
    panel.append(titleRow);
    const list = element('div', 'state-list');
    const entries = Object.entries(plainObject(state));
    if (!entries.length) {
      list.append(element('div', 'state-empty', { text: '暂无数据' }));
    } else {
      entries.slice(0, 8).forEach(([key, value]) => {
        const row = element('div', 'state-row');
        row.append(element('span', 'state-row__key', { text: stateLabel(key) }));
        row.append(element('span', 'state-row__value', { text: stateValue(value) }));
        list.append(row);
      });
    }
    panel.append(list);
    return panel;
  }

  buildControlsSurface(device, screenState) {
    const surface = element('section', 'surface surface--padded');
    surface.append(surfaceHeading('设备控制', '控制命令会先进入待发送状态，确认后才更新上报状态。'));

    if (!screenState.showControls) {
      const notice = element('div', 'capability-note');
      notice.append(icon('ShieldAlert', 17));
      notice.append(textNode(screenState.notice));
      surface.append(notice);
      return surface;
    }

    const latestCommand = this.latestCommand(device);
    const pending = latestCommand && ['PENDING', 'SENT'].includes(normalizeCommandStatus(latestCommand.status));
    const controls = element('div', 'control-list');
    screenState.controls.forEach((capability) => {
      if (capability.id === 'power') controls.append(this.buildPowerControl(device, capability, pending));
      if (capability.id === 'level') controls.append(this.buildLevelControl(device, capability, pending));
      if (capability.id === 'mode') controls.append(this.buildModeControl(device, capability, pending));
    });
    surface.append(controls);
    if (pending) {
      const note = element('div', 'capability-note');
      note.append(element('span', 'spinner', { ariaHidden: 'true' }));
      note.append(textNode('等待设备命令回执，当前控件暂时保持只读。'));
      surface.append(note);
    }
    return surface;
  }

  buildPowerControl(device, capability, disabled) {
    const reported = plainObject(device.reportedState ?? device.state);
    const desired = plainObject(device.desiredState);
    const current = Boolean(desired.power ?? reported.power ?? false);
    const row = element('div', 'control-row');
    const heading = element('div', 'control-row__heading');
    const copy = element('div');
    copy.append(element('h4', '', { text: capability.label ?? '电源' }));
    copy.append(element('p', '', { text: current ? '目标：开启' : '目标：关闭' }));
    heading.append(copy);
    heading.append(actionButton('', 'command-power', {
      className: `switch-button${current ? ' switch-button--on' : ''}`,
      data: { deviceId: deviceKey(device), commandType: capability.commandType ?? 'set_power', nextValue: String(!current) },
      ariaLabel: current ? '关闭电源' : '开启电源',
      disabled
    }));
    row.append(heading);
    return row;
  }

  buildLevelControl(device, capability, disabled) {
    const reported = plainObject(device.reportedState ?? device.state);
    const desired = plainObject(device.desiredState);
    const stored = this.local.commandValues[`level:${deviceKey(device)}`];
    const value = clampNumber(stored ?? desired.level ?? desired.brightness ?? reported.level ?? reported.brightness ?? 0, 0, 100);
    const row = element('div', 'control-row');
    const heading = element('div', 'control-row__heading');
    const copy = element('div');
    copy.append(element('h4', '', { text: capability.label ?? '强度' }));
    copy.append(element('p', '', { text: '拖动后松开以发送新命令。' }));
    heading.append(copy);
    row.append(heading);
    const rangeRow = element('div', 'range-row');
    rangeRow.append(element('input', 'range-input', {
      type: 'range',
      min: '0',
      max: '100',
      step: '1',
      value: String(value),
      disabled,
      data: { deviceId: deviceKey(device), commandType: capability.commandType ?? 'set_level', field: 'level' },
      ariaLabel: `${capability.label ?? '强度'} ${value}%`
    }));
    rangeRow.append(element('output', 'range-value', { text: `${value}%` }));
    row.append(rangeRow);
    return row;
  }

  buildModeControl(device, capability, disabled) {
    const options = arrayOf(capability.options ?? capability.values ?? device.modeOptions);
    const reported = plainObject(device.reportedState ?? device.state);
    const desired = plainObject(device.desiredState);
    const current = String(desired.mode ?? reported.mode ?? '');
    const row = element('div', 'control-row');
    const heading = element('div', 'control-row__heading');
    const copy = element('div');
    copy.append(element('h4', '', { text: capability.label ?? '模式' }));
    copy.append(element('p', '', { text: options.length ? '选择一个设备提供的运行模式。' : '设备没有提供可选模式。' }));
    heading.append(copy);
    row.append(heading);
    if (!options.length) return row;

    const grid = element('div', 'mode-grid');
    options.slice(0, 6).forEach((option) => {
      const value = String(option?.value ?? option?.id ?? option);
      const label = String(option?.label ?? option?.name ?? option);
      grid.append(actionButton(label, 'command-mode', {
        className: `mode-button${value === current ? ' mode-button--selected' : ''}`,
        data: { deviceId: deviceKey(device), commandType: capability.commandType ?? 'set_mode', value },
        disabled,
        ariaLabel: `设置模式为 ${label}`
      }));
    });
    row.append(grid);
    return row;
  }

  buildCommandSurface(device) {
    const surface = element('section', 'surface surface--padded');
    surface.append(surfaceHeading('最近命令', '每次操作均可追踪到回执结果。'));
    const command = this.latestCommand(device);
    if (!command) {
      surface.append(element('p', 'empty-inline', { text: '当前设备还没有命令记录。' }));
      return surface;
    }

    const card = element('div', 'command-card');
    const row = element('div', 'command-card__row');
    const copy = element('div');
    copy.append(element('h4', 'command-card__title', { text: commandLabel(command) }));
    copy.append(element('p', 'command-card__meta', { text: commandTimestamp(command) }));
    row.append(copy);
    row.append(statusChip(commandStatusLabel(command.status), commandTone(command.status), ['PENDING', 'SENT'].includes(normalizeCommandStatus(command.status))));
    card.append(row);
    const reason = command.failureReason ?? command.error ?? command.message;
    if (reason && normalizeCommandStatus(command.status) === 'FAILED') {
      card.append(element('p', 'command-card__error', { text: String(reason) }));
      card.append(actionButton('重试命令', 'retry-command', {
        className: 'button button--small button--danger',
        iconName: 'RotateCcw',
        data: { commandId: commandKey(command), deviceId: deviceKey(device) },
        disabled: this.isBusy('retry-command')
      }));
    }
    surface.append(card);
    return surface;
  }

  buildActivitySurface(device, limit) {
    const surface = element('section', 'surface surface--padded');
    const heading = surfaceHeading('近期动态', '连接、命令与回执会保留在本地时间线。');
    const openAll = actionButton('查看全部', 'navigate', {
      className: 'button button--quiet button--small',
      data: { screen: 'activity' },
      iconName: 'ArrowRight'
    });
    heading.append(openAll);
    surface.append(heading);
    const activities = this.activitiesForDevice(device).slice(0, limit);
    if (!activities.length) {
      surface.append(element('p', 'empty-inline', { text: '暂无活动记录。' }));
      return surface;
    }
    const timeline = element('div', 'timeline');
    activities.forEach((activity) => timeline.append(activityTimelineItem(activity)));
    surface.append(timeline);
    return surface;
  }

  buildMetadataSurface(metadata) {
    const surface = element('section', 'surface surface--padded');
    surface.append(surfaceHeading('通用信息', '这些信息不表示该设备支持控制命令。'));
    const list = element('div', 'state-list');
    metadata.slice(0, 8).forEach(([key, value]) => {
      const row = element('div', 'state-row');
      row.append(element('span', 'state-row__key', { text: stateLabel(key) }));
      row.append(element('span', 'state-row__value', { text: stateValue(value) }));
      list.append(row);
    });
    surface.append(list);
    return surface;
  }

  buildActivityScreen() {
    const fragment = document.createDocumentFragment();
    fragment.append(screenHeading('现场动态', '来自本地连接与模拟平台的最新活动。'));
    const surface = element('section', 'surface surface--padded');
    const activities = allActivities(this.model);
    if (!activities.length) {
      const empty = element('div', 'empty-state');
      const iconWrap = element('div', 'empty-state__icon', { ariaHidden: 'true' });
      iconWrap.append(icon('Activity', 27));
      empty.append(iconWrap);
      empty.append(element('h3', '', { text: '暂无现场动态' }));
      empty.append(element('p', '', { text: '连接设备、认领局域网候选设备或发送命令后，活动会显示在这里。' }));
      surface.append(empty);
    } else {
      const list = element('div', 'activity-list');
      activities.slice(0, 30).forEach((activity) => list.append(activityTimelineItem(activity)));
      surface.append(list);
    }
    fragment.append(surface);
    return fragment;
  }

  buildNotice(message, tone = 'info', action = null, title = null) {
    const notice = element('section', `notice notice--${tone}`, { role: tone === 'danger' ? 'alert' : 'status' });
    notice.append(icon(tone === 'danger' ? 'CircleAlert' : tone === 'warning' ? 'TriangleAlert' : tone === 'success' ? 'CircleCheck' : 'Info', 18));
    const body = element('div', 'notice__body');
    if (title) body.append(element('strong', '', { text: title }));
    body.append(element('p', '', { text: errorMessage(message) }));
    notice.append(body);
    if (action === 'dismiss-error') {
      notice.append(actionButton('', 'dismiss-error', { className: 'icon-button', iconName: 'X', ariaLabel: '关闭提示' }));
    } else if (action) {
      notice.append(actionButton('重连', action, { className: 'button button--small', iconName: 'RefreshCw', disabled: this.isBusy(action) }));
    }
    return notice;
  }

  getActiveDevice() {
    const desired = this.model.activeDeviceId ?? this.model.activeConnection?.deviceId;
    if (desired != null) {
      const matched = this.model.devices.find((device) => matchesDeviceReference(device, desired));
      if (matched) return matched;
    }
    return null;
  }

  getSelectedCandidate() {
    if (!this.local.selectedCandidateId) return null;
    return this.model.lanCandidates.find((candidate) => sameKey(candidateKey(candidate), this.local.selectedCandidateId)) ?? null;
  }

  activitiesForDevice(device) {
    const key = deviceKey(device);
    const deviceId = String(device.deviceId ?? key);
    const publicId = String(device.publicId ?? '');
    const scoped = this.model.activitiesByDeviceId[key]
      ?? this.model.activitiesByDeviceId[deviceId]
      ?? this.model.activitiesByDeviceId[publicId]
      ?? [];
    const fallback = this.model.activities.filter((activity) => activityMatchesDevice(activity, key, deviceId));
    return uniqueActivities([...arrayOf(scoped), ...fallback]);
  }

  latestCommand(device) {
    const id = deviceKey(device);
    const deviceId = String(device.deviceId ?? id);
    return this.model.commands
      .filter((command) => activityMatchesDevice(command, id, deviceId))
      .sort((left, right) => commandTime(right) - commandTime(left))[0] ?? null;
  }

  isBusy(action) {
    return this.local.busyActions.has(action);
  }

  onClick(event) {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!target || !this.root.contains(target) || target.disabled) return;
    const action = target.dataset.action;
    if (!action) return;
    event.preventDefault();

    switch (action) {
      case 'navigate':
        this.local.screen = target.dataset.screen ?? 'devices';
        this.invoke('setTab', { screen: this.local.screen });
        this.render(this.model);
        break;
      case 'open-add-device':
        this.local.screen = 'add';
        this.invoke('openAddDevice');
        this.render(this.model);
        break;
      case 'choose-add-path':
        this.choosePath(target.dataset.path);
        break;
      case 'choose-lan':
        this.choosePath('lan');
        break;
      case 'request-ble':
        this.invoke('requestBle', {}, { busy: 'request-ble' });
        break;
      case 'connect-ble':
        this.invoke('connectBle', {}, { busy: 'connect-ble' });
        break;
      case 'discover-lan':
        this.invoke('discoverLan', { siteCode: this.model.context.siteCode }, { busy: 'discover-lan' });
        break;
      case 'select-candidate':
        this.selectCandidate(target.dataset.candidateId);
        break;
      case 'cancel-claim':
        this.local.selectedCandidateId = null;
        this.render(this.model);
        break;
      case 'claim-lan':
        this.claimCandidate(target.dataset.candidateId);
        break;
      case 'open-device':
        this.openDevice(target.dataset.deviceId);
        break;
      case 'command-power':
        this.sendCommand(target.dataset.deviceId, target.dataset.commandType, { on: target.dataset.nextValue === 'true' }, 'command-power');
        break;
      case 'command-mode':
        this.sendCommand(target.dataset.deviceId, target.dataset.commandType, { mode: target.dataset.value }, 'command-mode');
        break;
      case 'retry-command':
        this.invoke('retryCommand', { commandId: target.dataset.commandId, deviceId: target.dataset.deviceId }, { busy: 'retry-command' });
        break;
      case 'reconnect-realtime':
        this.invoke('reconnectRealtime', {}, { busy: 'reconnect-realtime' });
        break;
      case 'open-connection-settings':
        this.local.endpointDraft = {
          accessRoute: this.model.runtime.accessRoute ?? 'SITE_API',
          apiBaseUrl: this.model.endpointProfile?.apiBaseUrl ?? '',
          wsUrl: this.model.endpointProfile?.wsUrl ?? ''
        };
        this.local.endpointTest = null;
        this.local.screen = 'connections';
        this.render(this.model);
        break;
      case 'choose-endpoint-route':
        this.local.endpointDraft.accessRoute = target.dataset.route;
        this.render(this.model);
        break;
      case 'test-endpoint':
        this.invoke('testEndpoint', {
          accessRoute: this.local.endpointDraft.accessRoute,
          apiBaseUrl: this.local.endpointDraft.apiBaseUrl,
          wsUrl: this.local.endpointDraft.wsUrl
        }, {
          busy: 'test-endpoint',
          onResolved: (result) => {
            this.local.endpointTest = result;
          }
        });
        break;
      case 'save-endpoint':
        this.invoke('switchEndpoint', {
          id: this.local.endpointDraft.accessRoute === 'SITE_API' ? 'site' : 'cloud',
          accessRoute: this.local.endpointDraft.accessRoute,
          apiBaseUrl: this.local.endpointDraft.apiBaseUrl,
          wsUrl: this.local.endpointDraft.wsUrl,
          organizationCode: this.model.context.organizationCode
        }, { busy: 'switch-endpoint' });
        break;
      case 'open-app-settings':
        this.invoke('openBleAppSettings');
        break;
      case 'open-bluetooth-settings':
        this.invoke('openBluetoothSettings');
        break;
      case 'dismiss-error':
        this.local.transientError = null;
        this.invoke('dismissError');
        this.render({ ...this.model, error: null });
        break;
      default:
        break;
    }
  }

  onInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !this.root.contains(target)) return;
    const field = target.dataset.field;
    if (field === 'displayName' || field === 'siteCode' || field === 'spacePath') {
      this.local.claim[field] = target.value;
      return;
    }
    if (field === 'endpointApiUrl') this.local.endpointDraft.apiBaseUrl = target.value;
    if (field === 'endpointWsUrl') this.local.endpointDraft.wsUrl = target.value;
    if (field === 'level') {
      const key = `level:${target.dataset.deviceId}`;
      this.local.commandValues[key] = clampNumber(target.value, 0, 100);
      const output = target.parentElement?.querySelector('output');
      if (output) output.textContent = `${this.local.commandValues[key]}%`;
    }
  }

  onChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !this.root.contains(target)) return;
    if (target.dataset.field === 'level') {
      const value = clampNumber(target.value, 0, 100);
      this.sendCommand(target.dataset.deviceId, target.dataset.commandType, { level: value }, 'command-level');
    }
  }

  choosePath(path) {
    this.local.screen = path === 'ble' ? 'ble' : 'lan';
    this.invoke('chooseAddPath', { path });
    this.render(this.model);
  }

  selectCandidate(candidateId) {
    const candidate = this.model.lanCandidates.find((item) => sameKey(candidateKey(item), candidateId));
    if (!candidate) return;
    this.local.selectedCandidateId = candidateId;
    this.local.claim.displayName = candidateName(candidate);
    this.local.claim.siteCode = this.model.context.siteCode;
    this.local.claim.spacePath = this.model.context.spacePath;
    this.invoke('selectLanCandidate', { candidate });
    this.render(this.model);
  }

  claimCandidate(candidateId) {
    const payload = {
      candidateId,
      displayName: this.local.claim.displayName.trim(),
      siteCode: this.local.claim.siteCode.trim(),
      spacePath: this.local.claim.spacePath.trim()
    };
    if (!payload.displayName) {
      this.local.transientError = '请填写设备显示名称后再认领。';
      this.render(this.model);
      return;
    }
    this.invoke('claimLan', payload, {
      busy: 'claim-lan',
      onResolved: () => {
        this.local.selectedCandidateId = null;
        this.local.screen = 'devices';
      }
    });
  }

  openDevice(deviceId) {
    this.local.screen = 'detail';
    this.invoke('openDevice', { deviceId });
    this.render({ ...this.model, activeDeviceId: deviceId });
  }

  sendCommand(deviceId, type, parameters, busy) {
    if (!deviceId || !type) return;
    this.invoke('sendCommand', { deviceId, type, parameters }, { busy });
  }

  invoke(name, payload = {}, options = {}) {
    const handler = this.handlers[name];
    if (typeof handler !== 'function') return undefined;
    const busy = options.busy;
    if (busy) {
      this.local.busyActions.add(busy);
      this.render(this.model);
    }
    try {
      // This call is intentionally synchronous so Web Bluetooth retains its user gesture.
      const result = handler(payload, { screen: this.local.screen, viewModel: this.model });
      if (result && typeof result.then === 'function') {
        result
          .then((value) => options.onResolved?.(value))
          .catch((error) => {
            this.local.transientError = errorMessage(error);
            options.onRejected?.(error);
          })
          .finally(() => {
            if (busy) this.local.busyActions.delete(busy);
            this.render(this.model);
          });
      } else {
        options.onResolved?.(result);
        if (busy) this.local.busyActions.delete(busy);
        this.render(this.model);
      }
      return result;
    } catch (error) {
      if (busy) this.local.busyActions.delete(busy);
      this.local.transientError = errorMessage(error);
      this.render(this.model);
      return undefined;
    }
  }
}

function normalizeViewModel(viewModel) {
  const source = plainObject(viewModel.state ?? viewModel);
  const contextSource = plainObject(source.context ?? source.organizationContext ?? {});
  const context = {
    organizationName: String(contextSource.organizationName ?? contextSource.organization?.name ?? source.organizationName ?? DEFAULT_CONTEXT.organizationName),
    organizationCode: String(contextSource.organizationCode ?? contextSource.organization?.code ?? source.organizationCode ?? DEFAULT_CONTEXT.organizationCode),
    siteName: String(contextSource.siteName ?? contextSource.site?.name ?? source.siteName ?? DEFAULT_CONTEXT.siteName),
    siteCode: String(contextSource.siteCode ?? contextSource.site?.code ?? source.siteCode ?? DEFAULT_CONTEXT.siteCode),
    spaceName: String(contextSource.spaceName ?? contextSource.space?.name ?? source.spaceName ?? '现场空间'),
    spacePath: String(contextSource.spacePath ?? contextSource.space?.path ?? source.spacePath ?? DEFAULT_CONTEXT.spacePath)
  };
  const discovery = plainObject(source.discovery ?? source.lanDiscovery ?? {});
  const commandsById = source.commandsById ?? source.commands ?? {};
  const activitiesByDeviceId = source.activitiesByDeviceId ?? {};

  return {
    context,
    devices: arrayOf(source.devices),
    activeDeviceId: source.activeDeviceId ?? source.currentDeviceId ?? source.currentDevice?.id ?? null,
    activeConnection: source.activeConnection ?? source.connection ?? null,
    connectionHealth: source.connectionHealth ?? source.realtime?.health ?? source.wsHealth ?? null,
    runtime: plainObject(source.runtime),
    endpointProfile: plainObject(source.endpointProfile),
    commands: objectValues(commandsById),
    activitiesByDeviceId: plainObject(activitiesByDeviceId),
    activities: arrayOf(source.activities ?? source.activity),
    lanCandidates: arrayOf(source.lanCandidates ?? discovery.candidates ?? discovery.lanCandidates),
    ble: plainObject(source.ble ?? source.bleState ?? {}),
    loading: plainObject(source.loading ?? source.loadingState ?? {}),
    error: source.error ?? source.lastError ?? null
  };
}

function getPrimaryConnection(device = {}, activeConnection = null) {
  const connections = arrayOf(device.connections);
  const preferred = device.connection ?? connections.find((connection) => connection.primary) ?? connections[0] ?? null;
  if (preferred) return plainObject(preferred);
  if (activeConnection && sameKey(activeConnection.deviceId ?? activeConnection.id, deviceKey(device))) return plainObject(activeConnection);
  return {};
}

function normalizeCapabilities(capabilities) {
  return arrayOf(capabilities)
    .map((raw) => {
      const source = typeof raw === 'string' ? { id: raw } : plainObject(raw);
      const original = String(source.id ?? source.type ?? source.name ?? '').trim().toLowerCase();
      const id = CAPABILITY_ALIASES[original] ?? original;
      return {
        ...source,
        id,
        label: source.label ?? source.displayName ?? capabilityLabel(id),
        commandType: source.commandType ?? source.command ?? null,
        options: source.options ?? source.values ?? null
      };
    })
    .filter((capability) => capability.id && capability.enabled !== false && capability.writable !== false);
}

function capabilityList(value) {
  if (Array.isArray(value)) return value;
  const source = plainObject(value);
  return arrayOf(source.controls ?? source.capabilities);
}

function connectionHealth(value) {
  const source = plainObject(value);
  const raw = String(source.status ?? source.state ?? value ?? '').toUpperCase();
  if (source.error || source.stale === true) {
    return {
      label: source.error ? '实时连接异常' : '状态可能过期',
      tone: source.error ? 'danger' : 'warning',
      icon: 'CircleAlert',
      description: source.error
        ? `实时事件连接异常：${errorMessage(source.error)}`
        : '实时事件尚未连接或已中断，设备状态可能不是最新。'
    };
  }
  if (['CONNECTED', 'ONLINE', 'HEALTHY', 'OPEN'].includes(raw)) {
    return { label: '实时已连接', tone: 'success', icon: 'RadioTower', description: '实时事件连接正常，设备状态会持续同步。' };
  }
  if (['CONNECTING', 'RECONNECTING'].includes(raw)) {
    return { label: '正在重连', tone: 'warning', icon: 'RefreshCw', description: '实时事件正在重新连接，当前状态可能不是最新。' };
  }
  if (['STALE', 'OFFLINE', 'DISCONNECTED', 'CLOSED', 'ERROR', 'FAILED'].includes(raw)) {
    return { label: '状态可能过期', tone: 'danger', icon: 'CircleAlert', description: '实时事件连接不可用，设备状态可能已经过期。' };
  }
  return { label: '等待同步', tone: 'info', icon: 'Clock3', description: '正在等待设备连接与状态同步。' };
}

function statusChip(label, tone = 'info', spinning = false) {
  const chip = element('span', `status-chip status-chip--${tone}`);
  if (spinning) chip.append(element('span', 'spinner', { ariaHidden: 'true' }));
  else chip.append(element('span', 'status-dot', { ariaHidden: 'true' }));
  chip.append(textNode(label));
  return chip;
}

function screenHeading(title, description, action = null) {
  const heading = element('div', 'screen-heading');
  const copy = element('div');
  copy.append(element('h2', '', { text: title }));
  if (description) copy.append(element('p', '', { text: description }));
  heading.append(copy);
  if (action) heading.append(action);
  return heading;
}

function surfaceHeading(title, subtitle) {
  const heading = element('div', 'surface-title-row');
  const group = element('div');
  group.append(element('h3', 'surface-title', { text: title }));
  if (subtitle) group.append(element('p', 'surface-subtitle', { text: subtitle }));
  heading.append(group);
  return heading;
}

function backButton(screen) {
  return actionButton('', 'navigate', {
    className: 'icon-button',
    iconName: 'ArrowLeft',
    data: { screen },
    ariaLabel: '返回'
  });
}

function actionButton(label, action, options = {}) {
  const button = element('button', options.className ?? 'button', {
    type: options.type ?? 'button',
    disabled: options.disabled === true,
    ariaLabel: options.ariaLabel,
    title: options.title
  });
  button.dataset.action = action;
  Object.entries(options.data ?? {}).forEach(([key, value]) => {
    if (value != null) button.dataset[key] = String(value);
  });
  if (options.iconName) button.append(icon(options.iconName, options.iconSize ?? 17));
  if (label) button.append(element('span', '', { text: label }));
  return button;
}

function activityTimelineItem(activity) {
  const kind = activityKind(activity);
  const item = element('article', 'timeline-item');
  const marker = element('div', `timeline-item__marker timeline-item__marker--${kind.tone}`, { ariaHidden: 'true' });
  marker.append(icon(kind.icon, 14));
  item.append(marker);
  const content = element('div', 'timeline-item__content');
  content.append(element('div', 'timeline-item__title', { text: activityTitle(activity) }));
  const description = activityDescription(activity);
  if (description) content.append(element('p', 'timeline-item__description', { text: description }));
  content.append(element('p', 'timeline-item__time', { text: activityTimestamp(activity) }));
  item.append(content);
  return item;
}

function icon(name, size = 18) {
  const definition = icons[name] ?? icons.CircleHelp ?? icons.Circle;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (Array.isArray(definition)) {
    definition.forEach(([tag, attributes]) => {
      const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attributes).forEach(([key, value]) => child.setAttribute(key, String(value)));
      svg.append(child);
    });
  }
  return svg;
}

function element(tag, className = '', attributes = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.entries(attributes).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === 'text') node.textContent = String(value);
    else if (key === 'className') node.className = String(value);
    else if (key === 'htmlFor') node.htmlFor = String(value);
    else if (key === 'ariaLabel') node.setAttribute('aria-label', String(value));
    else if (key === 'ariaLive') node.setAttribute('aria-live', String(value));
    else if (key === 'ariaAtomic') node.setAttribute('aria-atomic', String(value));
    else if (key === 'ariaDescribedby') node.setAttribute('aria-describedby', String(value));
    else if (key === 'ariaHidden') node.setAttribute('aria-hidden', String(value));
    else if (key === 'data') {
      Object.entries(plainObject(value)).forEach(([dataKey, dataValue]) => {
        if (dataValue != null) node.dataset[dataKey] = String(dataValue);
      });
    } else if (key in node) {
      node[key] = value;
    } else {
      node.setAttribute(key, String(value));
    }
  });
  return node;
}

function textNode(value) {
  return document.createTextNode(String(value ?? ''));
}

function deviceKey(device = {}) {
  return String(device.id ?? device.deviceId ?? device.publicId ?? '');
}

function candidateKey(candidate = {}) {
  return String(candidate.candidateId ?? candidate.id ?? candidate.deviceId ?? '');
}

function commandKey(command = {}) {
  return String(command.commandId ?? command.id ?? '');
}

function deviceName(device = {}) {
  return String(device.displayName ?? device.name ?? device.deviceName ?? device.deviceId ?? '未命名设备');
}

function candidateName(candidate = {}) {
  return String(candidate.displayName ?? candidate.name ?? candidate.deviceName ?? candidate.deviceId ?? candidateKey(candidate) ?? '未命名候选设备');
}

function deviceMeta(device) {
  const connection = getPrimaryConnection(device);
  const location = device.space?.name ?? device.spaceName ?? device.spacePath ?? '';
  return [connectionLabel(connection.transport), location].filter(Boolean).join(' / ') || '连接信息等待同步';
}

function candidateMeta(candidate) {
  const location = candidate.ipAddress ?? candidate.host ?? candidate.address ?? candidate.model ?? '';
  const profile = candidate.profileId ?? candidate.profile ?? candidate.type ?? '';
  return [profile, location].filter(Boolean).join(' / ') || '局域网模拟候选设备';
}

function deviceOnline(device, health) {
  const connection = getPrimaryConnection(device);
  const state = normalizeConnectionStatus(connection.status ?? device.status ?? device.online);
  if (state === 'CONNECTED' || state === 'ONLINE') return true;
  return false;
}

function onlineDeviceCount(devices) {
  return devices.filter((device) => deviceOnline(device)).length;
}

function normalizeTransport(value) {
  const raw = String(value ?? '').toUpperCase();
  if (raw.includes('BLE') || raw.includes('BLUETOOTH')) return 'BLE_DIRECT';
  if (raw.includes('LAN') || raw.includes('AGENT') || raw.includes('HTTP') || raw.includes('MQTT')) return 'LAN_AGENT';
  return raw || 'UNKNOWN';
}

function connectionLabel(value) {
  const transport = normalizeTransport(value);
  if (transport === 'BLE_DIRECT') return '蓝牙直连';
  if (transport === 'LAN_AGENT') return '局域网代理';
  if (transport === 'UNKNOWN') return '连接信息等待同步';
  return transport;
}

function accessRouteLabel(value) {
  return ({ BLE_LOCAL: 'BLE 本地', SITE_API: '现场 LAN', CLOUD_API: '互联网远程' })[value] ?? '连接未配置';
}

function deviceTransportLabel(value) {
  return ({ BLE_DIRECT: 'BLE 直连', LAN_AGENT: '局域网代理' })[normalizeTransport(value)] ?? '设备链路未知';
}

function connectionIcon(value) {
  return normalizeTransport(value) === 'BLE_DIRECT' ? 'Bluetooth' : normalizeTransport(value) === 'LAN_AGENT' ? 'Network' : 'RadioTower';
}

function normalizeConnectionStatus(value) {
  if (value === true) return 'ONLINE';
  if (value === false) return 'OFFLINE';
  const raw = String(value ?? '').toUpperCase();
  if (['CONNECTED', 'ONLINE', 'OPEN', 'ACTIVE'].includes(raw)) return 'CONNECTED';
  if (['CONNECTING', 'RECONNECTING', 'PENDING'].includes(raw)) return 'CONNECTING';
  if (['DISCONNECTED', 'OFFLINE', 'CLOSED', 'FAILED', 'ERROR'].includes(raw)) return 'OFFLINE';
  return raw || 'UNKNOWN';
}

function connectionStateLabel(value) {
  const state = normalizeConnectionStatus(value);
  if (state === 'CONNECTED') return '已连接';
  if (state === 'CONNECTING') return '连接中';
  if (state === 'OFFLINE') return '离线';
  return '等待连接';
}

function connectionTone(value) {
  const state = normalizeConnectionStatus(value);
  if (state === 'CONNECTED') return 'success';
  if (state === 'CONNECTING') return 'warning';
  if (state === 'OFFLINE') return 'danger';
  return 'info';
}

function connectionDetail(connection, health) {
  const endpoint = connection.endpoint ?? connection.address ?? connection.host ?? connection.deviceId ?? '';
  const lastSeen = connection.lastSeenAt ?? connection.lastSeen ?? null;
  const bits = [endpoint ? String(endpoint) : '', lastSeen ? `最近活动 ${formatDate(lastSeen)}` : '等待设备状态同步'];
  const healthState = connectionHealth(health);
  if (healthState.tone === 'danger') bits.push('实时状态可能过期');
  return bits.filter(Boolean).join(' / ');
}

function capabilityLabel(id) {
  return ({
    power: '电源',
    level: '强度',
    mode: '模式',
    read_only_telemetry: '只读遥测',
    generic_information: '通用信息'
  })[id] ?? id;
}

function deviceIconName(device) {
  const type = String(device.deviceType ?? device.type ?? device.kind ?? '').toLowerCase();
  if (type.includes('light') || type.includes('lamp')) return 'Lightbulb';
  if (type.includes('sensor')) return 'Gauge';
  if (type.includes('gateway')) return 'Router';
  if (type.includes('camera')) return 'Camera';
  if (type.includes('lock')) return 'LockKeyhole';
  return 'Cpu';
}

function stateLabel(key) {
  const labels = {
    power: '电源',
    on: '开关',
    level: '强度',
    brightness: '亮度',
    mode: '模式',
    online: '在线',
    temperature: '温度',
    humidity: '湿度',
    battery: '电量',
    signal: '信号'
  };
  return labels[key] ?? String(key).replace(/([A-Z])/g, ' $1').trim();
}

function stateValue(value) {
  if (value === true) return '开启';
  if (value === false) return '关闭';
  if (value == null || value === '') return '—';
  if (typeof value === 'object') return '已记录';
  return String(value);
}

function normalizeCommandStatus(value) {
  const raw = String(value ?? '').toUpperCase();
  if (['PENDING', 'QUEUED'].includes(raw)) return 'PENDING';
  if (['SENT', 'DISPATCHED'].includes(raw)) return 'SENT';
  if (raw === 'UNCONFIRMED') return 'UNCONFIRMED';
  if (['ACKNOWLEDGED', 'ACK', 'SUCCEEDED', 'SUCCESS'].includes(raw)) return 'ACKNOWLEDGED';
  if (['FAILED', 'TIMEOUT', 'REJECTED', 'ERROR'].includes(raw)) return 'FAILED';
  return raw || 'PENDING';
}

function commandStatusLabel(value) {
  return ({ PENDING: '待发送', SENT: '已发送', UNCONFIRMED: '已发送，设备未提供确认', ACKNOWLEDGED: '已确认', FAILED: '失败' })[normalizeCommandStatus(value)] ?? '待发送';
}

function commandTone(value) {
  return ({ PENDING: 'warning', SENT: 'info', UNCONFIRMED: 'warning', ACKNOWLEDGED: 'success', FAILED: 'danger' })[normalizeCommandStatus(value)] ?? 'info';
}

function commandLabel(command) {
  const type = String(command.type ?? command.commandType ?? '设备命令');
  const labels = { set_power: '设置电源', set_level: '设置强度', set_mode: '设置模式' };
  return labels[type] ?? type;
}

function commandTimestamp(command) {
  return `更新于 ${formatDate(command.acknowledgedAt ?? command.updatedAt ?? command.sentAt ?? command.createdAt ?? command.timestamp)}`;
}

function commandTime(command) {
  const date = new Date(command.acknowledgedAt ?? command.updatedAt ?? command.sentAt ?? command.createdAt ?? command.timestamp ?? 0).getTime();
  return Number.isFinite(date) ? date : 0;
}

function activityKind(activity) {
  const value = String(activity.eventType ?? activity.type ?? activity.status ?? '').toUpperCase();
  if (value.includes('FAIL') || value.includes('ERROR') || value.includes('OFFLINE')) return { tone: 'danger', icon: 'CircleAlert' };
  if (value.includes('ALERT') || value.includes('WARN') || value.includes('DISCONNECT')) return { tone: 'warning', icon: 'TriangleAlert' };
  if (value.includes('ACK') || value.includes('CLAIM') || value.includes('CONNECT') || value.includes('SUCCESS')) return { tone: 'success', icon: 'CircleCheck' };
  return { tone: 'info', icon: 'Activity' };
}

function activityTitle(activity) {
  if (activity.title) return String(activity.title);
  const type = String(activity.eventType ?? activity.type ?? 'DEVICE_EVENT').toUpperCase();
  const labels = {
    DEVICE_DISCOVERED: '发现设备',
    DEVICE_CLAIMED: '认领设备',
    DEVICE_CONNECTED: '设备已连接',
    DEVICE_DISCONNECTED: '设备已断开',
    COMMAND_CREATED: '已创建控制命令',
    COMMAND_SENT: '命令已发送',
    COMMAND_ACKNOWLEDGED: '命令已确认',
    COMMAND_FAILED: '命令执行失败',
    TELEMETRY_UPDATED: '设备状态已更新'
  };
  return labels[type] ?? type.replace(/_/g, ' ');
}

function activityDescription(activity) {
  return String(activity.description ?? activity.message ?? activity.detail ?? activity.payload?.message ?? '');
}

function activityTimestamp(activity) {
  return formatDate(activity.timestamp ?? activity.createdAt ?? activity.occurredAt ?? activity.updatedAt);
}

function allActivities(model) {
  return uniqueActivities([
    ...model.activities,
    ...Object.values(model.activitiesByDeviceId).flatMap((events) => arrayOf(events))
  ]).sort((left, right) => activityTime(right) - activityTime(left));
}

function uniqueActivities(activities) {
  const seen = new Set();
  return arrayOf(activities).filter((activity) => {
    const key = String(activity.id ?? activity.eventId ?? `${activity.eventType ?? activity.type}:${activity.timestamp ?? activity.createdAt}:${activity.message ?? ''}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => activityTime(right) - activityTime(left));
}

function activityTime(activity) {
  const date = new Date(activity.timestamp ?? activity.createdAt ?? activity.occurredAt ?? activity.updatedAt ?? 0).getTime();
  return Number.isFinite(date) ? date : 0;
}

function genericMetadata(device, connection = {}) {
  const metadata = {
    ...(plainObject(device.metadata)),
    ...(plainObject(connection.metadata)),
    ...(plainObject(connection.genericInformation)),
    ...(plainObject(device.genericInformation))
  };
  const values = [
    ['设备标识', device.deviceId ?? device.publicId ?? device.id],
    ['Profile', connection.profileId ?? connection.profile ?? device.profileId],
    ['型号', device.model ?? metadata.model],
    ['厂商', device.manufacturer ?? metadata.manufacturer],
    ...Object.entries(metadata)
  ];
  const seen = new Set();
  return values.filter(([key, value]) => {
    if (value == null || value === '' || typeof value === 'object') return false;
    const normalized = String(key).toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function isLoading(model, key) {
  return model.loading[key] === true || model.loading[String(key).toLowerCase()] === true;
}

function errorMessage(error) {
  if (typeof error === 'string') return error;
  if (error?.message) return String(error.message);
  if (error?.detail) return String(error.detail);
  if (error?.title) return String(error.title);
  return '操作未完成，请稍后重试。';
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function activityMatchesDevice(item, numericId, publicId) {
  const references = [
    item?.deviceDbId,
    item?.deviceId,
    item?.devicePublicId,
    item?.publicId,
    item?.device?.id,
    item?.device?.deviceId,
    item?.device?.publicId
  ];
  return references.some((reference) => sameKey(reference, numericId) || sameKey(reference, publicId));
}

function objectValues(value) {
  return Array.isArray(value) ? value : Object.values(plainObject(value));
}

function sameKey(left, right) {
  return String(left ?? '') === String(right ?? '');
}

function matchesDeviceReference(device, reference) {
  return [device?.id, device?.deviceId, device?.publicId]
    .some((candidate) => sameKey(candidate, reference));
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function formatDate(value) {
  if (!value) return '时间等待同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}
