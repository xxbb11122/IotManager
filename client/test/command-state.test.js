import assert from 'node:assert/strict';
import test from 'node:test';

import { isTerminalCommandStatus, transitionCommand } from '../src/js/command-state.js';

test('acknowledgement commits the confirmed reported state', () => {
  const device = {
    desiredState: { power: true },
    reportedState: { power: false }
  };

  const next = transitionCommand(device, {
    commandId: 'command-1',
    status: 'ACKNOWLEDGED',
    reportedState: { power: true }
  });

  assert.deepEqual(next.reportedState, { power: true });
  assert.deepEqual(next.desiredState, { power: true });
  assert.equal(next.commandStatus, 'ACKNOWLEDGED');
  assert.deepEqual(device.reportedState, { power: false });
});

test('pending command leaves the reported state untouched while recording the desired target', () => {
  const next = transitionCommand(
    { desiredState: { power: false }, reportedState: { power: false } },
    {
      commandId: 'command-2',
      status: 'PENDING',
      type: 'set_power',
      parameters: { on: true }
    }
  );

  assert.deepEqual(next.desiredState, { power: true });
  assert.deepEqual(next.reportedState, { power: false });
  assert.equal(next.commandStatus, 'PENDING');
});

test('pending backend view prefers its desired state over its stale reported state', () => {
  const next = transitionCommand(
    { desiredState: { power: false }, reportedState: { power: false } },
    {
      commandId: 'command-3',
      status: 'PENDING',
      type: 'set_power',
      desiredState: { power: true },
      reportedState: { power: false },
      parameters: { on: true }
    }
  );

  assert.deepEqual(next.desiredState, { power: true });
  assert.deepEqual(next.reportedState, { power: false });
});

test('unconfirmed BLE delivery never changes reported state', () => {
  const next = transitionCommand(
    { desiredState: { power: false }, reportedState: { power: false } },
    { commandId: 'ble-1', type: 'set_power', parameters: { on: true }, status: 'UNCONFIRMED' }
  );
  assert.deepEqual(next.reportedState, { power: false });
  assert.equal(next.commandStatus, 'UNCONFIRMED');
  assert.equal(isTerminalCommandStatus(next.commandStatus), true);
});
