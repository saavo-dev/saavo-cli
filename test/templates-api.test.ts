import { describe, expect, test, vi } from 'vitest';
import { fetchTemplates, requestTemplateDownload } from '../src/api/templates.js';

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

  test('requests a matching short-lived download without accepting insecure URLs', async () => {
    const template = {
      id: 'saavo-default',
      name: 'Saavo Default',
      description: 'Default template',
      version: '1.2.3',
      sha256: 'a'.repeat(64),
      sizeBytes: 2048,
      publishedAt: 1_786_000_000_000,
    };
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        templateId: template.id,
        version: template.version,
        sha256: template.sha256,
        sizeBytes: template.sizeBytes,
        download: {
          method: 'GET',
          url: 'https://objects.example/template.zip?signature=public',
          expiresAt: 1_893_456_600_000,
        },
      },
    }), { status: 200 }));

    const result = await requestTemplateDownload(
      new URL('https://saavo.dev/api/templates'),
      template,
      credentials,
      { request, now: new Date('2030-01-01T00:00:00.000Z') },
    );

    expect(result.download.url.href).toBe(
      'https://objects.example/template.zip?signature=public',
    );
    expect(request).toHaveBeenCalledWith(
      new URL('https://saavo.dev/api/templates/saavo-default/download'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      }),
    );
  });

  test('rejects download metadata that differs from the selected catalog release', async () => {
    const template = {
      id: 'saavo-default',
      name: 'Saavo Default',
      description: 'Default template',
      version: '1.2.3',
      sha256: 'a'.repeat(64),
      sizeBytes: 2048,
      publishedAt: 1_786_000_000_000,
    };
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        ...template,
        version: '9.9.9',
        download: {
          method: 'GET',
          url: 'https://objects.example/template.zip',
          expiresAt: 1_893_456_600_000,
        },
      },
    }), { status: 200 }));

    await expect(requestTemplateDownload(
      new URL('https://saavo.dev/api/templates'),
      template,
      credentials,
      { request, now: new Date('2030-01-01T00:00:00.000Z') },
    )).rejects.toThrow('Template download endpoint returned an invalid response.');
  });
});
