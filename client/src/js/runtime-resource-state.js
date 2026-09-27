// Presentation state is deliberately separate from device protocol states.
export function resourceState(overrides = {}) {
  return { phase: 'idle', refreshing: false, source: null, freshness: 'unknown', error: null, updatedAt: null, ...overrides };
}

export function beginResource(previous = resourceState(), hasData = false) {
  return resourceState({ ...previous, phase: hasData ? 'ready' : 'loading', refreshing: hasData, error: null });
}

export function resolveResource({ hasData = false, source = 'network', updatedAt = Date.now(), error = null } = {}) {
  return resourceState({ phase: hasData ? 'ready' : 'empty', source, freshness: source === 'cache' ? 'stale' : 'fresh', updatedAt, error });
}

export function rejectResource(previous, error, hasData = false) {
  return resourceState({ ...previous, phase: hasData ? 'ready' : 'error', refreshing: false, freshness: 'stale', error: String(error?.message ?? error ?? '读取失败') });
}

export function createRuntimeTaskRegistry(getScopeKey) {
  let sequence = 0;
  const active = new Map();
  return {
    begin(key) {
      const task = Object.freeze({ key, requestId: ++sequence, scopeKey: getScopeKey() });
      active.set(key, task);
      return task;
    },
    current(task) {
      return Boolean(task && active.get(task.key) === task && task.scopeKey === getScopeKey());
    },
    invalidate() { active.clear(); }
  };
}

export function parseWeatherCoordinates({ latitude, longitude } = {}) {
  const validInput = (value) => (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '';
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!validInput(latitude) || !validInput(longitude) || !Number.isFinite(lat) || lat < -90 || lat > 90
      || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error('请填写有效的纬度（-90 至 90）和经度（-180 至 180）。');
  }
  return { latitude: lat, longitude: lon };
}

export function refreshPresentation(resources = []) {
  if (resources.every((resource) => resource?.freshness === 'fresh' && !resource?.error)) {
    return { status: 'updated', message: '数据已更新。' };
  }
  if (resources.some((resource) => resource?.freshness === 'fresh')) {
    return { status: 'partial', message: '部分数据已更新，其余仍显示已有内容；请查看状态说明。' };
  }
  return { status: 'cached', message: '未取得最新数据，已保留可用内容；请检查连接后重试。' };
}
