import { afterEach, describe, expect, test, vi } from 'vitest';
import { resolveOAuthConfig } from '../src/oauth/config.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('OAuth configuration precedence', () => {
  test('uses runtime environment variables during local development', () => {
    vi.stubEnv('SAAVO_OAUTH_CLIENT_ID', 'environment-client');
    vi.stubEnv('SAAVO_OAUTH_ISSUER', 'https://environment.example');
    vi.stubEnv('SAAVO_OAUTH_AUTHORIZATION_ENDPOINT', 'https://environment.example/authorize');
    vi.stubEnv('SAAVO_OAUTH_TOKEN_ENDPOINT', 'https://environment.example/token');
    vi.stubEnv('SAAVO_OAUTH_SCOPE', 'templates:read user');
    vi.stubEnv('SAAVO_OAUTH_ALLOW_INSECURE', 'false');

    const config = resolveOAuthConfig();

    expect(config.clientId).toBe('environment-client');
    expect(config.issuer.href).toBe('https://environment.example/');
    expect(config.authorizationEndpoint.href).toBe('https://environment.example/authorize');
    expect(config.tokenEndpoint.href).toBe('https://environment.example/token');
    expect(config.scopes).toEqual(['templates:read', 'user']);
    expect(config.allowInsecure).toBe(false);
  });

  test('gives command options precedence over environment variables', () => {
    vi.stubEnv('SAAVO_OAUTH_CLIENT_ID', 'environment-client');

    const config = resolveOAuthConfig({
      clientId: 'option-client',
      issuer: 'https://option.example',
      authorizationEndpoint: 'https://option.example/authorize',
      tokenEndpoint: 'https://option.example/token',
      allowInsecure: false,
    });

    expect(config.clientId).toBe('option-client');
  });

  test('allows HTTP OAuth endpoints only for an explicitly enabled loopback server', () => {
    const config = resolveOAuthConfig({
      clientId: 'local-client',
      issuer: 'http://localhost:5173',
      authorizationEndpoint: 'http://127.0.0.1:5173/oauth/authorize',
      tokenEndpoint: 'http://[::1]:5173/oauth/token',
      allowInsecure: true,
    });

    expect(config.allowInsecure).toBe(true);
    expect(config.issuer.href).toBe('http://localhost:5173/');
  });

  test('rejects insecure non-loopback OAuth endpoints', () => {
    expect(() => resolveOAuthConfig({
      clientId: 'local-client',
      issuer: 'http://oauth.example.com',
      allowInsecure: true,
    })).toThrow(/HTTPS/u);
  });
});
