import * as clack from '@clack/prompts';
import open from 'open';
import { fetchTemplates, type AvailableTemplate, TemplateApiError } from '../api/templates.js';
import { requireActiveAccount } from '../auth/session.js';
import type { StoredAccount } from '../auth/token-store.js';
import type { OAuthConfig } from '../oauth/config.js';
import { login } from '../oauth/login.js';
import {
  runCommand,
  versionAtLeast,
  type CommandRunner,
} from './command.js';

export { runCommand, versionAtLeast } from './command.js';
export type { CommandRunner, CommandResult, CommandRunOptions } from './command.js';

export const MINIMUM_NODE_VERSION = '22.13.0';

export interface CreatePreflightResult {
  account: StoredAccount;
  templates: AvailableTemplate[];
}

export interface CreatePreflightOptions {
  config: OAuthConfig;
  templatesEndpoint: URL;
  currentUserEndpoint: URL;
  credentialsPath?: string | undefined;
  openBrowser?: boolean | undefined;
  request?: typeof fetch | undefined;
  nodeVersion?: string | undefined;
  runner?: CommandRunner | undefined;
  confirm?: ((message: string) => Promise<boolean>) | undefined;
  openExternal?: ((url: string) => Promise<unknown>) | undefined;
}

export type PreflightRunner = (
  options: CreatePreflightOptions,
) => Promise<CreatePreflightResult>;

async function defaultConfirm(message: string): Promise<boolean> {
  const answer = await clack.confirm({ message });
  return !clack.isCancel(answer) && answer;
}

export async function checkNode(
  version = process.versions.node,
  options: {
    confirm?: ((message: string) => Promise<boolean>) | undefined;
    openExternal?: ((url: string) => Promise<unknown>) | undefined;
  } = {},
): Promise<string> {
  if (versionAtLeast(version, MINIMUM_NODE_VERSION)) return version;
  const shouldOpen = await (options.confirm ?? defaultConfirm)(
    `Node.js ${version} is installed, but Saavo projects require ${MINIMUM_NODE_VERSION} or newer. Open the Node.js download page?`,
  );
  if (shouldOpen) {
    await (options.openExternal ?? ((url) => open(url, { wait: false })))(
      'https://nodejs.org/en/download',
    );
  }
  throw new Error(
    `Node.js ${MINIMUM_NODE_VERSION} or newer is required. Upgrade Node.js and run the command again.`,
  );
}

export async function checkNpm(runner: CommandRunner = runCommand): Promise<string> {
  const result = await runner('npm', ['--version']);
  const version = (result.stdout || result.stderr).trim().split(/\r?\n/u)[0];
  if (result.exitCode !== 0 || !/^\d+\.\d+\.\d+/u.test(version ?? '')) {
    throw new Error('npm is required to initialize the project, but it could not be executed.');
  }
  return version!;
}

export async function checkSaavoAccess(
  options: Pick<CreatePreflightOptions,
    | 'config'
    | 'templatesEndpoint'
    | 'currentUserEndpoint'
    | 'credentialsPath'
    | 'openBrowser'
    | 'request'>,
): Promise<{ account: StoredAccount; templates: AvailableTemplate[] }> {
  let account: StoredAccount;
  try {
    account = await requireActiveAccount(options.config, {
      credentialsPath: options.credentialsPath,
    });
  } catch {
    clack.log.info('Saavo authorization is required. Starting OAuth login.');
    await login(options.config, {
      openBrowser: options.openBrowser !== false,
      force: false,
      currentUserEndpoint: options.currentUserEndpoint,
      credentialsPath: options.credentialsPath,
    });
    account = await requireActiveAccount(options.config, {
      credentialsPath: options.credentialsPath,
    });
  }

  let templates: AvailableTemplate[];
  try {
    templates = await fetchTemplates(
      options.templatesEndpoint,
      account.credentials,
      options.request,
    );
  } catch (error) {
    if (!(error instanceof TemplateApiError) || ![401, 403].includes(error.status)) throw error;
    clack.log.info('Saavo authorization is no longer valid. Starting OAuth authorization again.');
    await login(options.config, {
      openBrowser: options.openBrowser !== false,
      force: true,
      currentUserEndpoint: options.currentUserEndpoint,
      credentialsPath: options.credentialsPath,
    });
    account = await requireActiveAccount(options.config, {
      credentialsPath: options.credentialsPath,
    });
    templates = await fetchTemplates(
      options.templatesEndpoint,
      account.credentials,
      options.request,
    );
  }
  if (templates.length === 0) {
    throw new Error(
      `No templates are available for ${account.user.name} (${account.user.email}). The account may not have template access, or no release has been published.`,
    );
  }
  return { account, templates };
}

export async function runCreatePreflight(
  options: CreatePreflightOptions,
): Promise<CreatePreflightResult> {
  const runner = options.runner ?? runCommand;

  clack.log.step('Preflight: checking Node.js');
  const nodeVersion = await checkNode(options.nodeVersion, {
    confirm: options.confirm,
    openExternal: options.openExternal,
  });
  clack.log.success(`Node.js ${nodeVersion}`);

  clack.log.step('Preflight: checking npm');
  const npmVersion = await checkNpm(runner);
  clack.log.success(`npm ${npmVersion}`);

  clack.log.step('Preflight: checking Saavo access');
  const saavo = await checkSaavoAccess(options);
  clack.log.success(`Saavo access: ${saavo.account.user.name} (${saavo.account.user.email})`);
  return saavo;
}
