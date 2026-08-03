import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlatformAdapter } from '../src/js/platform/platform-adapter-factory.js';

test('creates one platform session bound to one immutable endpoint', async () => {
  const requests = [];
  const session = createPlatformAdapter({
    endpointProfile: {
      id: 'site-a',
      accessRoute: 'SITE_API',
      apiBaseUrl: 'http://10.0.0.8:8080/api',
      wsUrl: 'ws://10.0.0.8:8080/ws/devices'
    },
    fetchImpl: async (url) => {
      requests.push(url);
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    },
    webSocketFactory: () => ({ readyState: 3, close() {} })
  });
  await session.adapter.listDevices();
  assert.equal(session.accessRoute, 'SITE_API');
  assert.equal(requests[0], 'http://10.0.0.8:8080/api/devices');
});
