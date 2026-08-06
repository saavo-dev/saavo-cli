import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as clack from '@clack/prompts';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { saveAccount } from '../src/auth/token-store.js';
import { formatTemplate, listTemplates } from '../src/commands/templates.js';

const config = {
  issuer: new URL('https://issuer.example'),
  authorizationEndpoint: new URL('https://issuer.example/authorize'),
  tokenEndpoint: new URL('https://issuer.example/token'),
  clientId: 'public-cli-client',
  scopes: ['user', 'templates:read'],
  allowInsecure: false,
};

afterEach(() => vi.restoreAllMocks());

describe('templates command', () => {
  test('shows an informative message when the active account has no templates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'saavo-cli-templates-test-'));
    const path = join(directory, 'credentials.json');
    const info = vi.spyOn(clack.log, 'info').mockImplementation(() => undefined);

    try {
      await saveAccount({
        user: {
          key: 'email:alice@example.com',
          name: 'Alice',
          email: 'alice@example.com',
        },
        credentials: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          tokenType: 'bearer',
          scope: 'user templates:read',
          expiresAt: '2099-01-01T00:00:00.000Z',
          issuer: 'https://issuer.example/',
          clientId: 'public-cli-client',
        },
      }, path);

      const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        success: true,
        data: { templates: [] },
      }), { status: 200 }));
      await expect(listTemplates(config, new URL('https://saavo.dev/api/templates'), {
        credentialsPath: path,
        request,
      })).resolves.toEqual([]);

      expect(info).toHaveBeenCalledWith(expect.stringContaining(
        'No templates are currently available for Alice (alice@example.com).',
      ));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('formats template identity, version, and human-readable size', () => {
    expect(formatTemplate({
      id: 'saavo-default',
      name: 'Saavo Default',
      description: 'Default template',
      version: '1.2.3',
      sha256: 'a'.repeat(64),
      sizeBytes: 2048,
      publishedAt: 1_786_000_000_000,
    })).toContain('Saavo Default (saavo-default)\n  Default template\n  Version: 1.2.3');
    expect(formatTemplate({
      id: 'saavo-default',
      name: 'Saavo Default',
      description: 'Default template',
      version: '1.2.3',
      sha256: 'a'.repeat(64),
      sizeBytes: 2048,
      publishedAt: 1_786_000_000_000,
    })).toContain('Size: 2 KB');
  });
});
