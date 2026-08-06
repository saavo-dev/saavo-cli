import * as clack from '@clack/prompts';
import {
  activateAccount,
  activeAccount,
  readCredentialState,
  type StoredAccount,
} from '../auth/token-store.js';

export interface AccountListItem {
  active: boolean;
  key: string;
  id?: string | undefined;
  name: string;
  email: string;
  issuer: string;
  scope?: string | undefined;
  expiresAt?: string | undefined;
  status: 'valid' | 'expired' | 'unknown';
  isPremium?: boolean | undefined;
  permissions?: Record<string, boolean> | undefined;
}

function expirationStatus(
  account: StoredAccount,
  now = new Date(),
): AccountListItem['status'] {
  if (!account.credentials.expiresAt) return 'unknown';
  const expiresAt = Date.parse(account.credentials.expiresAt);
  if (!Number.isFinite(expiresAt)) return 'unknown';
  return expiresAt > now.getTime() ? 'valid' : 'expired';
}

export function accountListItems(
  accounts: StoredAccount[],
  active: StoredAccount | null,
  now = new Date(),
): AccountListItem[] {
  return accounts.map((account) => ({
    active: active?.credentials.issuer === account.credentials.issuer
      && active.user.key === account.user.key,
    key: account.user.key,
    id: account.user.id,
    name: account.user.name,
    email: account.user.email,
    issuer: account.credentials.issuer,
    scope: account.credentials.scope,
    expiresAt: account.credentials.expiresAt,
    status: expirationStatus(account, now),
    isPremium: account.user.isPremium,
    permissions: account.user.permissions,
  }));
}

export function matchingAccounts(
  accounts: StoredAccount[],
  selector: string,
  issuer?: string,
): StoredAccount[] {
  const trimmedSelector = selector.trim();
  const normalizedEmail = trimmedSelector.toLowerCase();
  return accounts.filter((account) => {
    const matchesIdentity = account.user.key === trimmedSelector
      || account.user.id === trimmedSelector
      || account.user.email.trim().toLowerCase() === normalizedEmail;
    return matchesIdentity && (!issuer || account.credentials.issuer === issuer);
  });
}

function accountLabel(account: StoredAccount): string {
  return `${account.user.name} <${account.user.email}>`;
}

export async function listAccounts(options: { json?: boolean } = {}): Promise<void> {
  const state = await readCredentialState();
  if (!state.store) {
    if (state.legacy) {
      clack.log.warn('Legacy credentials have no account identity. Run `saavo login` to migrate them.');
    } else {
      clack.log.info('No accounts are stored. Run `saavo login` first.');
    }
    return;
  }

  const current = activeAccount(state.store);
  const items = accountListItems(state.store.accounts, current);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ accounts: items }, null, 2)}\n`);
    return;
  }

  for (const item of items) {
    const marker = item.active ? '*' : ' ';
    const expiration = item.expiresAt ?? 'not provided';
    clack.log.info(
      `${marker} ${item.name} <${item.email}>\n  Key: ${item.key}\n  Issuer: ${item.issuer}\n  Token: ${item.status} (expires: ${expiration})`,
    );
  }
}

export async function useAccount(
  selector?: string,
  issuerInput?: string,
): Promise<void> {
  const state = await readCredentialState();
  if (!state.store || state.store.accounts.length === 0) {
    throw new Error('No identified accounts are stored. Run `saavo login` first.');
  }

  let issuer: string | undefined;
  if (issuerInput) {
    try {
      issuer = new URL(issuerInput).href;
    } catch {
      throw new Error('--issuer must be an absolute URL.');
    }
  }

  let account: StoredAccount;
  if (selector) {
    const matches = matchingAccounts(state.store.accounts, selector, issuer);
    if (matches.length === 0) {
      throw new Error(`No stored account matches "${selector}".`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple accounts match "${selector}". Pass --issuer or run without an account argument to select interactively.`,
      );
    }
    account = matches[0]!;
  } else {
    const candidates = issuer
      ? state.store.accounts.filter((candidate) => candidate.credentials.issuer === issuer)
      : state.store.accounts;
    if (candidates.length === 0) {
      throw new Error('No stored accounts match the requested issuer.');
    }

    const selected = await clack.select({
      message: 'Select the active account',
      options: candidates.map((candidate, index) => ({
        value: String(index),
        label: accountLabel(candidate),
        hint: candidate.credentials.issuer,
      })),
    });
    if (clack.isCancel(selected)) {
      clack.cancel('Account switch cancelled.');
      return;
    }
    account = candidates[Number(selected)]!;
  }

  const activated = await activateAccount(account.credentials.issuer, account.user.key);
  if (!activated) throw new Error('The selected account no longer exists.');

  clack.log.success(`Active account: ${accountLabel(activated)}`);
  if (expirationStatus(activated) === 'expired') {
    clack.log.warn('This account token is expired. Run `saavo login` to authorize it again.');
  }
}
