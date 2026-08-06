const DEFAULT_CURRENT_USER_ENDPOINT = 'https://saavo.dev/oauth/current-user';
const DEFAULT_TEMPLATES_ENDPOINT = 'https://saavo.dev/api/templates';

function resolveProtectedEndpoint(
  value: string,
  label: string,
  allowInsecure: boolean,
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:' && isLoopback)) {
    throw new Error(`${label} must use HTTPS, except for opted-in loopback development.`);
  }
  if (url.username || url.password || url.hash) {
    throw new Error(`${label} must not contain credentials or a fragment.`);
  }
  return url;
}

export function resolveCurrentUserEndpoint(
  input: string | undefined,
  allowInsecure: boolean,
): URL {
  const embedded = typeof __SAAVO_BUILD_CONFIG__ === 'undefined'
    ? undefined
    : __SAAVO_BUILD_CONFIG__.currentUserEndpoint;
  const value = input
    ?? process.env.SAAVO_CURRENT_USER_ENDPOINT
    ?? embedded
    ?? DEFAULT_CURRENT_USER_ENDPOINT;

  return resolveProtectedEndpoint(value, 'Current user endpoint', allowInsecure);
}

export function resolveTemplatesEndpoint(
  input: string | undefined,
  allowInsecure: boolean,
): URL {
  const embedded = typeof __SAAVO_BUILD_CONFIG__ === 'undefined'
    ? undefined
    : __SAAVO_BUILD_CONFIG__.templatesEndpoint;
  const value = input
    ?? process.env.SAAVO_TEMPLATES_ENDPOINT
    ?? embedded
    ?? DEFAULT_TEMPLATES_ENDPOINT;

  return resolveProtectedEndpoint(value, 'Templates endpoint', allowInsecure);
}
