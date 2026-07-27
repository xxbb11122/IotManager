import './css/style.css';
import Chart from 'chart.js/auto';
import { api, esc } from './js/api.js';

/* ── Clock ── */
function tick() { document.getElementById('clock').textContent = new Date().toLocaleString('zh-CN', { hour12: false }); }
tick(); setInterval(tick, 1000);

/* ── Toast ── */
function toast(msg, isError) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + (isError ? 'error' : '');
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => el.classList.remove('show'), 3000);
}

/* ── Navigation ── */
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + el.dataset.page).classList.add('active');
    const page = el.dataset.page;
    if (page === 'dashboard') loadDashboard();
    if (page === 'devices') loadDeviceList();
    if (page === 'alerts') loadAlertList();
    if (page === 'register') resetForm();
  });
});

/* ═══════ Dashboard ═══════ */
let doughnutChart = null;

async function loadDashboard() {
  try {
    const stats = await api('/api/devices/stats');
    document.getElementById('d-total').textContent = stats.total;
    document.getElementById('d-online').textContent = stats.online;
    document.getElementById('d-warning').textContent = stats.warning;
    document.getElementById('d-offline').textContent = stats.offline;

    const ctx = document.getElementById('chart-types');
    if (doughnutChart) doughnutChart.destroy();
    const breakdown = stats.typeBreakdown || {};
    doughnutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: Object.keys(breakdown),
        datasets: [{
          data: Object.values(breakdown),
          backgroundColor: ['#3699FF','#0FE87B','#F5A623','#F64E60','#8950FC'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { color: '#7E8299', font: { size: 11 }, padding: 16 } } }
      }
    });
  } catch (e) {
    console.error('加载概览失败', e);
  }
}

/* ═══════ Device List ═══════ */
async function loadDeviceList() {
  const tbody = document.getElementById('dev-table-body');
  try {
    const devices = await api('/api/devices');
    tbody.innerHTML = devices.map(d => {
      let bc = 'badge-online';
      if (d.status==='OFFLINE') bc='badge-offline';
      else if (d.status==='WARNING') bc='badge-warning';
      else if (d.status==='MAINTENANCE') bc='badge-maintenance';
      return `<tr>
        <td>${esc(d.name)}</td>
        <td><span class="mono">${esc(d.deviceId)}</span></td>
        <td>${esc(d.type)}</td>
        <td><span class="badge ${bc}">${esc(d.status)}</span></td>
        <td>${esc(d.location||'—')}</td>
        <td>
          <button class="btn btn-ghost btn-sm edit-btn" data-id="${d.id}">编辑</button>
          <button class="btn btn-danger btn-sm del-btn" data-id="${d.id}">删除</button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty">加载失败: ' + esc(e.message) + '</div></td></tr>';
  }
}

// Delegated click handlers for device list
document.getElementById('dev-table-body').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('.edit-btn');
  const delBtn = e.target.closest('.del-btn');
  if (editBtn) editDevice(editBtn.dataset.id);
  if (delBtn) deleteDevice(delBtn.dataset.id);
});

document.getElementById('dev-search').addEventListener('input', async function() {
  const q = this.value.trim();
  let url = '/api/devices';
  if (q) url += '?search=' + encodeURIComponent(q);
  try {
    const devices = await api(url);
    document.getElementById('dev-table-body').innerHTML = devices.map(d => {
      let bc = 'badge-online';
      if (d.status==='OFFLINE') bc='badge-offline';
      else if (d.status==='WARNING') bc='badge-warning';
      else if (d.status==='MAINTENANCE') bc='badge-maintenance';
      return `<tr>
        <td>${esc(d.name)}</td><td><span class="mono">${esc(d.deviceId)}</span></td><td>${esc(d.type)}</td>
        <td><span class="badge ${bc}">${esc(d.status)}</span></td><td>${esc(d.location||'—')}</td>
        <td>
          <button class="btn btn-ghost btn-sm edit-btn" data-id="${d.id}">编辑</button>
          <button class="btn btn-danger btn-sm del-btn" data-id="${d.id}">删除</button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) { /* ignore */ }
});

/* ═══════ Register / Edit ═══════ */
function resetForm() {
  document.getElementById('edit-id').value = '';
  document.getElementById('form-title').textContent = '注册新设备';
  document.getElementById('device-form').reset();
}

async function editDevice(id) {
  try {
    const d = await api('/api/devices/' + id);
    document.getElementById('edit-id').value = d.id;
    document.getElementById('form-title').textContent = '编辑设备: ' + d.name;
    document.getElementById('f-name').value = d.name;
    document.getElementById('f-type').value = d.type;
    document.getElementById('f-protocol').value = d.protocol;
    document.getElementById('f-location').value = d.location || '';
    document.getElementById('f-firmware').value = d.firmwareVersion || '';
    document.getElementById('f-status').value = d.status || 'ONLINE';
    navigateTo('register');
  } catch (e) { toast('加载设备失败: ' + e.message, true); }
}

async function deleteDevice(id) {
  if (!confirm('确定要删除此设备吗？')) return;
  try {
    await api('/api/devices/' + id, { method: 'DELETE' });
    toast('设备已删除');
    loadDeviceList();
  } catch (e) { toast('删除失败: ' + e.message, true); }
}

function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
  const nav = document.querySelector('.nav-item[data-page="' + page + '"]');
  if (nav) nav.classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
}

document.getElementById('btn-cancel').addEventListener('click', resetForm);

document.getElementById('device-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const id = document.getElementById('edit-id').value;
  const body = {
    name: document.getElementById('f-name').value,
    type: document.getElementById('f-type').value,
    protocol: document.getElementById('f-protocol').value,
    location: document.getElementById('f-location').value,
    firmwareVersion: document.getElementById('f-firmware').value,
    status: document.getElementById('f-status').value
  };
  try {
    if (id) {
      await api('/api/devices/' + id, {
        method: 'PUT',
        body: JSON.stringify(body)
      });
      toast('设备已更新');
    } else {
      await api('/api/devices', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      toast('设备已注册');
    }
    resetForm();
  } catch (err) {
    toast('操作失败: ' + err.message, true);
  }
});

/* ═══════ Alerts ═══════ */
async function loadAlertList() {
  try {
    const alerts = await api('/api/alerts');
    const container = document.getElementById('alerts-list');
    if (!alerts || alerts.length === 0) {
      container.innerHTML = '<div class="empty">暂无告警记录</div>';
      return;
    }
    container.innerHTML = alerts.map(a => {
      let lvlClr = a.level === 'CRITICAL' ? 'var(--red)' : a.level === 'WARNING' ? 'var(--amber)' : 'var(--blue)';
      let time = a.createdAt ? new Date(a.createdAt).toLocaleString('zh-CN', { hour12: false }) : '';
      let status = a.resolved ? '✅ 已解决' : '⏳ 待处理';
      return `<div class="alert-item">
        <div><span style="color:${lvlClr};font-weight:600;">[${esc(a.level)}]</span> ${esc(a.message)} <span style="color:var(--text2);font-size:0.6875rem;">${esc(a.device?.name||'')}</span></div>
        <div style="display:flex;align-items:center;gap:1rem;">
          <span style="color:var(--text2);font-size:0.75rem;">${time}</span>
          <span style="font-size:0.75rem;">${status}</span>
          ${!a.resolved ? '<button class="btn btn-ghost btn-sm resolve-btn" data-id="' + a.id + '">解决</button>' : ''}
        </div>
      </div>`;
    }).join('');
  } catch (e) { /* ignore */ }
}

document.getElementById('alerts-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('.resolve-btn');
  if (!btn) return;
  try {
    await api('/api/alerts/' + btn.dataset.id + '/resolve', { method: 'PUT' });
    toast('告警已解决');
    loadAlertList();
  } catch (e) { toast('操作失败: ' + e.message, true); }
});

/* ── Init ── */
loadDashboard();
