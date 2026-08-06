import { describe, expect, test, vi } from 'vitest';
import { fetchTemplates } from '../src/api/templates.js';

const credentials = {
  accessToken: 'access-token',
  tokenType: 'bearer',
  scope: 'user templates:read',
  issuer: 'https://issuer.example/',
  clientId: 'public-cli-client',
};

describe('templates API', () => {
  test('returns the templates available to the bearer token', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        templates: [{
          id: 'saavo-default',
          name: 'Saavo Default',
          description: 'Default template',
          version: '1.2.3',
          sha256: 'a'.repeat(64),
          sizeBytes: 2048,
          publishedAt: 1_786_000_000_000,
        }],
      },
    }), { status: 200 }));

    await expect(fetchTemplates(
      new URL('https://saavo.dev/api/templates'),
      credentials,
      request,
    )).resolves.toEqual([expect.objectContaining({
      id: 'saavo-default',
      version: '1.2.3',
    })]);
    expect(request).toHaveBeenCalledWith(
      new URL('https://saavo.dev/api/templates'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        redirect: 'error',
      }),
    );
  });

  test('accepts an empty template catalog as a successful result', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { templates: [] },
    }), { status: 200 }));

    await expect(fetchTemplates(
      new URL('https://saavo.dev/api/templates'),
      credentials,
      request,
    )).resolves.toEqual([]);
  });

  test('preserves API error details for diagnostics', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      code: -3002,
      error: 'api.oauthServer.invalidScope',
      message: 'Missing templates:read scope',
    }), { status: 403 }));

    await expect(fetchTemplates(
      new URL('https://saavo.dev/api/templates'),
      credentials,
      request,
    )).rejects.toThrow(
      'Unable to list templates (HTTP 403, code=-3002, error=api.oauthServer.invalidScope): Missing templates:read scope',
    );
  });

  test('rejects malformed successful responses', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { templates: [{ id: 'missing-release-fields' }] },
    }), { status: 200 }));

    await expect(fetchTemplates(
      new URL('https://saavo.dev/api/templates'),
      credentials,
      request,
    )).rejects.toThrow('Templates endpoint returned an invalid response.');
  });
});
