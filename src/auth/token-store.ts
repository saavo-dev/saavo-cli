import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type * as oauth from 'oauth4webapi';

export interface StoredCredentials {
  accessToken: string;
  tokenType: string;
  refreshToken?: string | undefined;
  scope?: string | undefined;
  expiresAt?: string | undefined;
  issuer: string;
  clientId: string;
}

export interface StoredUser {
  key: string;
  id?: string | undefined;
  name: string;
  email: string;
  isPremium?: boolean | undefined;
  permissions?: Record<string, boolean> | undefined;
}

export interface StoredAccount {
  user: StoredUser;
  credentials: StoredCredentials;
}

export interface CredentialStore {
  version: 1;
  active: {
    issuer: string;
    userKey: string;
  };
  accounts: StoredAccount[];
}

export interface CredentialState {
  store: CredentialStore | null;
  legacy: StoredCredentials | null;
}

export interface CredentialRequirements {
  issuer: string;
  clientId: string;
  scopes: string[];
}

export function defaultConfigDirectory(): string {
  const embeddedConfigDirectory = typeof __SAAVO_BUILD_CONFIG__ === 'undefined'
    ? undefined
    : __SAAVO_BUILD_CONFIG__.configDir;
  const configDirectory = process.env.SAAVO_CONFIG_DIR ?? embeddedConfigDirectory;

  return configDirectory || join(homedir(), '.saavo');
}

export function defaultCredentialsPath(): string {
  return join(defaultConfigDirectory(), 'credentials.json');
}

export function credentialsFromTokenResponse(
  tokens: oauth.TokenEndpointResponse,
  context: {
    issuer: string;
    clientId: string;
    requestedScope?: string | undefined;
    now?: Date;
  },
): StoredCredentials {
  const expiresAt = tokens.expires_in === undefined
    ? undefined
    : new Date((context.now ?? new Date()).getTime() + tokens.expires_in * 1000).toISOString();

  return {
    accessToken: tokens.access_token,
    tokenType: tokens.token_type,
    refreshToken: tokens.refresh_token,
    scope: tokens.scope ?? context.requestedScope,
    expiresAt,
    issuer: context.issuer,
    clientId: context.clientId,
  };
}

export function refreshedCredentialsFromTokenResponse(
  tokens: oauth.TokenEndpointResponse,
  previous: StoredCredentials,
  now = new Date(),
): StoredCredentials {
  return {
    ...credentialsFromTokenResponse(tokens, {
      issuer: previous.issuer,
      clientId: previous.clientId,
      requestedScope: previous.scope,
      now,
    }),
    refreshToken: tokens.refresh_token ?? previous.refreshToken,
    scope: tokens.scope ?? previous.scope,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStoredCredentials(value: unknown): value is StoredCredentials {
  if (!isRecord(value)) return false;
  return typeof value.accessToken === 'string'
    && value.accessToken.length > 0
    && typeof value.tokenType === 'string'
    && value.tokenType.length > 0
    && typeof value.issuer === 'string'
    && typeof value.clientId === 'string'
    && (value.refreshToken === undefined || typeof value.refreshToken === 'string')
    && (value.scope === undefined || typeof value.scope === 'string')
    && (value.expiresAt === undefined || typeof value.expiresAt === 'string');
}

function isStoredUser(value: unknown): value is StoredUser {
  if (!isRecord(value)) return false;
  const validPermissions = value.permissions === undefined
    || (isRecord(value.permissions)
      && Object.values(value.permissions).every((permission) => typeof permission === 'boolean'));
  return typeof value.key === 'string'
    && value.key.length > 0
    && (value.id === undefined || typeof value.id === 'string')
    && typeof value.name === 'string'
    && typeof value.email === 'string'
    && (value.isPremium === undefined || typeof value.isPremium === 'boolean')
    && validPermissions;
}

function isCredentialStore(value: unknown): value is CredentialStore {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.active)) return false;
  if (
    typeof value.active.issuer !== 'string'
    || typeof value.active.userKey !== 'string'
    || !Array.isArray(value.accounts)
  ) {
    return false;
  }
  return value.accounts.every((account) => isRecord(account)
    && isStoredUser(account.user)
    && isStoredCredentials(account.credentials));
}

export async function readCredentialState(
  path = defaultCredentialsPath(),
): Promise<CredentialState> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (isCredentialStore(value)) return { store: value, legacy: null };
    if (isStoredCredentials(value)) return { store: null, legacy: value };
    return { store: null, legacy: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
      return { store: null, legacy: null };
    }
    throw error;
  }
}

export function activeAccount(store: CredentialStore): StoredAccount | null {
  return store.accounts.find((account) =>
    account.credentials.issuer === store.active.issuer
    && account.user.key === store.active.userKey) ?? null;
}

export function credentialsAreValid(
  credentials: StoredCredentials,
  requirements: CredentialRequirements,
  now = new Date(),
): boolean {
  if (
    credentials.issuer !== requirements.issuer
    || credentials.clientId !== requirements.clientId
  ) {
    return false;
  }

  if (credentials.expiresAt) {
    const expiresAt = Date.parse(credentials.expiresAt);
    const clockSkewMs = 30_000;
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime() + clockSkewMs) {
      return false;
    }
  }

  if (credentials.scope) {
    const grantedScopes = new Set(credentials.scope.split(/\s+/u).filter(Boolean));
    if (!requirements.scopes.every((scope) => grantedScopes.has(scope))) {
      return false;
    }
  }

  return true;
}

export function credentialsCanRefresh(
  credentials: StoredCredentials,
  requirements: CredentialRequirements,
): credentials is StoredCredentials & { refreshToken: string } {
  if (!credentials.refreshToken) return false;
  if (
    credentials.issuer !== requirements.issuer
    || credentials.clientId !== requirements.clientId
  ) {
    return false;
  }
  if (credentials.scope) {
    const grantedScopes = new Set(credentials.scope.split(/\s+/u).filter(Boolean));
    if (!requirements.scopes.every((scope) => grantedScopes.has(scope))) return false;
  }
  return true;
}

async function writeStore(store: CredentialStore, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    const { rm } = await import('node:fs/promises');
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function saveAccount(
  account: StoredAccount,
  path = defaultCredentialsPath(),
): Promise<CredentialStore> {
  const state = await readCredentialState(path);
  const accounts = state.store?.accounts.filter((existing) => !(
    existing.credentials.issuer === account.credentials.issuer
    && existing.user.key === account.user.key
  )) ?? [];
  accounts.push(account);

  const store: CredentialStore = {
    version: 1,
    active: {
      issuer: account.credentials.issuer,
      userKey: account.user.key,
    },
    accounts,
  };
  await writeStore(store, path);
  return store;
}

export async function activateAccount(
  issuer: string,
  userKey: string,
  path = defaultCredentialsPath(),
): Promise<StoredAccount | null> {
  const state = await readCredentialState(path);
  if (!state.store) return null;

  const account = state.store.accounts.find((candidate) =>
    candidate.credentials.issuer === issuer && candidate.user.key === userKey);
  if (!account) return null;

  await writeStore({
    ...state.store,
    active: { issuer, userKey },
  }, path);
  return account;
}

export interface LogoutResult {
  removed: StoredAccount | null;
  removedLegacy: boolean;
  active: StoredAccount | null;
  remaining: number;
}

export async function logoutActiveAccount(
  path = defaultCredentialsPath(),
): Promise<LogoutResult> {
  const state = await readCredentialState(path);

  if (state.legacy) {
    const { rm } = await import('node:fs/promises');
    await rm(path, { force: true });
    return { removed: null, removedLegacy: true, active: null, remaining: 0 };
  }

  if (!state.store) {
    return { removed: null, removedLegacy: false, active: null, remaining: 0 };
  }

  const removed = activeAccount(state.store);
  if (!removed) {
    return {
      removed: null,
      removedLegacy: false,
      active: null,
      remaining: state.store.accounts.length,
    };
  }

  const accounts = state.store.accounts.filter((account) => !(
    account.credentials.issuer === removed.credentials.issuer
    && account.user.key === removed.user.key
  ));

  if (accounts.length === 0) {
    const { rm } = await import('node:fs/promises');
    await rm(path, { force: true });
    return { removed, removedLegacy: false, active: null, remaining: 0 };
  }

  const nextActive = accounts.at(-1)!;
  await writeStore({
    version: 1,
    active: {
      issuer: nextActive.credentials.issuer,
      userKey: nextActive.user.key,
    },
    accounts,
  }, path);

  return {
    removed,
    removedLegacy: false,
    active: nextActive,
    remaining: accounts.length,
  };
}
