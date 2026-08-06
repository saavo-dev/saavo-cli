import * as clack from '@clack/prompts';
import { fetchTemplates, type AvailableTemplate } from '../api/templates.js';
import {
  activeAccount,
  credentialsAreValid,
  credentialsCanRefresh,
  readCredentialState,
  refreshedCredentialsFromTokenResponse,
  saveAccount,
} from '../auth/token-store.js';
import type { OAuthConfig } from '../oauth/config.js';
import { refreshAccessToken } from '../oauth/login.js';

export interface ListTemplatesOptions {
  json?: boolean;
  credentialsPath?: string;
  request?: typeof fetch;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  const digits = value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(digits)} ${unit}`;
}

export function formatTemplate(template: AvailableTemplate): string {
  return `${template.name} (${template.id})\n  ${template.description}\n  Version: ${template.version} | Size: ${formatSize(template.sizeBytes)}`;
}

export async function listTemplates(
  config: OAuthConfig,
  endpoint: URL,
  options: ListTemplatesOptions = {},
): Promise<AvailableTemplate[]> {
  const state = await readCredentialState(options.credentialsPath);
  if (!state.store) {
    if (state.legacy) {
      throw new Error('Stored credentials have no user identity. Run `saavo login` to migrate them.');
    }
    throw new Error('No active account is stored. Run `saavo login` first.');
  }

  const account = activeAccount(state.store);
  if (!account) {
    throw new Error('The stored active account no longer exists. Run `saavo account use`.');
  }

  const requirements = {
    issuer: config.issuer.href,
    clientId: config.clientId,
    scopes: config.scopes,
  };
  let credentials = account.credentials;
  if (!credentialsAreValid(credentials, requirements)) {
    if (!credentialsCanRefresh(credentials, requirements)) {
      throw new Error('The active token is expired or does not match the current configuration. Run `saavo login`.');
    }

    const tokens = await refreshAccessToken(config, credentials.refreshToken);
    credentials = refreshedCredentialsFromTokenResponse(tokens, credentials);
    if (!credentialsAreValid(credentials, requirements)) {
      throw new Error('The refreshed token is expired or does not include the required scopes.');
    }
    await saveAccount({ user: account.user, credentials }, options.credentialsPath);
  }

  const templates = await fetchTemplates(endpoint, credentials, options.request);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ templates }, null, 2)}\n`);
    return templates;
  }

  if (templates.length === 0) {
    clack.log.info(
      `No templates are currently available for ${account.user.name} (${account.user.email}).\nA template release may not have been published yet, or this account may not have access.`,
    );
    return templates;
  }

  clack.log.success(`${templates.length} template${templates.length === 1 ? '' : 's'} available.`);
  for (const template of templates) clack.log.info(formatTemplate(template));
  return templates;
}
