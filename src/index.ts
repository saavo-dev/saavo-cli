#!/usr/bin/env node

import * as clack from '@clack/prompts';
import { Command } from 'commander';
import { resolveCurrentUserEndpoint, resolveTemplatesEndpoint } from './api/config.js';
import { listAccounts, useAccount } from './commands/account.js';
import { logout } from './commands/logout.js';
import { forceRefresh } from './commands/refresh.js';
import { listTemplates } from './commands/templates.js';
import { writeLastError } from './logging/error-log.js';
import { resolveOAuthConfig, type OAuthConfigInput } from './oauth/config.js';
import { formatOAuthError } from './oauth/errors.js';
import { login } from './oauth/login.js';

interface LoginCommandOptions extends OAuthConfigInput {
  browser?: boolean;
  force?: boolean;
  currentUserEndpoint?: string;
}

interface RefreshCommandOptions extends OAuthConfigInput {
  currentUserEndpoint?: string;
}

interface TemplatesCommandOptions extends OAuthConfigInput {
  templatesEndpoint?: string;
  json?: boolean;
}

const program = new Command()
  .name('saavo')
  .description('Create projects from Saavo templates')
  .version(__SAAVO_VERSION__)
  .showSuggestionAfterError();

program
  .command('login')
  .description('Log in using OAuth 2.0 Authorization Code with PKCE')
  .option('--client-id <id>', 'OAuth public client ID')
  .option('--issuer <url>', 'authorization server issuer URL')
  .option('--authorization-endpoint <url>', 'OAuth authorization endpoint URL')
  .option('--token-endpoint <url>', 'OAuth token endpoint URL')
  .option('--current-user-endpoint <url>', 'protected current-user endpoint URL')
  .option('--scope <scopes>', 'space-separated OAuth scopes')
  .option('--allow-insecure', 'allow HTTP OAuth endpoints on loopback hosts during development')
  .option('--force', 'authorize again even when stored credentials are still valid')
  .option('--no-browser', 'print the authorization URL without opening a browser')
  .action(async (options: LoginCommandOptions) => {
    const oauthConfig = resolveOAuthConfig(options);
    await login(oauthConfig, {
      openBrowser: options.browser !== false,
      force: options.force === true,
      currentUserEndpoint: resolveCurrentUserEndpoint(
        options.currentUserEndpoint,
        oauthConfig.allowInsecure,
      ),
    });
  });

const accountCommand = program
  .command('account')
  .description('List and switch stored user accounts');

accountCommand
  .command('list')
  .alias('ls')
  .description('List stored user accounts without displaying tokens')
  .option('--json', 'print machine-readable JSON')
  .action(async (options: { json?: boolean }) => {
    await listAccounts({ json: options.json === true });
  });

accountCommand
  .command('use [account]')
  .description('Switch the active account by email, user ID, or account key')
  .option('--issuer <url>', 'issuer used to disambiguate matching accounts')
  .action(async (account: string | undefined, options: { issuer?: string }) => {
    await useAccount(account, options.issuer);
  });

accountCommand.action(() => {
  accountCommand.help();
});

program
  .command('logout')
  .description('Log out the active account and switch to another stored account')
  .action(logout);

program
  .command('refresh')
  .description('Force a Refresh Token Grant for the active account')
  .option('--client-id <id>', 'OAuth public client ID')
  .option('--issuer <url>', 'authorization server issuer URL')
  .option('--token-endpoint <url>', 'OAuth token endpoint URL')
  .option('--current-user-endpoint <url>', 'protected current-user endpoint URL')
  .option('--scope <scopes>', 'space-separated OAuth scopes')
  .option('--allow-insecure', 'allow HTTP OAuth endpoints on loopback hosts during development')
  .action(async (options: RefreshCommandOptions) => {
    const oauthConfig = resolveOAuthConfig(options);
    await forceRefresh(
      oauthConfig,
      resolveCurrentUserEndpoint(options.currentUserEndpoint, oauthConfig.allowInsecure),
    );
  });

program
  .command('templates')
  .description('List templates available to the active account')
  .option('--client-id <id>', 'OAuth public client ID')
  .option('--issuer <url>', 'authorization server issuer URL')
  .option('--token-endpoint <url>', 'OAuth token endpoint URL')
  .option('--scope <scopes>', 'space-separated OAuth scopes')
  .option('--templates-endpoint <url>', 'protected templates endpoint URL')
  .option('--allow-insecure', 'allow HTTP endpoints on loopback hosts during development')
  .option('--json', 'print machine-readable JSON')
  .action(async (options: TemplatesCommandOptions) => {
    const oauthConfig = resolveOAuthConfig(options);
    await listTemplates(
      oauthConfig,
      resolveTemplatesEndpoint(options.templatesEndpoint, oauthConfig.allowInsecure),
      { json: options.json === true },
    );
  });

program.action(() => {
  program.help();
});

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = formatOAuthError(error);
  clack.log.error(`SAAVO CLI FAILED\n${message}`);
  try {
    const logPath = await writeLastError(
      error,
      process.argv.includes('login')
        ? 'saavo login'
        : process.argv.includes('account')
          ? 'saavo account'
          : process.argv.includes('logout')
            ? 'saavo logout'
            : process.argv.includes('refresh')
              ? 'saavo refresh'
              : process.argv.includes('templates') ? 'saavo templates' : 'saavo',
    );
    clack.log.warn(`Diagnostic details were saved to:\n${logPath}`);
  } catch (logError) {
    const logMessage = logError instanceof Error ? logError.message : String(logError);
    clack.log.warn(`Could not write the diagnostic log: ${logMessage}`);
  }
  process.exitCode = 1;
}
