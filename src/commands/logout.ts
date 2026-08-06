import * as clack from '@clack/prompts';
import { logoutActiveAccount } from '../auth/token-store.js';

function accountLabel(account: {
  user: { name: string; email: string };
}): string {
  return `${account.user.name} <${account.user.email}>`;
}

export async function logout(): Promise<void> {
  const result = await logoutActiveAccount();

  if (result.removedLegacy) {
    clack.log.success('Logged out and removed the legacy credentials.');
    return;
  }
  if (!result.removed) {
    clack.log.info('No active account is logged in.');
    return;
  }

  clack.log.success(`Logged out ${accountLabel(result.removed)}.`);
  if (result.active) {
    clack.log.info(`Active account switched to ${accountLabel(result.active)}.`);
  } else {
    clack.log.info('No active account remains.');
  }
}
