import { spawn } from 'node:child_process';

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string | undefined;
}

export interface CommandRunOptions {
  interactive?: boolean | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  cwd?: string | undefined;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandRunOptions,
) => Promise<CommandResult>;

function windowsCommand(command: string, args: string[]): { executable: string; args: string[] } {
  const parts = [command, ...args];
  if (!parts.every((part) => /^[a-z0-9@._:/=-]+$/iu.test(part))) {
    throw new Error('Refusing to execute an unsafe Windows command argument.');
  }
  return {
    executable: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', parts.join(' ')],
  };
}

export const runCommand: CommandRunner = async (command, args, options = {}) =>
  new Promise((resolveResult) => {
    const interactive = options.interactive === true;
    let invocation: { executable: string; args: string[] };
    try {
      invocation = process.platform === 'win32'
        ? windowsCommand(command, args)
        : { executable: command, args };
    } catch (error) {
      resolveResult({
        exitCode: null,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        errorCode: 'EINVAL',
      });
      return;
    }
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(invocation.executable, invocation.args, {
        shell: false,
        stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...options.env },
        cwd: options.cwd,
        windowsHide: true,
      });
    } catch (error) {
      const commandError = error as NodeJS.ErrnoException;
      resolveResult({
        exitCode: null,
        stdout: '',
        stderr: commandError.message,
        errorCode: commandError.code,
      });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolveResult(result);
    };
    if (!interactive) {
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout = `${stdout}${chunk}`.slice(-1_000_000);
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-1_000_000);
      });
    }
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({
        exitCode: null,
        stdout,
        stderr: error.message,
        errorCode: error.code,
      });
    });
    child.on('close', (exitCode) => finish({ exitCode, stdout, stderr }));
  });

function parseVersion(input: string): [number, number, number] | null {
  const match = input.match(/v?(\d+)\.(\d+)\.(\d+)/u);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function versionFromOutput(output: string): string | null {
  const parsed = parseVersion(output);
  return parsed ? parsed.join('.') : null;
}

export function versionAtLeast(actual: string, minimum: string): boolean {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index]! > right[index]!) return true;
    if (left[index]! < right[index]!) return false;
  }
  return true;
}
