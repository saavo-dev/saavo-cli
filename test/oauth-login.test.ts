import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'vitest';
import type { OAuthConfig } from '../src/oauth/config.js';
import {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  refreshAccessToken,
} from '../src/oauth/login.js';

function config(overrides: Partial<OAuthConfig> = {}): OAuthConfig {
  return {
    issuer: new URL('https://issuer.example'),
    authorizationEndpoint: new URL('https://issuer.example/authorize'),
    tokenEndpoint: new URL('https://issuer.example/token'),
    clientId: 'public-cli-client',
    scopes: ['templates:read'],
    allowInsecure: false,
    ...overrides,
  };
}

test('builds an Authorization Code + PKCE S256 request', async () => {
  const redirectUri = 'http://127.0.0.1:49152/oauth/callback';
  const request = await createAuthorizationRequest(config(), redirectUri);

  assert.equal(request.url.origin, 'https://issuer.example');
  assert.equal(request.url.pathname, '/authorize');
  assert.equal(request.url.searchParams.get('response_type'), 'code');
  assert.equal(request.url.searchParams.get('client_id'), 'public-cli-client');
  assert.equal(request.url.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(request.url.searchParams.get('scope'), 'templates:read');
  assert.equal(request.url.searchParams.get('state'), request.state);
  assert.equal(request.url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(request.url.searchParams.get('code_challenge') ?? '', /^[A-Za-z0-9_-]{43}$/u);
  assert.ok(request.codeVerifier.length >= 43);
});

test('exchanges a code as a public client without a client secret', async () => {
  let requestBody: URLSearchParams | undefined;
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => { body += chunk; });
    request.on('end', () => {
      requestBody = new URLSearchParams(body);
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'templates:read',
      }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const redirectUri = 'http://127.0.0.1:49152/oauth/callback';
    const tokens = await exchangeAuthorizationCode(config({
      tokenEndpoint: new URL(`http://127.0.0.1:${address.port}/token`),
      allowInsecure: true,
    }), {
      redirect: new URL(`${redirectUri}?code=authorization-code&state=expected-state`),
      redirectUri,
      codeVerifier: 'a'.repeat(43),
      expectedState: 'expected-state',
    });

    assert.equal(tokens.access_token, 'access-token');
    assert.equal(tokens.token_type, 'bearer');
    assert.equal(requestBody?.get('grant_type'), 'authorization_code');
    assert.equal(requestBody?.get('code'), 'authorization-code');
    assert.equal(requestBody?.get('redirect_uri'), redirectUri);
    assert.equal(requestBody?.get('code_verifier'), 'a'.repeat(43));
    assert.equal(requestBody?.get('client_id'), 'public-cli-client');
    assert.equal(requestBody?.has('client_secret'), false);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('rejects an authorization response with the wrong state', async () => {
  await assert.rejects(
    exchangeAuthorizationCode(config(), {
      redirect: new URL('http://127.0.0.1/callback?code=code&state=wrong'),
      redirectUri: 'http://127.0.0.1/callback',
      codeVerifier: 'a'.repeat(43),
      expectedState: 'expected',
    }),
    /state/i,
  );
});

test('refreshes a token as a public client without losing protocol guarantees', async () => {
  let requestBody: URLSearchParams | undefined;
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => { body += chunk; });
    request.on('end', () => {
      requestBody = new URLSearchParams(body);
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify({
        access_token: 'refreshed-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const tokens = await refreshAccessToken(config({
      tokenEndpoint: new URL(`http://127.0.0.1:${address.port}/token`),
      allowInsecure: true,
    }), 'refresh-token');

    assert.equal(tokens.access_token, 'refreshed-access-token');
    assert.equal(requestBody?.get('grant_type'), 'refresh_token');
    assert.equal(requestBody?.get('refresh_token'), 'refresh-token');
    assert.equal(requestBody?.get('client_id'), 'public-cli-client');
    assert.equal(requestBody?.has('client_secret'), false);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
