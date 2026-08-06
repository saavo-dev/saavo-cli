import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import * as oauth from 'oauth4webapi';
import { defaultConfigDirectory } from '../auth/token-store.js';
import { formatOAuthError } from '../oauth/errors.js';

const SENSITIVE_NAME = '(?:access_token|refresh_token|client_secret|code_verifier|code|state)';

export interface ErrorDetails {
  name: string;
  message: string;
  code?: string | undefined;
  oauthError?: string | undefined;
  oauthDescription?: string | undefined;
  httpStatus?: number | undefined;
  stack?: string | undefined;
  causes?: Array<{ name: string; message: string; code?: string | undefined }> | undefined;
}

export interface LastErrorLog {
  timestamp: string;
  command: string;
  message: string;
  error: ErrorDetails;
}

function redact(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"']+/giu, 'Bearer [REDACTED]')
    .replace(
      new RegExp(`([?&]${SENSITIVE_NAME}=)[^&\\s]+`, 'giu'),
      '$1[REDACTED]',
    )
    .replace(
      new RegExp(`("${SENSITIVE_NAME}"\\s*:\\s*")[^"]+`, 'giu'),
      '$1[REDACTED]',
    )
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, '')
    .slice(0, 20_000);
}

function basicError(error: unknown): { name: string; message: string; code?: string } {
  if (!(error instanceof Error)) {
    return { name: 'UnknownError', message: redact(String(error)) };
  }
  const code = 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
  return {
    name: error.name,
    message: redact(error.message),
    ...(code ? { code } : {}),
  };
}

function causeChain(error: unknown): ErrorDetails['causes'] {
  const causes: NonNullable<ErrorDetails['causes']> = [];
  let current = error instanceof Error && 'cause' in error ? error.cause : undefined;
  const seen = new Set<unknown>();

  while (current !== undefined && current !== null && causes.length < 5 && !seen.has(current)) {
    seen.add(current);
    causes.push(basicError(current));
    current = current instanceof Error && 'cause' in current ? current.cause : undefined;
  }
  return causes.length > 0 ? causes : undefined;
}

export function createLastErrorLog(
  error: unknown,
  command: string,
  now = new Date(),
): LastErrorLog {
  const basic = basicError(error);
  const details: ErrorDetails = {
    ...basic,
    stack: error instanceof Error && error.stack ? redact(error.stack) : undefined,
    causes: causeChain(error),
  };

  if (error instanceof oauth.AuthorizationResponseError) {
    details.oauthError = error.error;
    details.oauthDescription = error.error_description
      ? redact(error.error_description)
      : undefined;
  } else if (error instanceof oauth.ResponseBodyError) {
    details.oauthError = error.error;
    details.oauthDescription = error.error_description
      ? redact(error.error_description)
      : undefined;
    details.httpStatus = error.status;
  }

  return {
    timestamp: now.toISOString(),
    command,
    message: redact(formatOAuthError(error)),
    error: details,
  };
}

export function defaultErrorLogPath(): string {
  return join(defaultConfigDirectory(), 'last-error.json');
}

export async function writeLastError(
  error: unknown,
  command: string,
  path = defaultErrorLogPath(),
): Promise<string> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  const log = createLastErrorLog(error, command);

  try {
    await writeFile(temporaryPath, `${JSON.stringify(log, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
    return resolve(path);
  } catch (writeError) {
    const { rm } = await import('node:fs/promises');
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw writeError;
  }
}
