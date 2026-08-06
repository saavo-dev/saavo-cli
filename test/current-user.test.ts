import { describe, expect, test, vi } from 'vitest';
import { fetchCurrentUser } from '../src/api/current-user.js';

const credentials = {
  accessToken: 'access-token',
  tokenType: 'bearer',
  scope: 'user templates:read',
  issuer: 'https://issuer.example/',
  clientId: 'public-cli-client',
};

describe('current user API', () => {
  test('uses the access token and returns a stable user identity', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        id: 42,
        name: 'Alice',
        email: 'alice@example.com',
        isPremium: true,
        permissions: { starter: true },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const user = await fetchCurrentUser(
      new URL('https://issuer.example/oauth/current-user'),
      credentials,
      request,
    );

    expect(user).toEqual({
      key: 'id:42',
      id: '42',
      name: 'Alice',
      email: 'alice@example.com',
      isPremium: true,
      permissions: { starter: true },
    });
    expect(request).toHaveBeenCalledWith(
      new URL('https://issuer.example/oauth/current-user'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        redirect: 'error',
      }),
    );
  });

  test('uses normalized email when the response has no user ID', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { name: 'Alice', email: ' Alice@Example.COM ' },
    }), { status: 200 }));

    await expect(fetchCurrentUser(
      new URL('https://issuer.example/oauth/current-user'),
      credentials,
      request,
    )).resolves.toEqual({
      key: 'email:alice@example.com',
      id: undefined,
      name: 'Alice',
      email: ' Alice@Example.COM ',
      isPremium: undefined,
      permissions: undefined,
    });
  });

  test('preserves HTTP and API error codes for diagnostics', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      code: -3001,
      error: 'api.oauthServer.invalidAccessToken',
    }), { status: 401 }));

    await expect(fetchCurrentUser(
      new URL('https://issuer.example/oauth/current-user'),
      credentials,
      request,
    )).rejects.toThrow(
      'Unable to load the current user (HTTP 401, code=-3001, error=api.oauthServer.invalidAccessToken)',
    );
  });
});
