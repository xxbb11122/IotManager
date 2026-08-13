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
  CloudSun,
  Clock3,
  Cpu,
  Droplets,
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
  Thermometer,
  TriangleAlert,
  Wind,
  Workflow,
  X
} from 'lucide';
import {
  capabilityValue,
  isControllableCapability,
  resolveDeviceCapabilities
} from './device-capabilities.js';

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
  CloudSun,
  Clock3,
  Cpu,
  Droplets,
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
  Thermometer,
  TriangleAlert,
  Wind,
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

let activeUi = null;

/**
 * Converts a device view into the screen-level capability decision.  It stays
 * DOM-free so client tests can verify that unknown BLE profiles remain safe.
 */
export function deviceScreenState(device = {}, runtime = {}) {
  const connection = getPrimaryConnection(device);
  const capabilities = resolveDeviceCapabilities(device, connection);
  const controlCapabilities = capabilities.controls.filter(isControllableCapability);
  const transport = normalizeTransport(connection.transport ?? device.transport);
  const profileId = capabilities.profileId ?? connection.profileId ?? connection.profile ?? device.profileId ?? null;
  const unknownBleProfile = transport === 'BLE_DIRECT' && (capabilities.known === false || !profileId);

  if (runtime.stale === true && runtime.accessRoute !== 'BLE_LOCAL') {
    return {
      showControls: false,
      controls: controlCapabilities,
      capabilities,
      unknownBleProfile: false,
      notice: '当前显示缓存状态，请等待平台同步后再控制。'
    };
  }

  if (unknownBleProfile && controlCapabilities.length === 0) {
    return {
      showControls: false,
      controls: [],
      capabilities,
      unknownBleProfile: true,
      notice: '该蓝牙设备已连接，但暂无可用控制能力。'
    };
  }

  if (controlCapabilities.length === 0) {
    return {
      showControls: false,
      controls: [],
      capabilities,
      unknownBleProfile: false,
      notice: '设备尚未提供可用控制能力。'
    };
  }

  return {
    showControls: true,
    controls: controlCapabilities,
    capabilities,
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
      weatherLocationDraft: {
        latitude: '',
        longitude: '',
        timezone: browserTimezone()
      },
      busyActions: new Set(),
      transientError: null,
      pull: {
        pointerId: null,
        startY: 0,
        distance: 0,
        armed: false,
        refreshing: false
      }
    };

    this.onClick = this.onClick.bind(this);
    this.onInput = this.onInput.bind(this);
    this.onChange = this.onChange.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);
    this.root.addEventListener('change', this.onChange);
    this.root.addEventListener('pointerdown', this.onPointerDown, { passive: true });
    this.root.addEventListener('pointermove', this.onPointerMove, { passive: false });
    this.root.addEventListener('pointerup', this.onPointerUp);
    this.root.addEventListener('pointercancel', this.onPointerUp);
    this.render(this.model);
  }

  bindEvents(handlers = {}) {
    this.handlers = { ...this.handlers, ...handlers };
  }

  render(viewModel = {}) {
    this.model = normalizeViewModel(viewModel);
    this.reconcileLocalState();
    const previousScroll = window.scrollY;
    this.root.replaceChildren(this.buildShell());
    if (previousScroll > 0) window.scrollTo(0, previousScroll);
  }

  destroy() {
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('input', this.onInput);
    this.root.removeEventListener('change', this.onChange);
    this.root.removeEventListener('pointerdown', this.onPointerDown);
    this.root.removeEventListener('pointermove', this.onPointerMove);
    this.root.removeEventListener('pointerup', this.onPointerUp);
    this.root.removeEventListener('pointercancel', this.onPointerUp);
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
    main.append(this.buildPullRefreshIndicator());
    main.append(this.buildCurrentScreen());
    workspace.append(main);
    shell.append(workspace);
    shell.append(this.buildMobileNav());
    shell.append(element('div', 'toast-region', { ariaLive: 'polite', ariaAtomic: 'true' }));
    return shell;
  }

  buildPullRefreshIndicator() {
    const pull = this.local.pull;
    const visible = pull.distance > 0 || pull.refreshing;
    const label = pull.refreshing ? '正在刷新…' : pull.armed ? '松开即可刷新' : '下拉刷新';
    const indicator = element('div', `pull-refresh${visible ? ' pull-refresh--visible' : ''}${pull.armed ? ' pull-refresh--armed' : ''}`, {
      ariaLive: 'polite', ariaHidden: visible ? 'false' : 'true'
    });
    indicator.style.setProperty('--pull-distance', `${Math.min(72, pull.distance)}px`);
    indicator.append(icon(pull.refreshing ? 'LoaderCircle' : 'RefreshCw', 18));
    indicator.append(element('span', '', { text: label }));
    return indicator;
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
    actions.append(this.buildWeatherHeaderSummary());
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

  buildWeatherHeaderSummary() {
    const weather = this.model.weather;
    const current = plainObject(weather?.current);
    const indicators = plainObject(weather?.indicators);
    const available = Object.keys(current).length > 0;
    const summary = actionButton('', 'open-weather', {
      className: 'weather-header-summary',
      ariaLabel: available
        ? `站点天气：温度 ${weatherValue(current.temperatureC, '°C')}，湿度 ${weatherValue(current.relativeHumidityPct, '%')}，气压 ${weatherValue(current.surfacePressureHpa, ' hPa')}`
        : '打开站点天气'
    });
    if (!available) {
      summary.append(icon('CloudSun', 17));
      summary.append(element('span', 'weather-header-summary__empty', {
        text: weather?.status === 'UNAVAILABLE' ? '天气未配置' : weather?.status === 'PENDING' ? '等待天气同步' : '天气加载中'
      }));
      return summary;
    }
    summary.append(weatherHeaderMetric('Thermometer', weatherValue(current.temperatureC, '°C'), indicators.temperature));
    summary.append(weatherHeaderMetric('Droplets', weatherValue(current.relativeHumidityPct, '%'), indicators.humidity));
    summary.append(weatherHeaderMetric('Gauge', weatherValue(current.surfacePressureHpa, ' hPa'), indicators.pressure));
    return summary;
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
      case 'weather':
        screen.append(this.buildWeatherScreen());
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
    const weather = this.model.weather;
    const current = plainObject(weather?.current);
    if (Object.keys(current).length > 0) {
      const weatherLine = actionButton('', 'open-weather', {
        className: 'context-row__weather',
        ariaLabel: `查看天气详情：${current.conditionText ?? '天气'}，海拔 ${weatherValue(current.elevationM, ' m')}`
      });
      weatherLine.append(icon(weatherIcon(current.iconKey), 18));
      weatherLine.append(element('span', 'context-row__weather-text', {
        text: `${current.conditionText ?? '未知'} · 海拔 ${weatherValue(current.elevationM, ' m')}`
      }));
      weatherLine.append(environmentChip(indicatorLabel(weather?.indicators?.esdRisk, 'ESD'), weather?.indicators?.esdRisk));
      weatherLine.append(environmentChip(indicatorLabel(weather?.indicators?.condensationRisk, '结露'), weather?.indicators?.condensationRisk));
      row.append(weatherLine);
    } else if (weather?.status === 'UNAVAILABLE' || weather?.status === 'PENDING') {
      row.append(actionButton(weather.status === 'PENDING' ? '等待天气同步' : '天气未配置', 'open-weather', {
        className: 'context-row__weather context-row__weather--empty', iconName: 'CloudSun'
      }));
    }
    const health = connectionHealth(this.model.connectionHealth);
    row.append(statusChip(health.label, health.tone));
    return row;
  }

  buildWeatherScreen() {
    const fragment = document.createDocumentFragment();
    const weather = this.model.weather;
    const current = plainObject(weather?.current);
    const forecast = plainObject(this.model.weatherForecast);
    fragment.append(screenHeading('园区天气', weatherDescription(weather), backButton('devices')));
    fragment.append(this.buildWeatherLocationSurface());

    if (weather?.refreshError) {
      fragment.append(this.buildNotice(weather.refreshError, 'warning', null, '天气同步状态'));
    }

    if (Object.keys(current).length === 0) {
      fragment.append(this.buildNotice(weatherUnavailableMessage(weather), ['UNAVAILABLE', 'PENDING'].includes(weather?.status) ? 'info' : 'warning', null, '站点天气'));
      return fragment;
    }

    const hero = element('section', 'weather-hero');
    const heroMain = element('div', 'weather-hero__main');
    const condition = element('div', 'weather-hero__condition');
    condition.append(icon(weatherIcon(current.iconKey), 42));
    const conditionCopy = element('div');
    conditionCopy.append(element('strong', '', { text: current.conditionText ?? '未知' }));
    conditionCopy.append(element('span', '', { text: weatherStatusLabel(weather?.status) }));
    condition.append(conditionCopy);
    heroMain.append(condition);
    heroMain.append(element('div', 'weather-hero__temperature', { text: weatherValue(current.temperatureC, '°C') }));
    heroMain.append(element('p', 'weather-hero__feels', { text: `体感 ${weatherValue(current.apparentTemperatureC, '°C')}` }));
    hero.append(heroMain);
    const refresh = element('p', 'weather-hero__updated', { text: weather?.fetchedAt ? `更新于 ${formatDate(weather.fetchedAt)}` : '等待天气数据' });
    hero.append(refresh);
    fragment.append(hero);

    const metrics = element('section', 'weather-metrics', { ariaLabel: '当前天气指标' });
    metrics.append(weatherDetailMetric('Droplets', '湿度', weatherValue(current.relativeHumidityPct, '%'), weather?.indicators?.humidity));
    metrics.append(weatherDetailMetric('Gauge', '气压', weatherValue(current.surfacePressureHpa, ' hPa'), weather?.indicators?.pressure));
    metrics.append(weatherDetailMetric('Wind', '风速', weatherValue(current.windSpeedKmh, ' km/h'), null));
    metrics.append(weatherDetailMetric('MapPin', '海拔', weatherValue(current.elevationM, ' m'), null));
    fragment.append(metrics);

    const risks = element('section', 'surface surface--padded weather-risks');
    risks.append(surfaceHeading('环境状态', '颜色反映环境风险，不影响设备连接与控制权限。'));
    const list = element('div', 'weather-risk-list');
    list.append(weatherRiskRow('温度', weather?.indicators?.temperature));
    list.append(weatherRiskRow('湿度', weather?.indicators?.humidity));
    list.append(weatherRiskRow('气压', weather?.indicators?.pressure));
    list.append(weatherRiskRow('ESD 风险', weather?.indicators?.esdRisk));
    list.append(weatherRiskRow('结露风险', weather?.indicators?.condensationRisk));
    risks.append(list);
    fragment.append(risks);

    fragment.append(this.buildWeatherForecastSurface('未来 24 小时', arrayOf(forecast.hourly), false));
    fragment.append(this.buildWeatherForecastSurface('7 天预报', arrayOf(forecast.daily), true));
    return fragment;
  }

  buildWeatherLocationSurface() {
    const settings = plainObject(this.model.weatherSettings);
    const pendingLocation = plainObject(this.model.pendingWeatherLocation);
    const hasCoordinates = validCoordinate(settings.latitude, -90, 90) && validCoordinate(settings.longitude, -180, 180);
    const hasPendingLocation = validCoordinate(pendingLocation.latitude, -90, 90)
      && validCoordinate(pendingLocation.longitude, -180, 180);
    const surface = element('section', 'surface surface--padded weather-location');
    surface.append(surfaceHeading('天气位置', '仅在点击“使用我的位置”时读取一次定位；不会后台追踪。'));

    const summary = element('div', 'weather-location__summary');
    summary.append(icon('MapPin', 19));
    const copy = element('div');
    if (hasCoordinates) {
      copy.append(element('strong', '', { text: weatherLocationSourceLabel(settings.locationSource) }));
      const accuracy = Number(settings.locationAccuracyM);
      const accuracyText = Number.isFinite(accuracy) && accuracy >= 0 ? ` · 精度 ±${Math.round(accuracy)} m` : '';
      copy.append(element('p', '', {
        text: `${formatCoordinate(settings.latitude)}, ${formatCoordinate(settings.longitude)}${accuracyText}`
      }));
      if (settings.locationUpdatedAt) {
        copy.append(element('small', '', { text: `位置更新于 ${formatDate(settings.locationUpdatedAt)}` }));
      }
    } else {
      copy.append(element('strong', '', { text: '尚未配置天气位置' }));
      copy.append(element('p', '', { text: '授权定位后即可获取当前位置的真实天气；也可手动填写坐标。' }));
    }
    summary.append(copy);
    surface.append(summary);

    const refreshError = this.model.weather?.refreshError ?? settings.lastRefreshError;
    if (refreshError) {
      surface.append(this.buildNotice(refreshError, 'warning', null, '已保存位置'));
    }

    if (hasPendingLocation) {
      surface.append(this.buildNotice(
        `已获取手机位置 ${formatCoordinate(pendingLocation.latitude)}, ${formatCoordinate(pendingLocation.longitude)}，但后台暂时不可达。恢复连接后可直接保存，无需重新定位。`,
        'warning',
        null,
        '位置等待保存'
      ));
    }

    const actions = element('div', 'weather-location__actions');
    actions.append(actionButton(this.isBusy('weather-device-location') ? '正在定位…' : '使用我的位置', 'update-weather-location', {
      className: 'button button--primary', iconName: 'MapPin',
      disabled: this.isBusy('weather-device-location') || this.isBusy('weather-manual-location')
    }));
    actions.append(actionButton(this.isBusy('refresh-weather') ? '刷新中…' : '刷新天气', 'refresh-weather', {
      className: 'button button--secondary', iconName: 'RefreshCw',
      disabled: this.isBusy('refresh-weather') || this.isBusy('weather-device-location') || this.isBusy('weather-manual-location')
    }));
    if (hasPendingLocation) {
      actions.append(actionButton(this.isBusy('weather-pending-location') ? '保存中…' : '保存已获取的位置', 'retry-pending-weather-location', {
        className: 'button button--secondary', iconName: 'MapPin',
        disabled: this.isBusy('weather-pending-location') || this.isBusy('weather-device-location') || this.isBusy('weather-manual-location')
      }));
    }
    surface.append(actions);

    const manual = element('div', 'weather-location__manual');
    manual.append(element('p', 'weather-location__manual-title', { text: '无法定位？手动填写坐标' }));
    manual.append(this.textField('纬度', 'weather-latitude', this.local.weatherLocationDraft.latitude, '范围 -90 至 90，例如 22.5431', 'weatherLatitude'));
    manual.append(this.textField('经度', 'weather-longitude', this.local.weatherLocationDraft.longitude, '范围 -180 至 180，例如 114.0579', 'weatherLongitude'));
    manual.append(this.textField('时区', 'weather-timezone', this.local.weatherLocationDraft.timezone, '例如 Asia/Shanghai', 'weatherTimezone'));
    manual.append(actionButton(this.isBusy('weather-manual-location') ? '保存并刷新中…' : '保存手动位置并刷新', 'save-manual-weather-location', {
      className: 'button button--secondary', iconName: 'MapPin',
      disabled: this.isBusy('weather-manual-location') || this.isBusy('weather-device-location')
    }));
    surface.append(manual);
    return surface;
  }

  buildWeatherForecastSurface(title, points, daily) {
    const surface = element('section', 'surface surface--padded weather-forecast');
    surface.append(surfaceHeading(title, daily ? '最高/最低温与降水概率。' : '温度、天气与降水概率。'));
    if (this.model.loading.weatherForecast) {
      surface.append(element('p', 'empty-inline', { text: '正在加载预报…' }));
      return surface;
    }
    if (!points.length) {
      surface.append(element('p', 'empty-inline', { text: '预报数据将在下一次天气刷新后可用。' }));
      return surface;
    }
    const list = element('div', daily ? 'weather-daily-list' : 'weather-hourly-list');
    points.forEach((point) => {
      const item = element('article', daily ? 'weather-daily-item' : 'weather-hourly-item');
      item.append(element('span', 'weather-forecast__time', { text: weatherForecastTime(point.forecastAt, daily) }));
      item.append(icon(weatherIcon(point.iconKey), 19));
      item.append(element('span', 'weather-forecast__condition', { text: point.conditionText ?? '未知' }));
      item.append(element('strong', 'weather-forecast__temperature', {
        text: daily
          ? `${weatherValue(point.temperatureMaxC, '°')} / ${weatherValue(point.temperatureMinC, '°')}`
          : weatherValue(point.temperatureC, '°')
      }));
      if (point.precipitationProbabilityPct != null) {
        item.append(element('span', 'weather-forecast__rain', { text: `${point.precipitationProbabilityPct}%` }));
      }
      list.append(item);
    });
    surface.append(list);
    return surface;
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

    if (ble.native && arrayOf(ble.candidates).length) {
      surface.append(this.buildBleCandidateList(ble.candidates, ble.selectedCandidateId ?? bleCandidateReference(candidate)));
    }

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
      if (connected) {
        surface.append(actionButton('断开连接', 'disconnect-ble', {
          className: 'button button--secondary button--full',
          iconName: 'Link',
          data: { deviceId: candidate.id ?? candidate.deviceId ?? connection.deviceId },
          disabled: this.isBusy('disconnect-ble')
        }));
      }
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
    if (ble.native && ble.scanning) {
      surface.append(actionButton('停止扫描', 'stop-ble-scan', {
        className: 'button button--secondary button--full',
        iconName: 'X',
        disabled: this.isBusy('stop-ble-scan')
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

  buildBleCandidateList(candidates, selectedCandidateId) {
    const wrapper = element('div', 'candidate-list');
    arrayOf(candidates).forEach((candidate) => {
      const candidateId = bleCandidateReference(candidate);
      const selected = candidateId === String(selectedCandidateId ?? '');
      const row = actionButton('', 'select-ble-candidate', {
        className: `candidate-row${selected ? ' candidate-row--selected' : ''}`,
        data: { candidateId },
        ariaLabel: `选择 ${deviceName(candidate)}`,
        title: candidateId
      });
      const iconWrap = element('div', 'device-icon', { ariaHidden: 'true' });
      iconWrap.append(icon('Bluetooth', 20));
      row.append(iconWrap);
      const body = element('div', 'candidate-row__body');
      body.append(element('div', 'candidate-row__title', { text: deviceName(candidate) }));
      const rssi = Number(candidate.rssi);
      const rssiLabel = Number.isFinite(rssi) ? `${rssi} dBm` : '信号未知';
      body.append(element('div', 'candidate-row__meta', { text: `${candidateId} / ${rssiLabel}` }));
      row.append(body);
      const aside = element('div', 'candidate-row__aside');
      if (selected) aside.append(statusChip('已选择', 'success'));
      else aside.append(icon('ChevronRight', 17));
      row.append(aside);
      wrapper.append(row);
    });
    return wrapper;
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
    surface.append(this.textField('API 地址', 'endpoint-api-url', this.local.endpointDraft.apiBaseUrl, '真机当前应为：http://192.168.5.10:8080/api', 'endpointApiUrl'));
    surface.append(this.textField('WebSocket 地址', 'endpoint-ws-url', this.local.endpointDraft.wsUrl, '真机当前应为：ws://192.168.5.10:8080/ws/devices', 'endpointWsUrl'));
    if (this.local.endpointDraft.accessRoute === 'SITE_API') {
      surface.append(this.buildNotice('请先在电脑 IDEA 中启动后端，并确保手机与电脑连接同一 Wi‑Fi；保存前必须先通过“测试连接”。', 'info', null, '真机连接要求'));
    }
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
    if (device.localOnly && normalizeTransport(connection.transport) === 'BLE_DIRECT') {
      const actions = element('div', 'form-actions');
      if (normalized === 'CONNECTED') {
        actions.append(actionButton('断开连接', 'disconnect-ble', {
          className: 'button button--secondary',
          iconName: 'Link',
          data: { deviceId: deviceKey(device) },
          disabled: this.isBusy('disconnect-ble')
        }));
      }
      actions.append(actionButton('忘记设备', 'forget-ble', {
        className: 'button button--danger',
        iconName: 'X',
        data: { deviceId: deviceKey(device) },
        disabled: this.isBusy('forget-ble')
      }));
      surface.append(actions);
    }
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
      controls.append(this.buildCapabilityControl(device, capability, pending));
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

  buildCapabilityControl(device, capability, disabled) {
    if (capability.controlType === 'toggle') return this.buildToggleControl(device, capability, disabled);
    if (capability.controlType === 'range') return this.buildRangeControl(device, capability, disabled);
    if (capability.controlType === 'select') return this.buildSelectControl(device, capability, disabled);
    return this.buildActionControl(device, capability, disabled);
  }

  buildToggleControl(device, capability, disabled) {
    const current = Boolean(capabilityValue(capability, device.desiredState, device.reportedState ?? device.state));
    const row = element('div', 'control-row');
    const heading = element('div', 'control-row__heading');
    const copy = element('div');
    copy.append(element('h4', '', { text: String(capability.label) }));
    copy.append(element('p', '', { text: current ? '目标：开启' : '目标：关闭' }));
    heading.append(copy);
    heading.append(actionButton('', 'command-capability-toggle', {
      className: `switch-button${current ? ' switch-button--on' : ''}`,
      data: capabilityActionData(device, capability, !current),
      ariaLabel: `${current ? '关闭' : '开启'} ${capability.label}`,
      disabled
    }));
    row.append(heading);
    return row;
  }

  buildRangeControl(device, capability, disabled) {
    const min = Number.isFinite(capability.min) ? capability.min : 0;
    const max = Number.isFinite(capability.max) ? capability.max : 100;
    const step = Number.isFinite(capability.step) && capability.step > 0 ? capability.step : 1;
    const key = `capability:${capability.id}:${deviceKey(device)}`;
    const current = capabilityValue(capability, device.desiredState, device.reportedState ?? device.state);
    const value = clampRangeValue(this.local.commandValues[key] ?? current, min, max, step);
    const row = element('div', 'control-row');
    const heading = element('div', 'control-row__heading');
    const copy = element('div');
    copy.append(element('h4', '', { text: String(capability.label) }));
    copy.append(element('p', '', { text: `范围：${formatRangeValue(min)} 至 ${formatRangeValue(max)}` }));
    heading.append(copy);
    row.append(heading);
    const rangeRow = element('div', 'range-row');
    rangeRow.append(element('input', 'range-input', {
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(value),
      disabled,
      data: { ...capabilityActionData(device, capability), field: 'capability-range', rangeKey: key },
      ariaLabel: `${capability.label} ${formatRangeValue(value)}`
    }));
    rangeRow.append(element('output', 'range-value', { text: formatRangeValue(value) }));
    row.append(rangeRow);
    return row;
  }

  buildSelectControl(device, capability, disabled) {
    const options = arrayOf(capability.options);
    const current = String(capabilityValue(capability, device.desiredState, device.reportedState ?? device.state) ?? '');
    const row = element('div', 'control-row');
    const heading = element('div', 'control-row__heading');
    const copy = element('div');
    copy.append(element('h4', '', { text: String(capability.label) }));
    copy.append(element('p', '', { text: options.length ? '请选择设备提供的选项。' : '设备未提供可选项。' }));
    heading.append(copy);
    row.append(heading);
    if (!options.length) return row;
    const grid = element('div', 'mode-grid');
    options.slice(0, 12).forEach((option) => {
      const value = String(option.value);
      grid.append(actionButton(String(option.label), 'command-capability-select', {
        className: `mode-button${value === current ? ' mode-button--selected' : ''}`,
        data: capabilityActionData(device, capability, option.value),
        disabled,
        ariaLabel: `设置 ${capability.label} 为 ${option.label}`
      }));
    });
    row.append(grid);
    return row;
  }

  buildActionControl(device, capability, disabled) {
    const row = element('div', 'control-row');
    const heading = element('div', 'control-row__heading');
    const copy = element('div');
    copy.append(element('h4', '', { text: String(capability.label) }));
    if (capability.description) copy.append(element('p', '', { text: String(capability.description) }));
    heading.append(copy);
    heading.append(actionButton(capability.actionLabel ?? '执行', 'command-capability-action', {
      className: 'button button--secondary',
      iconName: 'Workflow',
      data: capabilityActionData(device, capability),
      disabled
    }));
    row.append(heading);
    return row;
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
      case 'open-weather':
        this.local.screen = 'weather';
        this.invoke('openWeather', {}, { busy: 'open-weather' });
        this.render(this.model);
        break;
      case 'update-weather-location':
        this.invoke('updateWeatherFromDeviceLocation', {}, { busy: 'weather-device-location' });
        break;
      case 'retry-pending-weather-location':
        this.invoke('retryPendingWeatherLocation', {}, { busy: 'weather-pending-location' });
        break;
      case 'save-manual-weather-location':
        this.invoke('updateWeatherFromManualLocation', { ...this.local.weatherLocationDraft }, { busy: 'weather-manual-location' });
        break;
      case 'refresh-weather':
        this.invoke('refreshWeather', {}, { busy: 'refresh-weather' });
        break;
      case 'command-power':
        this.sendCommand(target.dataset.deviceId, target.dataset.commandType, { on: target.dataset.nextValue === 'true' }, 'command-power');
        break;
      case 'command-mode':
        this.sendCommand(target.dataset.deviceId, target.dataset.commandType, { mode: target.dataset.value }, 'command-mode');
        break;
      case 'command-capability-toggle':
      case 'command-capability-select':
      case 'command-capability-action':
        this.sendCapabilityCommand(target, datasetJsonValue(target.dataset.valueJson), `command:${target.dataset.capabilityId}`);
        break;
      case 'disconnect-ble':
        this.invoke('disconnectBle', { deviceId: target.dataset.deviceId }, { busy: 'disconnect-ble' });
        break;
      case 'forget-ble':
        this.invoke('forgetBle', { deviceId: target.dataset.deviceId }, {
          busy: 'forget-ble',
          onResolved: () => {
            this.local.screen = 'devices';
          }
        });
        break;
      case 'stop-ble-scan':
        this.invoke('stopBleScan', {}, { busy: 'stop-ble-scan' });
        break;
      case 'select-ble-candidate':
        this.invoke('selectBleCandidate', { candidateId: target.dataset.candidateId });
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
    if (field === 'weatherLatitude') this.local.weatherLocationDraft.latitude = target.value;
    if (field === 'weatherLongitude') this.local.weatherLocationDraft.longitude = target.value;
    if (field === 'weatherTimezone') this.local.weatherLocationDraft.timezone = target.value;
    if (field === 'level') {
      const key = `level:${target.dataset.deviceId}`;
      this.local.commandValues[key] = clampNumber(target.value, 0, 100);
      const output = target.parentElement?.querySelector('output');
      if (output) output.textContent = `${this.local.commandValues[key]}%`;
    }
    if (field === 'capability-range') {
      const min = Number(target.min);
      const max = Number(target.max);
      const step = Number(target.step);
      const key = target.dataset.rangeKey;
      this.local.commandValues[key] = clampRangeValue(target.value, min, max, step);
      const output = target.parentElement?.querySelector('output');
      if (output) output.textContent = formatRangeValue(this.local.commandValues[key]);
    }
  }

  onChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !this.root.contains(target)) return;
    if (target.dataset.field === 'level') {
      const value = clampNumber(target.value, 0, 100);
      this.sendCommand(target.dataset.deviceId, target.dataset.commandType, { level: value }, 'command-level');
    }
    if (target.dataset.field === 'capability-range') {
      const value = clampRangeValue(target.value, Number(target.min), Number(target.max), Number(target.step));
      this.sendCapabilityCommand(target, value, `command:${target.dataset.capabilityId}`);
    }
  }

  supportsPullRefresh() {
    return this.local.screen === 'devices' || this.local.screen === 'weather';
  }

  onPointerDown(event) {
    if (!this.supportsPullRefresh() || this.local.pull.refreshing || window.scrollY > 0 || event.pointerType === 'mouse') return;
    this.local.pull = {
      pointerId: event.pointerId,
      startY: event.clientY,
      distance: 0,
      armed: false,
      refreshing: false
    };
  }

  onPointerMove(event) {
    const pull = this.local.pull;
    if (pull.pointerId !== event.pointerId || pull.refreshing) return;
    const distance = Math.max(0, event.clientY - pull.startY);
    if (distance === 0) return;
    if (window.scrollY > 0) {
      this.resetPullRefresh();
      return;
    }
    event.preventDefault();
    pull.distance = Math.min(100, distance * 0.5);
    pull.armed = pull.distance >= 72;
    this.updatePullRefreshIndicator();
  }

  onPointerUp(event) {
    const pull = this.local.pull;
    if (pull.pointerId !== event.pointerId) return;
    const shouldRefresh = pull.armed && !pull.refreshing;
    pull.pointerId = null;
    if (!shouldRefresh) {
      this.resetPullRefresh();
      return;
    }
    pull.refreshing = true;
    pull.distance = 72;
    pull.armed = false;
    this.updatePullRefreshIndicator();
    this.invoke('pullRefresh', { screen: this.local.screen }, {
      busy: 'pull-refresh',
      onResolved: () => this.notify('已刷新最新数据。', 'success'),
      onRejected: (error) => { this.local.transientError = errorMessage(error); }
    });
    // invoke deliberately returns immediately for Promise handlers. Reset once
    // the UI finishes its current async refresh state.
    const waitForCompletion = () => {
      const busy = this.isBusy('pull-refresh');
      if (busy) {
        window.setTimeout(waitForCompletion, 80);
        return;
      }
      this.resetPullRefresh();
    };
    window.setTimeout(waitForCompletion, 80);
  }

  updatePullRefreshIndicator() {
    const indicator = this.root.querySelector('.pull-refresh');
    if (!indicator) {
      this.render(this.model);
      return;
    }
    const pull = this.local.pull;
    indicator.classList.toggle('pull-refresh--visible', pull.distance > 0 || pull.refreshing);
    indicator.classList.toggle('pull-refresh--armed', pull.armed);
    indicator.style.setProperty('--pull-distance', `${Math.min(72, pull.distance)}px`);
    indicator.setAttribute('aria-hidden', pull.distance > 0 || pull.refreshing ? 'false' : 'true');
    const label = indicator.querySelector('span');
    if (label) label.textContent = pull.refreshing ? '正在刷新…' : pull.armed ? '松开即可刷新' : '下拉刷新';
  }

  resetPullRefresh() {
    this.local.pull = {
      pointerId: null,
      startY: 0,
      distance: 0,
      armed: false,
      refreshing: false
    };
    this.updatePullRefreshIndicator();
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

  sendCommand(deviceId, type, parameters, busy, desiredState = undefined) {
    if (!deviceId || !type) return;
    this.invoke('sendCommand', { deviceId, type, parameters, desiredState }, { busy });
  }

  sendCapabilityCommand(target, value, busy) {
    const parameters = datasetJsonObject(target.dataset.parametersJson);
    if (target.dataset.parameterKey && value !== undefined) {
      parameters[target.dataset.parameterKey] = value;
    }
    const desiredState = target.dataset.stateKey && value !== undefined
      ? { [target.dataset.stateKey]: value }
      : undefined;
    this.sendCommand(target.dataset.deviceId, target.dataset.commandType, parameters, busy, desiredState);
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
    weather: plainObject(source.weather),
    weatherForecast: plainObject(source.weatherForecast),
    weatherSettings: plainObject(source.weatherSettings),
    pendingWeatherLocation: plainObject(source.pendingWeatherLocation),
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

function weatherHeaderMetric(iconName, value, indicator) {
  const metric = element('span', `weather-header-metric weather-header-metric--${environmentTone(indicator)}`, {
    ariaLabel: `${value}，${indicator?.label ?? '状态待定'}`
  });
  metric.append(icon(iconName, 16));
  metric.append(element('strong', '', { text: value }));
  return metric;
}

function weatherDetailMetric(iconName, label, value, indicator) {
  const metric = element('article', `weather-metric weather-metric--${environmentTone(indicator)}`);
  metric.append(icon(iconName, 19));
  const copy = element('div');
  copy.append(element('span', '', { text: label }));
  copy.append(element('strong', '', { text: value }));
  if (indicator?.label) copy.append(element('small', '', { text: indicator.label }));
  metric.append(copy);
  return metric;
}

function weatherRiskRow(label, indicator) {
  const source = plainObject(indicator);
  const row = element('article', `weather-risk-row weather-risk-row--${environmentTone(source)}`);
  row.append(element('strong', '', { text: label }));
  const copy = element('div');
  copy.append(environmentChip(source.label ?? '待评估', source));
  if (source.reason) copy.append(element('p', '', { text: source.reason }));
  row.append(copy);
  return row;
}

function environmentChip(label, indicator) {
  const tone = environmentTone(indicator);
  const chip = element('span', `environment-chip environment-chip--${tone}`, {
    ariaLabel: `${label}：${indicator?.reason ?? '状态待定'}`
  });
  chip.append(element('span', 'status-dot', { ariaHidden: 'true' }));
  chip.append(textNode(label));
  return chip;
}

function environmentTone(indicator) {
  switch (String(indicator?.level ?? '').toUpperCase()) {
    case 'SUITABLE': return 'suitable';
    case 'OBSERVE': return 'observe';
    case 'RISK': return 'risk';
    default: return 'neutral';
  }
}

function indicatorLabel(indicator, prefix) {
  const label = indicator?.label;
  return label ? `${prefix} ${label}` : `${prefix} 待评估`;
}

function weatherValue(value, unit) {
  if (value === null || value === undefined || value === '') return '--';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  const rounded = Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1).replace(/\.0$/, '');
  return `${rounded}${unit}`;
}

function weatherIcon(iconKey) {
  return ({
    sun: 'Circle',
    'sun-cloud': 'CloudSun',
    cloud: 'CloudSun',
    fog: 'CloudSun',
    drizzle: 'CloudSun',
    rain: 'CloudSun',
    snow: 'CloudSun',
    thunderstorm: 'CloudSun'
  })[iconKey] ?? 'CloudSun';
}

function weatherStatusLabel(status) {
  return ({ FRESH: '天气已更新', STALE: '天气数据待更新', EXPIRED: '天气数据已过期', PENDING: '天气已配置，等待首次同步', UNAVAILABLE: '天气未配置' })[status] ?? '天气加载中';
}

function weatherDescription(weather) {
  if (!weather?.current) return weatherUnavailableMessage(weather);
  return `${weather.current.conditionText ?? '当前天气'} · ${weatherStatusLabel(weather.status)}`;
}

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  } catch {
    return 'Asia/Shanghai';
  }
}

function validCoordinate(value, minimum, maximum) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= minimum && numeric <= maximum;
}

function formatCoordinate(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(5) : '--';
}

function weatherLocationSourceLabel(source) {
  return ({ MOBILE_GPS: '手机当前位置', MANUAL: '手动站点位置' })[String(source ?? '').toUpperCase()] ?? '站点天气位置';
}

function weatherUnavailableMessage(weather) {
  if (weather?.status === 'PENDING') return '当前站点已配置天气坐标，正在等待首次成功同步。';
  if (weather?.status === 'UNAVAILABLE') return '尚未为当前站点配置天气坐标。';
  if (weather?.status === 'EXPIRED') return '正在显示最近成功天气，请检查网络或数据源。';
  return '正在获取站点环境天气。';
}

function weatherForecastTime(value, daily) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return daily
    ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(date)
    : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date);
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

function bleCandidateReference(candidate = {}) {
  return String(candidate.deviceId ?? candidate.id ?? candidate.externalId ?? '');
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

function capabilityActionData(device, capability, value = undefined) {
  const data = {
    deviceId: deviceKey(device),
    capabilityId: capability.id,
    commandType: capability.commandType,
    parameterKey: capability.parameterKey,
    stateKey: capability.stateKey
  };
  if (value !== undefined) data.valueJson = JSON.stringify(value);
  if (Object.keys(plainObject(capability.fixedParameters)).length) {
    data.parametersJson = JSON.stringify(capability.fixedParameters);
  }
  return data;
}

function datasetJsonValue(value) {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function datasetJsonObject(value) {
  const parsed = datasetJsonValue(value);
  return plainObject(parsed);
}

function clampRangeValue(value, min = 0, max = 100, step = 1) {
  const lower = Number.isFinite(min) ? min : 0;
  const upper = Number.isFinite(max) && max >= lower ? max : 100;
  const increment = Number.isFinite(step) && step > 0 ? step : 1;
  const number = Number(value);
  if (!Number.isFinite(number)) return lower;
  const clamped = Math.min(upper, Math.max(lower, number));
  const stepped = Math.round((clamped - lower) / increment) * increment + lower;
  return Number(stepped.toFixed(8));
}

function formatRangeValue(value) {
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(4)));
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
