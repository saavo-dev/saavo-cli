import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('smoke:package must be run through npm so npm_execpath is available.');
}

function runNpm(args, cwd, capture = false) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_dry_run: 'false',
    },
    stdio: capture ? 'pipe' : 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = [result.stderr, result.stdout]
      .filter(value => typeof value === 'string' && value.trim())
      .join('\n');
    throw new Error(
      `npm ${args.join(' ')} failed (${result.status ?? 'unknown'}).`
      + (details ? `\n${details}` : ''),
    );
  }
  return result.stdout ?? '';
}

function runInstalledCli(binPath, args, cwd) {
  const command = process.platform === 'win32'
    ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe')
    : binPath;
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', binPath, ...args]
    : args;
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Installed CLI failed (${result.status ?? 'unknown'}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'saavo-package-smoke-'));
try {
  const packOutput = runNpm(
    ['pack', '--ignore-scripts', '--json', '--pack-destination', temporaryRoot],
    root,
    true,
  );
  const packResult = JSON.parse(packOutput);
  const filename = packResult?.[0]?.filename;
  if (typeof filename !== 'string') throw new Error('npm pack did not return a filename.');

  const installRoot = join(temporaryRoot, 'install');
  await mkdir(installRoot);
  await writeFile(
    join(installRoot, 'package.json'),
    '{"name":"saavo-smoke-test","private":true}\n',
    'utf8',
  );
  runNpm(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--prefix',
      installRoot,
      join(temporaryRoot, filename),
    ],
    installRoot,
  );

  const installedRoot = join(installRoot, 'node_modules', 'saavo-cli');
  const installedPackage = JSON.parse(
    await readFile(join(installedRoot, 'package.json'), 'utf8'),
  );
  if (installedPackage.name !== 'saavo-cli') {
    throw new Error(`Installed unexpected package ${installedPackage.name ?? '(missing)'}.`);
  }

  const binName = process.platform === 'win32' ? 'saavo.cmd' : 'saavo';
  const binPath = join(installRoot, 'node_modules', '.bin', binName);
  await access(binPath);
  const version = runInstalledCli(binPath, ['--version'], installRoot).trim();
  if (version !== installedPackage.version) {
    throw new Error(`Installed CLI returned ${version}; expected ${installedPackage.version}.`);
  }
  if (!runInstalledCli(binPath, ['--help'], installRoot).includes('Usage: saavo')) {
    throw new Error('Installed CLI help output is incomplete.');
  }

  console.info(`Installed and verified ${installedPackage.name} ${installedPackage.version}`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
