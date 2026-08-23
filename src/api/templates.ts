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

export interface TemplateDownload {
  templateId: string;
  version: string;
  sha256: string;
  sizeBytes: number;
  download: {
    method: 'GET';
    url: URL;
    expiresAt: number;
  };
}

export class TemplateApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TemplateApiError';
    this.status = status;
  }
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
    && value.sizeBytes > 0
    && typeof value.publishedAt === 'number'
    && Number.isFinite(value.publishedAt);
}

function apiFailureMessage(action: string, status: number, body: unknown): string {
  if (!isRecord(body)) return `${action} (HTTP ${status}).`;
  const fields = [
    typeof body.code === 'string' || typeof body.code === 'number'
      ? `code=${String(body.code)}`
      : null,
    typeof body.error === 'string' ? `error=${body.error}` : null,
  ].filter((field): field is string => field !== null);
  const details = fields.length > 0 ? `, ${fields.join(', ')}` : '';
  const message = typeof body.message === 'string' ? `: ${body.message}` : '';
  return `${action} (HTTP ${status}${details})${message}`;
}

function templateDownloadEndpoint(endpoint: URL, templateId: string): URL {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/${encodeURIComponent(templateId)}/download`;
  url.search = '';
  return url;
}

function parseDownloadUrl(value: unknown, allowInsecure: boolean): URL | null {
  if (typeof value !== 'string') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const allowedHttp = allowInsecure && url.protocol === 'http:' && loopback;
  if ((url.protocol !== 'https:' && !allowedHttp) || url.username || url.password || url.hash) {
    return null;
  }
  return url;
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

  if (!response.ok) {
    throw new TemplateApiError(
      apiFailureMessage('Unable to list templates', response.status, body),
      response.status,
    );
  }

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

export async function requestTemplateDownload(
  endpoint: URL,
  template: AvailableTemplate,
  credentials: StoredCredentials,
  options: {
    allowInsecure?: boolean | undefined;
    request?: typeof fetch | undefined;
    now?: Date | undefined;
  } = {},
): Promise<TemplateDownload> {
  const request = options.request ?? fetch;
  const response = await request(templateDownloadEndpoint(endpoint, template.id), {
    method: 'POST',
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
    throw new Error(`Template download endpoint returned invalid JSON (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    throw new TemplateApiError(
      apiFailureMessage(
        'Unable to request a template download',
        response.status,
        body,
      ),
      response.status,
    );
  }

  const data = isRecord(body) && body.success === true && isRecord(body.data)
    ? body.data
    : null;
  const download = data && isRecord(data.download) ? data.download : null;
  const url = download
    ? parseDownloadUrl(download.url, options.allowInsecure === true)
    : null;
  if (
    !data
    || data.templateId !== template.id
    || data.version !== template.version
    || data.sha256 !== template.sha256
    || data.sizeBytes !== template.sizeBytes
    || !download
    || download.method !== 'GET'
    || !url
    || typeof download.expiresAt !== 'number'
    || !Number.isFinite(download.expiresAt)
  ) {
    throw new Error('Template download endpoint returned an invalid response.');
  }
  if (download.expiresAt <= (options.now ?? new Date()).getTime() + 5_000) {
    throw new Error('The template download URL is already expired. Try `saavo create` again.');
  }

  return {
    templateId: data.templateId as string,
    version: data.version as string,
    sha256: data.sha256 as string,
    sizeBytes: data.sizeBytes as number,
    download: {
      method: 'GET',
      url,
      expiresAt: download.expiresAt,
    },
  };
}
