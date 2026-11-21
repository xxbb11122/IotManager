import { timeValue } from './device-repair.js';

export const BLE_SETUP_KEY = 'ble-setup';
const errors = new Set(['BLE_PERMISSION_DENIED', 'BLE_DISABLED', 'CONNECTION_CHECK_FAILED']);
const valueAt = (command) => command?.reportedAt ?? command?.completedAt ?? command?.updatedAt ?? command?.requestedAt ?? 0;

/** Use only session ownership and recorded feedback, never advertisements or cached "online". */
export async function readBleEvidence({ adapter, getStore, errorCode = null, targetKey = null, readField = null, now = Date.now }) {
  const before = adapter.assessmentConnection?.();
  let verified = null;
  let readAttempted = false;
  if (before?.status === 'CONNECTED') {
    try { verified = await adapter.verifyConnection?.(); }
    catch { errorCode = 'CONNECTION_CHECK_FAILED'; }
  }
  const owns = (connection) => connection?.deviceId === before?.deviceId && connection?.session === before?.session;
  let active = adapter.assessmentConnection?.();
  if (!owns(active) || active?.status !== 'CONNECTED') verified = false;
  const activeKey = active?.deviceId ? 'ble:' + active.deviceId : null;
  if (verified === true && targetKey === activeKey && readField) {
    readAttempted = true;
    try { await adapter.readAssessmentField?.(readField); }
    catch { /* A read failure cannot be "recovered" from a retained value. */ }
    active = adapter.assessmentConnection?.();
    if (!owns(active) || active?.status !== 'CONNECTED') verified = false;
  }
  const asOf = now();
  const snapshot = getStore();
  const devices = new Map((snapshot.devices ?? []).filter((row) => row.localOnly === true)
    .map((row) => ['ble:' + row.deviceId, row]));
  if (activeKey && owns(active) && !devices.has(activeKey)) devices.set(activeKey, { deviceId: active.deviceId, name: active.name });
  const commands = Object.values(snapshot.commandsById ?? {}).filter((row) => row.accessRoute === 'BLE_LOCAL');
  const items = [];
  for (const [key, row] of devices) {
    const owned = owns(active) && active?.deviceId === row.deviceId;
    const link = owned && active.status === 'DISCONNECTED' ? 'DISCONNECTED'
      : owned && verified === true ? 'CONNECTED'
        : owned && active.status === 'CONNECTED' ? 'UNKNOWN' : 'BOUND';
    const profileId = (owned ? active.profileId : null) ?? row.connections?.[0]?.profileId ?? null;
    const command = commands.filter((entry) => entry.deviceId === row.deviceId || entry.deviceId === key)
      .sort((a, b) => (timeValue(valueAt(b)) || 0) - (timeValue(valueAt(a)) || 0))[0];
    const fields = [];
    if (owned && typeof active.reportedState?.power === 'boolean' && Number.isFinite(active.reportedAt)) {
      fields.push({ key: 'power', unit: null, validity: 'RECEIPT_ONLY',
        samples: [{ value: active.reportedState.power, source: 'BLE_ACK', receivedAt: active.reportedAt, observedAt: active.reportedAt }] });
    }
    if (owned && active.readableBattery) {
      const sample = active.assessmentBattery;
      const newRead = readAttempted && readField === 'battery' && key === targetKey && sample !== before?.assessmentBattery;
      fields.push({ key: 'battery', unit: '%', validity: sample ? (newRead && verified ? 'LIVE_READ' : 'AGE_UNVERIFIED') : 'NO_SAMPLE',
        samples: sample ? [{ ...sample, receivedAt: sample.observedAt, source: newRead && verified ? 'BLE_READ' : 'BLE_PREVIOUS' }] : [] });
    }
    items.push({
      key, name: row.name ?? '本机 BLE 外设', source: 'MOBILE_BLE', asOf, demo: false,
      profileId, linkState: link, lastCommunicationAt: link === 'CONNECTED' ? asOf : owned ? active.changedAt ?? null : null,
      errorCode: owned && link === 'UNKNOWN' && errors.has(errorCode) ? errorCode : null,
      fields, command: command ? { id: command.commandId, state: command.status,
        completedAt: command.status === 'ACKNOWLEDGED' ? command.reportedAt : null,
        requestedPower: command.type === 'set_power' && typeof command.parameters?.on === 'boolean' ? command.parameters.on : null } : null
    });
  }
  const setup = { key: BLE_SETUP_KEY, name: '手机蓝牙', source: 'MOBILE_BLE', asOf, fields: [],
    linkState: items.some((device) => device.linkState === 'CONNECTED') ? 'CONNECTED' : 'UNKNOWN',
    errorCode: errors.has(errorCode) ? errorCode : null };
  return { items, setup, asOf };
}
