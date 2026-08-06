import type { StoredCredentials } from '../auth/token-store.js';

export interface AvailableTemplate {
  id: string;
  name: string;
  description: string;
  version: string;
  sha256: string;
  sizeBytes: number;
  publishedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAvailableTemplate(value: unknown): value is AvailableTemplate {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.name === 'string'
    && typeof value.description === 'string'
    && typeof value.version === 'string'
    && value.version.length > 0
    && typeof value.sha256 === 'string'
    && /^[a-f\d]{64}$/iu.test(value.sha256)
    && typeof value.sizeBytes === 'number'
    && Number.isSafeInteger(value.sizeBytes)
    && value.sizeBytes >= 0
    && typeof value.publishedAt === 'number'
    && Number.isFinite(value.publishedAt);
}

function apiFailureMessage(status: number, body: unknown): string {
  if (!isRecord(body)) return `Unable to list templates (HTTP ${status}).`;
  const fields = [
    typeof body.code === 'string' || typeof body.code === 'number'
      ? `code=${String(body.code)}`
      : null,
    typeof body.error === 'string' ? `error=${body.error}` : null,
  ].filter((field): field is string => field !== null);
  const details = fields.length > 0 ? `, ${fields.join(', ')}` : '';
  const message = typeof body.message === 'string' ? `: ${body.message}` : '';
  return `Unable to list templates (HTTP ${status}${details})${message}`;
}

export async function fetchTemplates(
  endpoint: URL,
  credentials: StoredCredentials,
  request: typeof fetch = fetch,
): Promise<AvailableTemplate[]> {
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
    throw new Error(`Templates endpoint returned invalid JSON (HTTP ${response.status}).`);
  }

  if (!response.ok) throw new Error(apiFailureMessage(response.status, body));

  const templates = isRecord(body)
    && body.success === true
    && isRecord(body.data)
    && Array.isArray(body.data.templates)
    ? body.data.templates
    : null;
  if (!templates || !templates.every(isAvailableTemplate)) {
    throw new Error('Templates endpoint returned an invalid response.');
  }

  return templates;
}
