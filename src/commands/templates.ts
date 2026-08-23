import * as clack from '@clack/prompts';
import { fetchTemplates, type AvailableTemplate } from '../api/templates.js';
import { requireActiveAccount } from '../auth/session.js';
import type { OAuthConfig } from '../oauth/config.js';

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
  const account = await requireActiveAccount(config, {
    credentialsPath: options.credentialsPath,
  });
  const templates = await fetchTemplates(endpoint, account.credentials, options.request);
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
