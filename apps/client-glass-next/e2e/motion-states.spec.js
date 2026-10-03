import { expect, test } from '@playwright/test';

test('command motion never presents an unconfirmed target as reported state', async ({ page }) => {
  // Isolate this DOM fixture from the real runtime and all backend adapters.
  await page.route('**/__motion-state-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/src/css/style.css"></head><body></body></html>' }));
  await page.goto('/__motion-state-fixture');
  await page.evaluate(async () => {
    const { createClientUi } = await import('/src/js/ui.js');
    const root = document.createElement('div');
    root.id = 'motion-fixture';
    document.body.replaceChildren(root);
    const device = {
      id: 'd1', deviceId: 'd1', displayName: '测试继电器',
      connections: [{ transport: 'LAN_AGENT', profileId: 'relay-v1', status: 'CONNECTED' }],
      capabilities: {
        profileId: 'relay-v1',
        controls: [
          { id: 'relay_a', label: '电源', valueType: 'boolean', stateKey: 'relay_a', commandType: 'set_relay_a' },
          { id: 'level', label: '强度', inputType: 'range', stateKey: 'level', commandType: 'set_level', min: 0, max: 100, step: 1 }
        ]
      },
      desiredState: { relay_a: false, level: 20 },
      reportedState: { relay_a: false, level: 20 }
    };
    const ui = createClientUi(root, { openDevice: () => undefined });
    const base = {
      devices: [device], activeDeviceId: 'd1', runtime: { accessRoute: 'SITE_API', stale: false },
      connectionHealth: { status: 'CONNECTED' }, commandsById: {}, activitiesByDeviceId: { d1: [] }
    };
    ui.render(base);
    root.querySelector('[data-action="open-device"]').click();
    window.__setCommandMotionState = (id, status, desired, reported) => {
      const snapshot = {
        ...base,
        devices: [{ ...device, desiredState: { ...device.desiredState, relay_a: desired }, reportedState: { ...device.reportedState, relay_a: reported } }],
        commandsById: {
          [id]: { id, commandId: id, deviceId: 'd1', status, type: 'set_relay_a', createdAt: '2026-09-25T08:00:00Z' }
        }
      };
      ui.patchDevices(['d1'], snapshot);
      ui.patchCommands(['d1'], snapshot);
    };
    window.__addActivityMotion = (activity) => ui.patchActivity(['d1'], {
      ...base, activeDeviceId: 'd1', activitiesByDeviceId: { d1: [activity] }
    });
    window.__patchMotionDevice = (relay, level) => ui.patchDevices(['d1'], {
      ...base, devices: [{ ...device, reportedState: { relay_a: relay, level } }]
    });
    window.__setMotionStale = () => ui.patchRuntime({
      ...base, runtime: { ...base.runtime, stale: true }
    });
  });

  await page.evaluate(() => window.__addActivityMotion({
    id: 'a1', deviceId: 'd1', eventType: 'COMMAND_ACKNOWLEDGED', timestamp: '2026-09-25T08:00:00Z'
  }));
  await expect(page.locator('#motion-fixture .timeline-item.motion-reveal')).toHaveCount(1);
  await page.evaluate(() => window.__addActivityMotion({
    id: 'a1', deviceId: 'd1', eventType: 'COMMAND_ACKNOWLEDGED', timestamp: '2026-09-25T08:00:00Z'
  }));
  await expect(page.locator('#motion-fixture .timeline-item.motion-reveal')).toHaveCount(0);

  await page.locator('#motion-fixture .switch-button').focus();
  await page.evaluate(() => window.__patchMotionDevice(true, 20));
  await expect(page.locator('#motion-fixture .switch-button')).toHaveClass(/switch-button--on/);
  await expect(page.locator('#motion-fixture .switch-button')).toBeFocused();
  await page.evaluate(() => window.__patchMotionDevice(false, 20));
  await expect(page.locator('#motion-fixture .switch-button')).not.toHaveClass(/switch-button--on/);

  const range = page.locator('#motion-fixture .range-input');
  await range.focus();
  await range.dispatchEvent('pointerdown', { pointerId: 88, pointerType: 'mouse' });
  await range.evaluate((input) => {
    window.__motionRangeNode = input;
    input.value = '60';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => window.__patchMotionDevice(false, 35));
  expect(await range.evaluate((input) => input === window.__motionRangeNode)).toBe(true);
  await expect(range).toHaveValue('60');
  await range.dispatchEvent('pointerup', { pointerId: 88, pointerType: 'mouse' });
  await expect(range).toHaveValue('35');

  await page.locator('#motion-fixture .switch-button').focus();
  await page.evaluate(() => window.__setCommandMotionState('c1', 'PENDING', true, false));
  await expect(page.locator('#motion-fixture .switch-button')).toHaveClass(/switch-button--pending/);
  await expect(page.locator('#motion-fixture .switch-button')).toBeDisabled();
  await expect(page.locator('#motion-fixture [data-region="device-controls"]')).toContainText('目标：开启（待确认）');
  await expect(page.locator('#motion-fixture [data-region="device-state"]')).toContainText('已上报状态');
  await expect(page.locator('#motion-fixture [data-region="device-state"]')).toContainText('关闭');
  const switchSize = await page.locator('#motion-fixture .switch-button').evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(switchSize.width).toBeGreaterThanOrEqual(48);
  expect(switchSize.height).toBeGreaterThanOrEqual(48);

  await page.evaluate(() => window.__setCommandMotionState('c1', 'SENT', true, false));
  await expect(page.locator('#motion-fixture .command-card')).toContainText('等待回执');
  await expect(page.locator('#motion-fixture .switch-button')).toHaveClass(/switch-button--pending/);

  await page.evaluate(() => window.__setCommandMotionState('c1', 'ACKNOWLEDGED', true, true));
  await expect(page.locator('#motion-fixture .command-card')).toHaveClass(/command-card--confirmed/);
  await expect(page.locator('#motion-fixture .switch-button')).toHaveClass(/switch-button--on/);
  await expect(page.locator('#motion-fixture .switch-button')).not.toHaveClass(/switch-button--pending/);
  await expect(page.locator('#motion-fixture [data-region="device-state"]')).toContainText('开启');
  await expect.poll(() => page.evaluate(() => document.activeElement?.dataset?.action))
    .toBe('command-capability-toggle');

  await page.evaluate(() => window.__setCommandMotionState('c2', 'PENDING', false, true));
  await expect(page.locator('#motion-fixture .switch-button')).toHaveClass(/switch-button--pending/);
  await page.evaluate(() => window.__setCommandMotionState('c2', 'FAILED', false, true));
  await expect(page.locator('#motion-fixture .command-card')).toContainText('失败');
  await expect(page.locator('#motion-fixture .command-card')).toContainText('重试命令');
  await expect(page.locator('#motion-fixture .switch-button')).toHaveClass(/switch-button--on/);
  await expect(page.locator('#motion-fixture .switch-button')).not.toHaveClass(/switch-button--pending/);

  await page.evaluate(() => window.__setCommandMotionState('c3', 'PENDING', false, true));
  await page.evaluate(() => window.__setCommandMotionState('c3', 'UNCONFIRMED', false, true));
  await expect(page.locator('#motion-fixture .command-card')).toContainText('结果未确认');
  await expect(page.locator('#motion-fixture .command-card')).toContainText('不会自动重发命令');
  await expect(page.locator('#motion-fixture .command-card [data-action="retry-command"]')).toHaveCount(0);
  await expect(page.locator('#motion-fixture .switch-button')).toHaveClass(/switch-button--on/);

  await page.locator('#motion-fixture .switch-button').focus();
  await page.evaluate(() => window.__setMotionStale());
  await expect(page.locator('#motion-fixture [data-region="device-controls"]')).toContainText('当前显示缓存状态');
  await expect(page.locator('#motion-fixture .switch-button')).toHaveCount(0);
});
