import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createLastErrorLog, writeLastError } from '../src/logging/error-log.js';

describe('last error log', () => {
  test('redacts OAuth secrets from messages and stacks', () => {
    const error = new Error(
      'request failed https://example.test/callback?code=secret-code&state=secret-state Bearer secret-token',
    );
    const log = createLastErrorLog(error, 'saavo login', new Date('2026-08-06T00:00:00Z'));
    const serialized = JSON.stringify(log);

    expect(log.timestamp).toBe('2026-08-06T00:00:00.000Z');
    expect(serialized).not.toContain('secret-code');
    expect(serialized).not.toContain('secret-state');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).toContain('[REDACTED]');
  });

  test('overwrites the file so only the latest error remains', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'saavo-cli-error-test-'));
    const path = join(directory, 'last-error.json');

    try {
      await writeLastError(new Error('first failure'), 'saavo login', path);
      await writeLastError(new Error('second failure'), 'saavo login', path);

      const log = JSON.parse(await readFile(path, 'utf8')) as { message: string };
      expect(log.message).toBe('second failure');
      expect(await readFile(path, 'utf8')).not.toContain('first failure');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
