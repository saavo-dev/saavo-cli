/// <reference types="vite/client" />

declare const __SAAVO_VERSION__: string;

declare const __SAAVO_BUILD_CONFIG__: Readonly<{
  clientId?: string;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  scope?: string;
  allowInsecure?: boolean;
  configDir?: string;
  currentUserEndpoint?: string;
  templatesEndpoint?: string;
}>;
