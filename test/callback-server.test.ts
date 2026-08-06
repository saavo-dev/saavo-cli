import assert from 'node:assert/strict';
import { test } from 'vitest';
import { startLoopbackCallback } from '../src/oauth/callback-server.js';

test('receives an OAuth redirect on a dynamic IPv4 loopback port', async () => {
  const callback = await startLoopbackCallback(1_000);

  try {
    const redirectUri = new URL(callback.redirectUri);
    assert.equal(redirectUri.protocol, 'http:');
    assert.equal(redirectUri.hostname, '127.0.0.1');
    assert.notEqual(redirectUri.port, '');
    assert.equal(redirectUri.pathname, '/oauth/callback');

    const expected = new URL(callback.redirectUri);
    expected.searchParams.set('code', 'code');
    expected.searchParams.set('state', 'state');

    const [response, received] = await Promise.all([
      fetch(expected),
      callback.waitForRedirect(),
    ]);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(received.searchParams.get('code'), 'code');
    assert.equal(received.searchParams.get('state'), 'state');
  } finally {
    await callback.close();
  }
});

test('shows a denial-specific browser response', async () => {
  const callback = await startLoopbackCallback(1_000);

  try {
    const denied = new URL(callback.redirectUri);
    denied.searchParams.set('error', 'access_denied');
    denied.searchParams.set('state', 'state');

    const [response] = await Promise.all([
      fetch(denied),
      callback.waitForRedirect(),
    ]);
    const body = await response.text();

    assert.match(body, /Authorization denied/u);
    assert.match(body, /No credentials were shared/u);
  } finally {
    await callback.close();
  }
});
