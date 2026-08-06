import { createServer, type Server } from 'node:http';

const CALLBACK_PATH = '/oauth/callback';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface LoopbackCallback {
  redirectUri: string;
  waitForRedirect: () => Promise<URL>;
  close: () => Promise<void>;
}

function browserPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { display: grid; min-height: 100vh; margin: 0; place-items: center; }
      main { max-width: 32rem; padding: 2rem; text-align: center; }
    </style>
  </head>
  <body><main><h1>${title}</h1><p>${message}</p></main></body>
</html>`;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function startLoopbackCallback(
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<LoopbackCallback> {
  let resolveRedirect!: (url: URL) => void;
  let rejectRedirect!: (error: Error) => void;
  let settled = false;

  const redirectPromise = new Promise<URL>((resolve, reject) => {
    resolveRedirect = resolve;
    rejectRedirect = reject;
  });

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'GET' || requestUrl.pathname !== CALLBACK_PATH) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const oauthError = requestUrl.searchParams.get('error');
    const page = oauthError === 'access_denied'
      ? browserPage(
          'Authorization denied',
          'No credentials were shared. You can close this window and return to the terminal.',
        )
      : oauthError
        ? browserPage(
            'Authorization failed',
            'The authorization server returned an error. Return to the terminal for details.',
          )
        : browserPage(
            'Authorization received',
            'You can close this window and return to the terminal.',
          );

    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    });
    response.end(page);

    if (!settled) {
      settled = true;
      resolveRedirect(requestUrl);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Unable to determine the OAuth callback port.');
  }

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectRedirect(new Error('OAuth authorization timed out.'));
    }
  }, timeoutMs);
  timer.unref();

  return {
    redirectUri: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
    waitForRedirect: () => redirectPromise,
    close: async () => {
      clearTimeout(timer);
      await closeServer(server);
    },
  };
}
