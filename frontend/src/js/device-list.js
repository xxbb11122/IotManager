let _devices = [];

export function setDevices(arr) { _devices = arr; }

export function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function applyFilter(devices, statusFilter, typeFilter, search) {
  let filtered = devices;
  if (statusFilter && statusFilter !== 'all') {
    filtered = filtered.filter(d => d.status === statusFilter);
  }
  if (typeFilter) {
    filtered = filtered.filter(d => d.type === typeFilter);
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(d =>
      (d.name || '').toLowerCase().includes(q) ||
      (d.deviceId || '').toLowerCase().includes(q)
    );
  }
  return filtered;
}

function deviceRow(d) {
  const temp = d.temperature != null ? d.temperature.toFixed(1) + '°C' : '—';
  const cpu = d.cpuUsage != null ? d.cpuUsage.toFixed(0) + '%' : '—';
  const sig = d.signalStrength != null ? d.signalStrength.toFixed(0) + ' dBm' : '—';
  const seen = d.lastSeen ? new Date(d.lastSeen).toLocaleString('zh-CN', { hour12: false }) : '—';
  let bc = 'badge-online';
  if (d.status === 'OFFLINE') bc = 'badge-offline';
  else if (d.status === 'WARNING') bc = 'badge-warning';
  else if (d.status === 'MAINTENANCE') bc = 'badge-maintenance';
  return `<tr data-device-id="${esc(d.deviceId)}">
    <td><strong>${esc(d.name)}</strong><br><span style="color:var(--text2);font-size:0.6875rem;">${esc(d.location || '—')}</span></td>
    <td><span class="mono">${esc(d.deviceId)}</span></td>
    <td>${esc(d.type)}</td>
    <td>${esc(d.protocol)}</td>
    <td><span class="badge ${bc}">${esc(d.status)}</span></td>
    <td>${temp}</td>
    <td>${cpu}</td>
    <td>${sig}</td>
    <td>${seen}</td>
  </tr>`;
}

function updateEmptyState(tbody) {
  const empty = document.getElementById('device-empty');
  if (empty) empty.style.display = tbody.children.length ? 'none' : 'block';
}

export function renderDevices(devices) {
  const tbody = document.getElementById('device-tbody');
  if (!tbody) return;
  tbody.innerHTML = devices?.length ? devices.map(deviceRow).join('') : '';
  updateEmptyState(tbody);
}

// Telemetry events are high-frequency. Updating only their row preserves the
// operator's scroll position and prevents a visible whole-table refresh.
export function patchDevice(device, isVisible) {
  const tbody = document.getElementById('device-tbody');
  if (!tbody || !device?.deviceId) return;
  const existing = [...tbody.querySelectorAll('tr[data-device-id]')]
    .find((row) => row.dataset.deviceId === String(device.deviceId));
  if (!isVisible) {
    existing?.remove();
  } else if (existing) {
    existing.outerHTML = deviceRow(device);
  } else {
    tbody.insertAdjacentHTML('afterbegin', deviceRow(device));
  }
  updateEmptyState(tbody);
}

export function renderAlerts(alerts) {
  const container = document.getElementById('alerts-container');
  if (!container) return;
  if (!alerts || alerts.length === 0) {
    container.innerHTML = '<div class="empty">🎉 当前没有活跃告警</div>';
    return;
  }
  container.innerHTML = alerts.map(a => {
    let lvlClr = a.level === 'CRITICAL' ? 'var(--red)' : a.level === 'WARNING' ? 'var(--amber)' : 'var(--blue)';
    let time = a.createdAt ? new Date(a.createdAt).toLocaleString('zh-CN', { hour12: false }) : '';
    return `<div class="alert-item">
      <div><span style="color:${lvlClr};font-weight:600;">[${esc(a.level)}]</span> ${esc(a.message)}</div>
      <div style="display:flex;align-items:center;gap:1rem;">
        <span class="alert-time">${time}</span>
        <button class="btn-resolve" data-id="${a.id}">解决</button>
      </div>
    </div>`;
  }).join('');
}

export function renderStats(stats) {
  const ids = { total: 'stat-total', online: 'stat-online', warning: 'stat-warning', offline: 'stat-offline' };
  Object.entries(ids).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = stats[key] ?? 0;
  });
  // Sidebar counts
  const sideIds = { 'cnt-all': stats.total, 'cnt-online': stats.online, 'cnt-warning': stats.warning, 'cnt-offline': stats.offline };
  Object.entries(sideIds).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? 0;
  });
  // Type counts
  if (stats.typeBreakdown) {
    ['SENSOR', 'GATEWAY', 'ACTUATOR', 'CAMERA'].forEach(t => {
      const el = document.getElementById('cnt-' + t.toLowerCase());
      if (el) el.textContent = stats.typeBreakdown[t] || 0;
    });
  }
}
