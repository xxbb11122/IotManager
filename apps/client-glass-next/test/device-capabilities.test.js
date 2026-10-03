import assert from 'node:assert/strict';
import test from 'node:test';

import {
  capabilityCommandInput,
  capabilityDesiredState,
  capabilityValue,
  isControllableCapability,
  resolveDeviceCapabilities
} from '../src/js/device-capabilities.js';

test('backend Profile envelopes drive arbitrary client controls without legacy defaults', () => {
  const capabilities = resolveDeviceCapabilities({
    profileId: 'ignored-by-envelope',
    capabilities: {
      profileId: 'hvac-controller-v2',
      version: '2.1.0',
      controls: [{
        id: 'fan_speed',
        label: 'Fan speed',
        inputType: 'range',
        stateKey: 'fanSpeed',
        command: { type: 'set_fan_speed', parameterKey: 'speed' },
        min: 1,
        max: 5,
        step: 1
      }, {
        id: 'self_test',
        label: 'Run self test',
        controlType: 'action',
        commandType: 'run_self_test',
        parameters: { verbose: false }
      }]
    }
  });

  assert.equal(capabilities.profileId, 'hvac-controller-v2');
  assert.equal(capabilities.version, '2.1.0');
  assert.equal(capabilities.known, true);
  assert.equal(capabilities.controls[0].controlType, 'range');
  assert.equal(capabilities.controls[0].commandType, 'set_fan_speed');
  assert.equal(capabilities.controls[0].parameterKey, 'speed');
  assert.deepEqual(capabilities.controls[1].fixedParameters, { verbose: false });
  assert.equal(isControllableCapability(capabilities.controls[0]), true);
});

test('connection Profile capabilities remain usable when a DeviceView has no top-level envelope', () => {
  const capabilities = resolveDeviceCapabilities({
    id: 7,
    connections: [{ transport: 'LAN_AGENT', profileId: 'relay-v1' }]
  }, {
    profileId: 'relay-v1',
    capabilities: {
      known: true,
      controls: [{ id: 'relay_a', valueType: 'boolean', commandType: 'set_relay_a' }]
    }
  });

  const relay = capabilities.controls[0];
  assert.equal(capabilities.profileId, 'relay-v1');
  assert.equal(relay.controlType, 'toggle');
  assert.deepEqual(capabilityCommandInput(relay, true), { relay_a: true });
  assert.deepEqual(capabilityDesiredState(relay, true), { relay_a: true });
  assert.equal(capabilityValue(relay, { relay_a: false }, { relay_a: true }), false);
});

test('command metadata fills state and parameter mappings omitted by the control', () => {
  const capabilities = resolveDeviceCapabilities({
    capabilities: {
      controls: [{ id: 'target_temperature', kind: 'range', commandType: 'set_target_temperature' }],
      commands: [{
        type: 'set_target_temperature',
        stateField: 'setpointCelsius',
        stateParameter: 'degrees',
        parameters: { degrees: { type: 'number', min: 16, max: 30, step: 0.5 } }
      }]
    }
  });

  const control = capabilities.controls[0];
  assert.equal(control.stateKey, 'setpointCelsius');
  assert.equal(control.parameterKey, 'degrees');
  assert.equal(control.min, 16);
  assert.equal(control.max, 30);
  assert.equal(control.step, 0.5);
});
