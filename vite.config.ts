import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import packageJson from './package.json' with { type: 'json' };

const oauthDefaults = {
  issuer: 'https://saavo.dev',
  authorizationEndpoint: 'https://saavo.dev/oauth/authorize',
  tokenEndpoint: 'https://saavo.dev/oauth/token',
  scope: 'user templates:read',
  currentUserEndpoint: 'https://saavo.dev/oauth/current-user',
  templatesEndpoint: 'https://saavo.dev/api/templates',
};

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'SAAVO_');
  const embeddedOAuthConfig = {
    clientId: environment.SAAVO_OAUTH_CLIENT_ID || undefined,
    issuer: environment.SAAVO_OAUTH_ISSUER || oauthDefaults.issuer,
    authorizationEndpoint:
      environment.SAAVO_OAUTH_AUTHORIZATION_ENDPOINT
      || oauthDefaults.authorizationEndpoint,
    tokenEndpoint:
      environment.SAAVO_OAUTH_TOKEN_ENDPOINT || oauthDefaults.tokenEndpoint,
    scope: environment.SAAVO_OAUTH_SCOPE || oauthDefaults.scope,
    currentUserEndpoint:
      environment.SAAVO_CURRENT_USER_ENDPOINT || oauthDefaults.currentUserEndpoint,
    templatesEndpoint:
      environment.SAAVO_TEMPLATES_ENDPOINT || oauthDefaults.templatesEndpoint,
    allowInsecure:
      mode !== 'production'
      && ['1', 'true'].includes(
        (environment.SAAVO_OAUTH_ALLOW_INSECURE || '').toLowerCase(),
      ),
    configDir:
      mode === 'development' ? environment.SAAVO_CONFIG_DIR || undefined : undefined,
  };

  return {
    define: {
      __SAAVO_BUILD_CONFIG__: JSON.stringify(embeddedOAuthConfig),
      __SAAVO_VERSION__: JSON.stringify(packageJson.version),
    },
    build: {
      target: 'node20',
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      minify: false,
      rollupOptions: {
        input: resolve(import.meta.dirname, 'src/index.ts'),
        external: [
          ...builtinModules,
          ...builtinModules.map((module) => `node:${module}`),
          ...Object.keys(packageJson.dependencies),
        ],
        output: {
          entryFileNames: 'index.js',
        },
      },
    },
  };
});
