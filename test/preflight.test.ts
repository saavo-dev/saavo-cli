import { describe, expect, test, vi } from 'vitest';
import {
  checkNode,
  checkNpm,
  runCommand,
  versionAtLeast,
  type CommandRunner,
} from '../src/create/preflight.js';

describe('create preflight', () => {
  test('runs a version command through the constrained command runner', async () => {
    const result = await runCommand('node', ['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^v\d+\.\d+\.\d+/u);
  });

  test('compares semantic versions', () => {
    expect(versionAtLeast('v22.13.0', '22.13.0')).toBe(true);
    expect(versionAtLeast('24.1.0', '22.13.0')).toBe(true);
    expect(versionAtLeast('22.12.0', '22.13.0')).toBe(false);
  });

  test('offers the Node download page when the version is too old', async () => {
    const openExternal = vi.fn(async () => undefined);
    await expect(checkNode('20.19.0', {
      confirm: async () => true,
      openExternal,
    })).rejects.toThrow('22.13.0 or newer');
    expect(openExternal).toHaveBeenCalledWith('https://nodejs.org/en/download');
  });

  test('requires npm during preflight', async () => {
    const calls: string[] = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push(`${command} ${args.join(' ')}`);
      return { exitCode: 0, stdout: '11.4.0\n', stderr: '' };
    };
    await expect(checkNpm(runner)).resolves.toBe('11.4.0');
    expect(calls).toEqual(['npm --version']);
  });
});
