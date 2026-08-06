import * as oauth from 'oauth4webapi';

function sanitize(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500);
}

function errorCode(value: string): string {
  return /^[A-Za-z0-9._~-]+$/u.test(value) ? value : 'unknown_error';
}

export function formatOAuthError(error: unknown): string {
  if (error instanceof oauth.AuthorizationResponseError) {
    if (error.error === 'access_denied') {
      return 'Authorization was denied in the browser. No credentials were saved.';
    }

    const code = errorCode(error.error);
    const description = error.error_description
      ? sanitize(error.error_description)
      : 'The authorization server rejected the request.';
    return `Authorization failed (${code}): ${description}`;
  }

  if (error instanceof oauth.ResponseBodyError) {
    const code = errorCode(error.error);
    const description = error.error_description
      ? sanitize(error.error_description)
      : 'The token endpoint rejected the request.';
    return `Token request failed (${code}): ${description}`;
  }

  return error instanceof Error ? sanitize(error.message) : sanitize(String(error));
}
