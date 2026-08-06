import * as clack from '@clack/prompts';
import { fetchCurrentUser } from '../api/current-user.js';
import {
  activeAccount,
  credentialsAreValid,
  credentialsCanRefresh,
  readCredentialState,
  refreshedCredentialsFromTokenResponse,
  saveAccount,
} from '../auth/token-store.js';
import type { OAuthConfig } from '../oauth/config.js';
import { refreshAccessToken } from '../oauth/login.js';

export async function forceRefresh(
  config: OAuthConfig,
  currentUserEndpoint: URL,
  credentialsPath?: string,
): Promise<void> {
  const state = await readCredentialState(credentialsPath);
  const storedAccount = state.store ? activeAccount(state.store) : null;
  const credentials = storedAccount?.credentials ?? state.legacy;
  if (!credentials) {
    throw new Error('No active credentials are stored. Run `saavo login` first.');
  }

  const requirements = {
    issuer: config.issuer.href,
    clientId: config.clientId,
    scopes: config.scopes,
  };
  if (!credentials.refreshToken) {
    throw new Error('The active account has no Refresh Token. Run `saavo login --force`.');
  }
  if (!credentialsCanRefresh(credentials, requirements)) {
    throw new Error(
      'The active account issuer, Client ID, or scopes do not match the current configuration.',
    );
  }

  const spinner = clack.spinner();
  spinner.start('Forcing access token refresh');
  try {
    const tokens = await refreshAccessToken(config, credentials.refreshToken);
    const refreshedCredentials = refreshedCredentialsFromTokenResponse(tokens, credentials);
    if (!credentialsAreValid(refreshedCredentials, requirements)) {
      throw new Error('The refreshed token is expired or does not include the required scopes.');
    }

    const user = storedAccount?.user
      ?? await fetchCurrentUser(currentUserEndpoint, refreshedCredentials);
    await saveAccount({ user, credentials: refreshedCredentials }, credentialsPath);
    spinner.stop('Access token refreshed');
    clack.log.success(`Refreshed ${user.name} (${user.email}).`);
  } catch (error) {
    spinner.clear();
    throw error;
  }
}
