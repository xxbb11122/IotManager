function deviceTransport(device = {}) {
  return device.connections?.find((connection) => connection?.status === 'CONNECTED')?.transport
    ?? device.connections?.[0]?.transport
    ?? 'UNKNOWN';
}

export function resolveConnectionRoute({ device, bleConnected = false, endpointProfile = null } = {}) {
  if (!device) throw new TypeError('Connection route requires a device');
  if (device.localOnly === true) {
    if (!bleConnected) throw new Error('BLE device is disconnected; reconnect before control');
    return { accessRoute: 'BLE_LOCAL', deviceTransport: 'BLE_DIRECT' };
  }
  if (!endpointProfile?.accessRoute) throw new Error('Platform endpoint is unavailable');
  return { accessRoute: endpointProfile.accessRoute, deviceTransport: deviceTransport(device) };
}
