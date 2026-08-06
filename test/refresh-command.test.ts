import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  activeAccount,
  readCredentialState,
  saveAccount,
} from '../src/auth/token-store.js';
import { forceRefresh } from '../src/commands/refresh.js';

const baseConfig = {
  issuer: new URL('https://issuer.example'),
  authorizationEndpoint: new URL('https://issuer.example/authorize'),
  tokenEndpoint: new URL('https://issuer.example/token'),
  clientId: 'public-cli-client',
  scopes: ['user', 'templates:read'],
  allowInsecure: false,
};

describe('forced token refresh command', () => {
  test('refreshes and persists the active account without browser authorization', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'saavo-cli-refresh-test-'));
    const path = join(directory, 'credentials.json');
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify({
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      }));
    });

    try {
      await saveAccount({
        user: {
          key: 'email:alice@example.com',
          name: 'Alice',
          email: 'alice@example.com',
        },
        credentials: {
          accessToken: 'old-access-token',
          refreshToken: 'refresh-token',
          tokenType: 'bearer',
          scope: 'user templates:read',
          expiresAt: '2026-08-06T00:00:00.000Z',
          issuer: 'https://issuer.example/',
          clientId: 'public-cli-client',
        },
      }, path);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      expect(address && typeof address !== 'string').toBe(true);
      if (!address || typeof address === 'string') throw new Error('Missing test server port.');

      await forceRefresh({
        ...baseConfig,
        tokenEndpoint: new URL(`http://127.0.0.1:${address.port}/token`),
        allowInsecure: true,
      }, new URL('https://issuer.example/oauth/current-user'), path);

      const state = await readCredentialState(path);
      expect(state.store && activeAccount(state.store)?.credentials.accessToken)
        .toBe('new-access-token');
      expect(state.store && activeAccount(state.store)?.credentials.refreshToken)
        .toBe('refresh-token');
    } finally {
      await new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => error ? reject(error) : resolve());
      });
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('fails clearly when the active account has no Refresh Token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'saavo-cli-refresh-test-'));
    const path = join(directory, 'credentials.json');

    try {
      await saveAccount({
        user: {
          key: 'email:alice@example.com',
          name: 'Alice',
          email: 'alice@example.com',
        },
        credentials: {
          accessToken: 'access-token',
          tokenType: 'bearer',
          scope: 'user templates:read',
          issuer: 'https://issuer.example/',
          clientId: 'public-cli-client',
        },
      }, path);

      await expect(forceRefresh(
        baseConfig,
        new URL('https://issuer.example/oauth/current-user'),
        path,
      )).rejects.toThrow(/no Refresh Token/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
