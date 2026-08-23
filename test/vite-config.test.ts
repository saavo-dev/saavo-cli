import { describe, expect, it } from 'vitest';
import { resolveEmbeddedOAuthConfig } from '../vite.config.js';

describe('production build configuration', () => {
  it('requires the public OAuth Client ID', () => {
    expect(() => resolveEmbeddedOAuthConfig('production', {})).toThrow(
      'SAAVO_OAUTH_CLIENT_ID is required to build the public Saavo CLI.',
    );
  });

  it('rejects insecure production endpoints', () => {
    expect(() => resolveEmbeddedOAuthConfig('production', {
      SAAVO_OAUTH_CLIENT_ID: 'public-client-id',
      SAAVO_OAUTH_TOKEN_ENDPOINT: 'http://saavo.dev/oauth/token',
    })).toThrow(
      'SAAVO_OAUTH_TOKEN_ENDPOINT must be a credential-free HTTPS URL without a fragment.',
    );
  });

  it('keeps insecure loopback support development-only', () => {
    expect(resolveEmbeddedOAuthConfig('development', {
      SAAVO_OAUTH_ALLOW_INSECURE: 'true',
    })).toMatchObject({
      allowInsecure: true,
      configDir: undefined,
    });
    expect(resolveEmbeddedOAuthConfig('production', {
      SAAVO_OAUTH_CLIENT_ID: 'public-client-id',
      SAAVO_OAUTH_ALLOW_INSECURE: 'true',
    })).toMatchObject({
      allowInsecure: false,
      clientId: 'public-client-id',
    });
  });
});
