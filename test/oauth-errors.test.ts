import * as oauth from 'oauth4webapi';
import { describe, expect, test } from 'vitest';
import { formatOAuthError } from '../src/oauth/errors.js';
import { exchangeAuthorizationCode } from '../src/oauth/login.js';

const config = {
  issuer: new URL('https://issuer.example'),
  authorizationEndpoint: new URL('https://issuer.example/authorize'),
  tokenEndpoint: new URL('https://issuer.example/token'),
  clientId: 'public-cli-client',
  scopes: ['templates:read'],
  allowInsecure: false,
};

async function authorizationError(parameters: string): Promise<unknown> {
  try {
    await exchangeAuthorizationCode(config, {
      redirect: new URL(`http://127.0.0.1/callback?${parameters}`),
      redirectUri: 'http://127.0.0.1/callback',
      codeVerifier: 'a'.repeat(43),
      expectedState: 'expected-state',
    });
  } catch (error) {
    return error;
  }
  throw new Error('Expected the authorization response to fail.');
}

describe('OAuth error messages', () => {
  test('explains when the user denied authorization', async () => {
    const error = await authorizationError('error=access_denied&state=expected-state');

    expect(error).toBeInstanceOf(oauth.AuthorizationResponseError);
    expect(formatOAuthError(error)).toBe(
      'Authorization was denied in the browser. No credentials were saved.',
    );
  });

  test('includes the standard error code and description', async () => {
    const error = await authorizationError(
      'error=invalid_scope&error_description=Requested%20scope%20is%20not%20available&state=expected-state',
    );

    expect(formatOAuthError(error)).toBe(
      'Authorization failed (invalid_scope): Requested scope is not available',
    );
  });

  test('removes terminal control characters from server descriptions', () => {
    const error = new oauth.AuthorizationResponseError('error', {
      cause: new URLSearchParams({
        error: 'server_error',
        error_description: '\u001b[31mfailed\u001b[0m',
      }),
    });

    expect(formatOAuthError(error)).not.toContain('\u001b');
  });
});
