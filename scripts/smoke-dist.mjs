import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const entryPath = resolve(root, 'dist/index.js');
const entrySource = readFileSync(entryPath, 'utf8');

if (!entrySource.startsWith('#!/usr/bin/env node\n')) {
  throw new Error('dist/index.js must start with the Node.js executable shebang.');
}

function runCli(args) {
  const result = spawnSync(process.execPath, [entryPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Packaged CLI failed (${result.status ?? 'unknown'}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

if (runCli(['--version']).trim() !== packageJson.version) {
  throw new Error('The packaged CLI version does not match package.json.');
}
if (!runCli(['--help']).includes('Create projects from Saavo templates')) {
  throw new Error('The packaged CLI help output is incomplete.');
}

console.info(`Verified dist/index.js for saavo ${packageJson.version}`);
