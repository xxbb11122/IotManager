import { createIdempotencyKey } from '../api.js';
import { resolveConnectionRoute } from './connection-resolver.js';

export function createCommandDispatcher({
  getPlatform,
  getEndpointProfile,
  getBleAdapter,
  getBleConnected,
  isPlatformStale,
  onCommand = () => {},
  idFactory = () => createIdempotencyKey('mobile-command')
} = {}) {
  return async function dispatch({ device, type, parameters = {}, desiredState = undefined }) {
    const endpointProfile = getEndpointProfile?.() ?? null;
    const route = resolveConnectionRoute({ device, bleConnected: getBleConnected?.() === true, endpointProfile });
    const commandId = idFactory(route.accessRoute);
    const command = {
      commandId,
      idempotencyKey: commandId,
      deviceId: device.id,
      type,
      parameters,
      ...(desiredState && typeof desiredState === 'object' ? { desiredState } : {})
    };

    try {
      let result;
      if (route.accessRoute === 'BLE_LOCAL') {
        const adapter = getBleAdapter?.();
        if (!adapter) throw new Error('BLE adapter is unavailable');
        onCommand({ ...command, status: 'PENDING', ...route });
        result = await adapter.sendCommand(command);
      } else {
        if (isPlatformStale?.()) throw new Error('平台状态尚未同步，暂时不能发送控制命令。');
        const adapter = getPlatform?.();
        if (!adapter) throw new Error('Platform endpoint is unavailable');
        result = await adapter.sendCommand(command);
      }
      const completed = { ...command, ...result, ...route };
      onCommand(completed);
      return completed;
    } catch (error) {
      onCommand({ ...command, status: 'FAILED', error: error?.message ?? String(error), ...route });
      throw error;
    }
  };
}
