import { describe, expect, test } from 'vitest';
import { accountListItems, matchingAccounts } from '../src/commands/account.js';
import type { StoredAccount } from '../src/auth/token-store.js';

const accounts: StoredAccount[] = [
  {
    user: {
      key: 'id:user-1',
      id: 'user-1',
      name: 'Alice',
      email: 'Alice@Example.com',
    },
    credentials: {
      accessToken: 'alice-secret-token',
      tokenType: 'bearer',
      scope: 'user templates:read',
      expiresAt: '2026-08-06T02:00:00.000Z',
      issuer: 'https://issuer.example/',
      clientId: 'public-cli-client',
    },
  },
  {
    user: {
      key: 'email:bob@example.com',
      name: 'Bob',
      email: 'bob@example.com',
    },
    credentials: {
      accessToken: 'bob-secret-token',
      tokenType: 'bearer',
      scope: 'user templates:read',
      expiresAt: '2026-08-06T00:00:00.000Z',
      issuer: 'https://issuer.example/',
      clientId: 'public-cli-client',
    },
  },
];

describe('account commands', () => {
  test('matches by user ID, key, or normalized email', () => {
    expect(matchingAccounts(accounts, 'user-1')).toEqual([accounts[0]]);
    expect(matchingAccounts(accounts, 'id:user-1')).toEqual([accounts[0]]);
    expect(matchingAccounts(accounts, 'alice@example.COM')).toEqual([accounts[0]]);
  });

  test('lists metadata and status without exposing tokens', () => {
    const items = accountListItems(
      accounts,
      accounts[0]!,
      new Date('2026-08-06T01:00:00.000Z'),
    );

    expect(items.map((item) => ({ active: item.active, status: item.status }))).toEqual([
      { active: true, status: 'valid' },
      { active: false, status: 'expired' },
    ]);
    expect(JSON.stringify(items)).not.toContain('secret-token');
  });
});
