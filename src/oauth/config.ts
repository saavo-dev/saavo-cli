import type * as oauth from 'oauth4webapi';

export interface OAuthConfig {
  issuer: URL;
  authorizationEndpoint: URL;
  tokenEndpoint: URL;
  clientId: string;
  scopes: string[];
  allowInsecure: boolean;
}

export interface OAuthConfigInput {
  issuer?: string | undefined;
  authorizationEndpoint?: string | undefined;
  tokenEndpoint?: string | undefined;
  clientId?: string | undefined;
  scope?: string | undefined;
  allowInsecure?: boolean | undefined;
}

const DEFAULT_ISSUER = 'https://saavo.dev';
const DEFAULT_AUTHORIZATION_ENDPOINT = 'https://saavo.dev/oauth/authorize';
const DEFAULT_TOKEN_ENDPOINT = 'https://saavo.dev/oauth/token';
const DEFAULT_SCOPE = 'user templates:read';

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  throw new Error('SAAVO_OAUTH_ALLOW_INSECURE must be true, false, 1, or 0.');
}

function parseUrl(value: string, name: string, allowInsecure: boolean): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }

  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const allowedHttp = allowInsecure && url.protocol === 'http:' && isLoopback;
  if (url.protocol !== 'https:' && !allowedHttp) {
    throw new Error(
      `${name} must use HTTPS. For a loopback development server, set SAAVO_OAUTH_ALLOW_INSECURE=true.`,
    );
  }
  if (url.username || url.password || url.hash) {
    throw new Error(`${name} must not contain credentials or a fragment.`);
  }

  return url;
}

export function resolveOAuthConfig(input: OAuthConfigInput = {}): OAuthConfig {
  const embedded = typeof __SAAVO_BUILD_CONFIG__ === 'undefined'
    ? {}
    : __SAAVO_BUILD_CONFIG__;
  const allowInsecure = input.allowInsecure
    ?? parseBoolean(process.env.SAAVO_OAUTH_ALLOW_INSECURE)
    ?? embedded.allowInsecure
    ?? false;
  const clientId = input.clientId
    ?? process.env.SAAVO_OAUTH_CLIENT_ID
    ?? embedded.clientId;
  if (!clientId?.trim()) {
    throw new Error(
      'OAuth client ID is required. Set SAAVO_OAUTH_CLIENT_ID or pass --client-id.',
    );
  }

  const scope = input.scope
    ?? process.env.SAAVO_OAUTH_SCOPE
    ?? embedded.scope
    ?? DEFAULT_SCOPE;
  const scopes = scope.split(/\s+/u).filter(Boolean);
  if (scopes.length === 0) {
    throw new Error('At least one OAuth scope is required.');
  }

  return {
    issuer: parseUrl(
      input.issuer
        ?? process.env.SAAVO_OAUTH_ISSUER
        ?? embedded.issuer
        ?? DEFAULT_ISSUER,
      'OAuth issuer',
      allowInsecure,
    ),
    authorizationEndpoint: parseUrl(
      input.authorizationEndpoint
        ?? process.env.SAAVO_OAUTH_AUTHORIZATION_ENDPOINT
        ?? embedded.authorizationEndpoint
        ?? DEFAULT_AUTHORIZATION_ENDPOINT,
      'OAuth authorization endpoint',
      allowInsecure,
    ),
    tokenEndpoint: parseUrl(
      input.tokenEndpoint
        ?? process.env.SAAVO_OAUTH_TOKEN_ENDPOINT
        ?? embedded.tokenEndpoint
        ?? DEFAULT_TOKEN_ENDPOINT,
      'OAuth token endpoint',
      allowInsecure,
    ),
    clientId: clientId.trim(),
    scopes,
    allowInsecure,
  };
}

export function authorizationServer(config: OAuthConfig): oauth.AuthorizationServer {
  return {
    issuer: config.issuer.href,
    authorization_endpoint: config.authorizationEndpoint.href,
    token_endpoint: config.tokenEndpoint.href,
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };
}

export function oauthClient(config: OAuthConfig): oauth.Client {
  return { client_id: config.clientId };
}
