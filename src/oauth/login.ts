import * as clack from '@clack/prompts';
import open from 'open';
import * as oauth from 'oauth4webapi';
import {
  activeAccount,
  credentialsCanRefresh,
  credentialsAreValid,
  credentialsFromTokenResponse,
  refreshedCredentialsFromTokenResponse,
  readCredentialState,
  saveAccount,
} from '../auth/token-store.js';
import { fetchCurrentUser } from '../api/current-user.js';
import { startLoopbackCallback } from './callback-server.js';
import { formatOAuthError } from './errors.js';
import {
  authorizationServer,
  oauthClient,
  type OAuthConfig,
} from './config.js';

export interface LoginOptions {
  openBrowser?: boolean;
  force?: boolean;
  currentUserEndpoint: URL;
}

export interface AuthorizationRequest {
  url: URL;
  codeVerifier: string;
  state: string;
}

export async function createAuthorizationRequest(
  config: OAuthConfig,
  redirectUri: string,
): Promise<AuthorizationRequest> {
  const codeVerifier = oauth.generateRandomCodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const state = oauth.generateRandomState();
  const url = new URL(config.authorizationEndpoint);

  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: config.scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }).toString();

  return { url, codeVerifier, state };
}

export async function exchangeAuthorizationCode(
  config: OAuthConfig,
  input: {
    redirect: URL;
    redirectUri: string;
    codeVerifier: string;
    expectedState: string;
    requestOptions?: oauth.TokenEndpointRequestOptions;
  },
): Promise<oauth.TokenEndpointResponse> {
  const as = authorizationServer(config);
  const client = oauthClient(config);
  const callbackParameters = oauth.validateAuthResponse(
    as,
    client,
    input.redirect.searchParams,
    input.expectedState,
  );
  const response = await oauth.authorizationCodeGrantRequest(
    as,
    client,
    oauth.None(),
    callbackParameters,
    input.redirectUri,
    input.codeVerifier,
    {
      ...input.requestOptions,
      ...(config.allowInsecure ? { [oauth.allowInsecureRequests]: true } : {}),
    },
  );

  return oauth.processAuthorizationCodeResponse(as, client, response);
}

export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string,
  requestOptions?: oauth.TokenEndpointRequestOptions,
): Promise<oauth.TokenEndpointResponse> {
  const as = authorizationServer(config);
  const client = oauthClient(config);
  const response = await oauth.refreshTokenGrantRequest(
    as,
    client,
    oauth.None(),
    refreshToken,
    {
      ...requestOptions,
      ...(config.allowInsecure ? { [oauth.allowInsecureRequests]: true } : {}),
    },
  );
  return oauth.processRefreshTokenResponse(as, client, response);
}

export async function login(
  config: OAuthConfig,
  options: LoginOptions,
): Promise<void> {
  if (!options.force) {
    const state = await readCredentialState();
    const storedAccount = state.store ? activeAccount(state.store) : null;
    const credentials = storedAccount?.credentials ?? state.legacy;
    const requirements = {
      issuer: config.issuer.href,
      clientId: config.clientId,
      scopes: config.scopes,
    };
    if (credentials && credentialsAreValid(credentials, requirements)) {
      if (storedAccount) {
        clack.log.success(
          `Already logged in as ${storedAccount.user.name} (${storedAccount.user.email}).`,
        );
      } else {
        const user = await fetchCurrentUser(options.currentUserEndpoint, credentials);
        await saveAccount({ user, credentials });
        clack.log.success(`Already logged in as ${user.name} (${user.email}).`);
      }
      clack.log.info('Use `saavo login --force` to authorize again.');
      return;
    }

    if (credentials && credentialsCanRefresh(credentials, requirements)) {
      const refreshSpinner = clack.spinner();
      refreshSpinner.start('Refreshing access token');
      try {
        const tokens = await refreshAccessToken(config, credentials.refreshToken);
        const refreshedCredentials = refreshedCredentialsFromTokenResponse(
          tokens,
          credentials,
        );
        if (!credentialsAreValid(refreshedCredentials, requirements)) {
          throw new Error('The refreshed token is expired or does not include the required scopes.');
        }
        const user = storedAccount?.user
          ?? await fetchCurrentUser(options.currentUserEndpoint, refreshedCredentials);
        await saveAccount({ user, credentials: refreshedCredentials });
        refreshSpinner.stop('Access token refreshed');
        clack.log.success(`Logged in as ${user.name} (${user.email}).`);
        return;
      } catch (error) {
        refreshSpinner.error('Access token refresh failed');
        clack.log.warn(`${formatOAuthError(error)}\nStarting browser authorization instead.`);
      }
    }
  }

  const callback = await startLoopbackCallback();
  const request = await createAuthorizationRequest(config, callback.redirectUri);
  const spinner = clack.spinner();

  try {
    clack.log.info(`Authorize this CLI in your browser:\n${request.url.href}`);
    if (options.openBrowser !== false) {
      try {
        await open(request.url.href, { wait: false });
      } catch {
        clack.log.warn('Could not open a browser automatically. Open the URL above manually.');
      }
    }

    spinner.start('Waiting for authorization');
    const redirect = await callback.waitForRedirect();
    spinner.message('Exchanging authorization code');

    const tokens = await exchangeAuthorizationCode(config, {
      redirect,
      redirectUri: callback.redirectUri,
      codeVerifier: request.codeVerifier,
      expectedState: request.state,
    });

    spinner.message('Loading current user');
    const credentials = credentialsFromTokenResponse(tokens, {
      issuer: config.issuer.href,
      clientId: config.clientId,
      requestedScope: config.scopes.join(' '),
    });
    const user = await fetchCurrentUser(options.currentUserEndpoint, credentials);
    await saveAccount({ user, credentials });
    spinner.stop('Authorization complete');
    clack.log.success(`Logged in as ${user.name} (${user.email}).`);
  } catch (error) {
    spinner.clear();
    throw error;
  } finally {
    await callback.close();
  }
}
