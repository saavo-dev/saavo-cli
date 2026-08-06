import type { StoredCredentials, StoredUser } from '../auth/token-store.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsePermissions(value: unknown): Record<string, boolean> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (!entries.every(([, permission]) => typeof permission === 'boolean')) return undefined;
  return Object.fromEntries(entries) as Record<string, boolean>;
}

function apiFailureMessage(status: number, body: unknown): string {
  if (!isRecord(body)) return `Unable to load the current user (HTTP ${status}).`;
  const fields = [
    typeof body.code === 'string' || typeof body.code === 'number'
      ? `code=${String(body.code)}`
      : null,
    typeof body.error === 'string' ? `error=${body.error}` : null,
  ].filter((field): field is string => field !== null);
  const details = fields.length > 0 ? `, ${fields.join(', ')}` : '';
  const message = typeof body.message === 'string' ? `: ${body.message}` : '';
  return `Unable to load the current user (HTTP ${status}${details})${message}`;
}

export async function fetchCurrentUser(
  endpoint: URL,
  credentials: StoredCredentials,
  request: typeof fetch = fetch,
): Promise<StoredUser> {
  const response = await request(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${credentials.accessToken}`,
    },
    redirect: 'error',
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Current user endpoint returned invalid JSON (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(apiFailureMessage(response.status, body));
  }

  const data = isRecord(body) && body.success === true && isRecord(body.data)
    ? body.data
    : null;
  if (!data) {
    throw new Error('Current user endpoint returned an invalid response.');
  }
  if (
    typeof data.name !== 'string'
    || typeof data.email !== 'string'
    || data.email.trim().length === 0
  ) {
    throw new Error('Current user response must include data.name and data.email.');
  }

  const id = (typeof data.id === 'string' || typeof data.id === 'number')
    && String(data.id).length > 0
    ? String(data.id)
    : undefined;
  const normalizedEmail = data.email.trim().toLowerCase();

  return {
    key: id ? `id:${id}` : `email:${normalizedEmail}`,
    id,
    name: data.name,
    email: data.email,
    isPremium: typeof data.isPremium === 'boolean' ? data.isPremium : undefined,
    permissions: parsePermissions(data.permissions),
  };
}
