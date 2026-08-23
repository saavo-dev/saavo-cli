import {
  activeAccount,
  credentialsAreValid,
  credentialsCanRefresh,
  readCredentialState,
  refreshedCredentialsFromTokenResponse,
  saveAccount,
  type StoredAccount,
} from './token-store.js';
import type { OAuthConfig } from '../oauth/config.js';
import { refreshAccessToken } from '../oauth/login.js';

export interface ActiveSessionOptions {
  credentialsPath?: string | undefined;
}

export async function requireActiveAccount(
  config: OAuthConfig,
  options: ActiveSessionOptions = {},
): Promise<StoredAccount> {
  const state = await readCredentialState(options.credentialsPath);
  if (!state.store) {
    if (state.legacy) {
      throw new Error('Stored credentials have no user identity. Run `saavo login` to migrate them.');
    }
    throw new Error('No active account is stored. Run `saavo login` first.');
  }

  const account = activeAccount(state.store);
  if (!account) {
    throw new Error('The stored active account no longer exists. Run `saavo account use`.');
  }

  const requirements = {
    issuer: config.issuer.href,
    clientId: config.clientId,
    scopes: config.scopes,
  };
  if (credentialsAreValid(account.credentials, requirements)) return account;
  if (!credentialsCanRefresh(account.credentials, requirements)) {
    throw new Error(
      'The active token is expired or does not match the current configuration. Run `saavo login`.',
    );
  }

  const tokens = await refreshAccessToken(config, account.credentials.refreshToken);
  const credentials = refreshedCredentialsFromTokenResponse(tokens, account.credentials);
  if (!credentialsAreValid(credentials, requirements)) {
    throw new Error('The refreshed token is expired or does not include the required scopes.');
  }

  await saveAccount({ user: account.user, credentials }, options.credentialsPath);
  return { user: account.user, credentials };
}
