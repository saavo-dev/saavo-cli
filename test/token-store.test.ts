import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import {
  activateAccount,
  credentialsCanRefresh,
  activeAccount,
  credentialsAreValid,
  credentialsFromTokenResponse,
  defaultCredentialsPath,
  logoutActiveAccount,
  readCredentialState,
  refreshedCredentialsFromTokenResponse,
  saveAccount,
} from '../src/auth/token-store.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

test('reuses matching credentials that have not expired', () => {
  expect(credentialsAreValid({
    accessToken: 'access-token',
    tokenType: 'bearer',
    scope: 'templates:read user',
    expiresAt: '2026-08-06T02:00:00.000Z',
    issuer: 'https://issuer.example/',
    clientId: 'public-cli-client',
  }, {
    issuer: 'https://issuer.example/',
    clientId: 'public-cli-client',
    scopes: ['templates:read'],
  }, new Date('2026-08-06T01:00:00.000Z'))).toBe(true);
});

test.each([
  ['expired', {
    expiresAt: '2026-08-06T00:59:59.000Z',
  }],
  ['near expiry', {
    expiresAt: '2026-08-06T01:00:20.000Z',
  }],
  ['different client', {
    clientId: 'another-client',
  }],
  ['different issuer', {
    issuer: 'https://another-issuer.example/',
  }],
  ['missing scope', {
    scope: 'user',
  }],
] as const)('does not reuse %s credentials', (_name, override) => {
  expect(credentialsAreValid({
    accessToken: 'access-token',
    tokenType: 'bearer',
    scope: 'templates:read',
    expiresAt: '2026-08-06T02:00:00.000Z',
    issuer: 'https://issuer.example/',
    clientId: 'public-cli-client',
    ...override,
  }, {
    issuer: 'https://issuer.example/',
    clientId: 'public-cli-client',
    scopes: ['templates:read'],
  }, new Date('2026-08-06T01:00:00.000Z'))).toBe(false);
});

test('refreshes only matching credentials with a refresh token and sufficient scopes', () => {
  const requirements = {
    issuer: 'https://issuer.example/',
    clientId: 'public-cli-client',
    scopes: ['user', 'templates:read'],
  };
  const credentials = {
    accessToken: 'expired-token',
    refreshToken: 'refresh-token',
    tokenType: 'bearer',
    scope: 'user templates:read',
    expiresAt: '2026-08-06T00:00:00.000Z',
    issuer: 'https://issuer.example/',
    clientId: 'public-cli-client',
  };

  expect(credentialsCanRefresh(credentials, requirements)).toBe(true);
  expect(credentialsCanRefresh({ ...credentials, refreshToken: undefined }, requirements))
    .toBe(false);
  expect(credentialsCanRefresh({ ...credentials, scope: 'templates:read' }, requirements))
    .toBe(false);
});

test('keeps the previous refresh token and scope when rotation omits them', () => {
  const credentials = refreshedCredentialsFromTokenResponse({
    access_token: 'new-access-token',
    token_type: 'bearer',
    expires_in: 3_600,
  }, {
    accessToken: 'old-access-token',
    refreshToken: 'old-refresh-token',
    tokenType: 'bearer',
    scope: 'user templates:read',
    issuer: 'https://issuer.example/',
    clientId: 'public-cli-client',
  }, new Date('2026-08-06T01:00:00.000Z'));

  expect(credentials).toEqual({
    accessToken: 'new-access-token',
    refreshToken: 'old-refresh-token',
    tokenType: 'bearer',
    scope: 'user templates:read',
    expiresAt: '2026-08-06T02:00:00.000Z',
    issuer: 'https://issuer.example/',
    clientId: 'public-cli-client',
  });
});

test('uses SAAVO_CONFIG_DIR for the credential file', () => {
  vi.stubEnv('SAAVO_CONFIG_DIR', resolve('custom-config-directory'));

  expect(defaultCredentialsPath()).toBe(
    resolve('custom-config-directory', 'credentials.json'),
  );
});

test('converts expires_in into an absolute credential expiry', () => {
  const credentials = credentialsFromTokenResponse({
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: 3_600,
    scope: 'templates:read',
  }, {
    issuer: 'https://issuer.example/',
    clientId: 'public-cli-client',
    now: new Date('2026-08-05T00:00:00.000Z'),
  });

  assert.deepEqual(credentials, {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenType: 'bearer',
    scope: 'templates:read',
    expiresAt: '2026-08-05T01:00:00.000Z',
    issuer: 'https://issuer.example/',
    clientId: 'public-cli-client',
  });
});

test('stores multiple users separately and activates the latest login', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saavo-cli-test-'));
  const path = join(directory, 'credentials.json');
  const baseCredentials = {
    accessToken: 'alice-token',
    tokenType: 'bearer',
    scope: 'user templates:read',
    issuer: 'https://issuer.example/',
    clientId: 'public-cli-client',
  };

  try {
    await saveAccount({
      user: {
        key: 'id:user-1',
        id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
      },
      credentials: baseCredentials,
    }, path);
    await saveAccount({
      user: {
        key: 'email:bob@example.com',
        name: 'Bob',
        email: 'bob@example.com',
      },
      credentials: { ...baseCredentials, accessToken: 'bob-token' },
    }, path);

    const state = await readCredentialState(path);
    expect(state.legacy).toBeNull();
    expect(state.store?.accounts).toHaveLength(2);
    expect(state.store && activeAccount(state.store)?.user).toEqual({
      key: 'email:bob@example.com',
      name: 'Bob',
      email: 'bob@example.com',
    });

    const activated = await activateAccount(
      'https://issuer.example/',
      'id:user-1',
      path,
    );
    expect(activated?.user.email).toBe('alice@example.com');

    const switchedState = await readCredentialState(path);
    expect(switchedState.store && activeAccount(switchedState.store)?.user.email)
      .toBe('alice@example.com');

    const firstLogout = await logoutActiveAccount(path);
    expect(firstLogout.removed?.user.email).toBe('alice@example.com');
    expect(firstLogout.active?.user.email).toBe('bob@example.com');
    expect(firstLogout.remaining).toBe(1);

    const afterFirstLogout = await readCredentialState(path);
    expect(afterFirstLogout.store?.accounts).toHaveLength(1);
    expect(afterFirstLogout.store && activeAccount(afterFirstLogout.store)?.user.email)
      .toBe('bob@example.com');

    const secondLogout = await logoutActiveAccount(path);
    expect(secondLogout.removed?.user.email).toBe('bob@example.com');
    expect(secondLogout.active).toBeNull();
    expect(secondLogout.remaining).toBe(0);
    expect(await readCredentialState(path)).toEqual({ store: null, legacy: null });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
