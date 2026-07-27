import assert from 'node:assert/strict';
import test from 'node:test';

import * as ui from '../src/js/ui.js';

const { deviceScreenState } = ui;

test('BLE selection instructions match the active client runtime', () => {
  assert.equal(ui.bleSelectionDescription?.(true), '手机客户端会扫描并列出附近的蓝牙设备。');
  assert.equal(ui.bleSelectionDescription?.(false), '选择操作将打开浏览器提供的蓝牙设备窗口。');
});

test('unknown BLE profile has metadata but no command controls', () => {
  const screen = deviceScreenState({
    connection: { transport: 'BLE_DIRECT', profileId: null },
    capabilities: []
  });

  assert.equal(screen.showControls, false);
  assert.match(screen.notice, /暂无可用控制能力/);
});

test('stale platform state disables controls without hiding capabilities', () => {
  const screen = deviceScreenState({
    connections: [{ transport: 'LAN_AGENT', profileId: 'lan-agent-v1' }],
    capabilities: [{ id: 'power', writable: true }]
  }, { accessRoute: 'CLOUD_API', stale: true });
  assert.equal(screen.showControls, false);
  assert.equal(screen.controls.length, 1);
  assert.match(screen.notice, /缓存|同步/);
});
