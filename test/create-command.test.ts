import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { parse } from 'jsonc-parser';
import { describe, expect, test } from 'vitest';
import type { StoredAccount } from '../src/auth/token-store.js';
import {
  createProject,
  formatProjectNextSteps,
} from '../src/commands/create.js';
import {
  normalizeProjectName,
  proposeProjectName,
  validateProjectName,
} from '../src/create/project-name.js';

const templatePackage = JSON.stringify({
  name: 'saavo-default-template',
  version: '0.2.2',
  scripts: {
    'cf-typegen': 'wrangler types',
    'saavo:init': 'tsx scripts/development/init.ts',
  },
}, null, 2);

const templatePackageLock = JSON.stringify({
  name: 'saavo-default-template',
  version: '0.2.2',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': {
      name: 'saavo-default-template',
      version: '0.2.2',
    },
  },
}, null, 2);

const templateWrangler = `{
  // Project infrastructure identity
  "name": "saavo-template",
  "vars": {
    "ASYNC_POLICY_TASK_QUEUE_NAME": "saavo-template-policy-task",
    "ASYNC_LOGGER_QUEUE_NAME": "saavo-template-async-logger",
    "ANALYTICS_QUEUE_NAME": "saavo-template-analytics-events",
    "R2_BUCKET_NAME": "saavo-template-storage",
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "saavo-template-db" },
    { "binding": "ANALYTICS_DB", "database_name": "saavo-template-analytics-db" },
  ],
  "r2_buckets": [
    { "binding": "MAIN_R2", "bucket_name": "saavo-template-storage" },
  ],
  "queues": {
    "consumers": [
      { "queue": "saavo-template-policy-task" },
      { "queue": "saavo-template-async-logger" },
      { "queue": "saavo-template-analytics-events" },
    ],
    "producers": [
      { "binding": "ASYNC_POLICY_TASK_QUEUE", "queue": "saavo-template-policy-task" },
      { "binding": "ASYNC_LOGGER_QUEUE", "queue": "saavo-template-async-logger" },
      { "binding": "ANALYTICS_QUEUE", "queue": "saavo-template-analytics-events" },
    ],
  },
}\n`;

function templateArchive(extraFiles: Record<string, Uint8Array> = {}): Uint8Array<ArrayBuffer> {
  return new Uint8Array(zipSync({
    'package.json': strToU8(`${templatePackage}\n`),
    'wrangler.jsonc': strToU8(templateWrangler),
    ...extraFiles,
  }));
}

const config = {
  issuer: new URL('https://issuer.example'),
  authorizationEndpoint: new URL('https://issuer.example/authorize'),
  tokenEndpoint: new URL('https://issuer.example/token'),
  clientId: 'public-cli-client',
  scopes: ['user', 'templates:read'],
  allowInsecure: false,
};

const account: StoredAccount = {
  user: {
    key: 'email:alice@example.com',
    name: 'Alice',
    email: 'alice@example.com',
  },
  credentials: {
    accessToken: 'saavo-access-token',
    refreshToken: 'refresh-token',
    tokenType: 'bearer',
    scope: 'user templates:read',
    expiresAt: '2099-01-01T00:00:00.000Z',
    issuer: 'https://issuer.example/',
    clientId: 'public-cli-client',
  },
};

describe('create command', () => {
  test('prints complete next steps for prepared and deferred projects', () => {
    expect(formatProjectNextSteps('my-project', 'ci', false)).toContain(
      'cd "my-project"\nnpm ci\nnpm run saavo:init\nnpm run dev',
    );
    expect(formatProjectNextSteps('my-project', 'ci', true)).toContain(
      'cd "my-project"\nnpm run dev',
    );
    expect(formatProjectNextSteps('my-project', 'ci', true)).toContain(
      'Before deployment, customize config/ and content/',
    );
  });

  test('normalizes recoverable project names and rejects unusable names', () => {
    expect(normalizeProjectName('My_Awesome Project')).toBe('my-awesome-project');
    expect(proposeProjectName('my_project')).toEqual({
      input: 'my_project',
      name: 'my-project',
      changed: true,
    });
    expect(() => proposeProjectName('日本語')).toThrow('ASCII letter or number');
    expect(() => proposeProjectName('apps/my-project')).toThrow('not a directory path');
    expect(validateProjectName('con')).toContain('reserved by Windows');
    expect(validateProjectName('saavo-template')).toContain('reserved by Saavo');
  });

  test('initializes an existing empty directory from a verified template', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'saavo-create-command-test-'));
    const credentialsPath = join(directory, 'credentials.json');
    const destination = join(directory, 'my-project');
    const archive = templateArchive({
      'package-lock.json': strToU8(`${templatePackageLock}\n`),
      'README.md': strToU8('# Created with Saavo\n'),
      'config/base.ts': strToU8("export const siteName = 'Saavo Starter';\n"),
      'scripts/template-state.ts': strToU8("export const templateName = 'saavo-template';\n"),
    });
    const sha256 = createHash('sha256').update(archive).digest('hex');
    const template = {
      id: 'saavo-default',
      name: 'Saavo Default',
      description: 'Default template',
      version: '0.1.0',
      sha256,
      sizeBytes: archive.length,
      publishedAt: 1_893_456_000_000,
    };
    const calls: Array<{ url: string; method: string; headers: Headers }> = [];
    const commands: Array<{ command: string; args: string[]; cwd?: string }> = [];

    try {
      await mkdir(destination);
      const request: typeof fetch = async (input, init) => {
        const url = String(input);
        calls.push({
          url,
          method: init?.method ?? 'GET',
          headers: new Headers(init?.headers),
        });
        if (url === 'https://saavo.dev/api/templates') {
          return new Response(JSON.stringify({
            success: true,
            data: { templates: [template] },
          }), { status: 200 });
        }
        if (url === 'https://saavo.dev/api/templates/saavo-default/download') {
          return new Response(JSON.stringify({
            success: true,
            data: {
              templateId: template.id,
              version: template.version,
              sha256,
              sizeBytes: archive.length,
              download: {
                method: 'GET',
                url: 'https://objects.example/template.zip?signature=test',
                expiresAt: 1_893_456_600_000,
              },
            },
          }), { status: 200 });
        }
        if (url === 'https://objects.example/template.zip?signature=test') {
          return new Response(archive, {
            status: 200,
            headers: { 'Content-Length': String(archive.length) },
          });
        }
        return new Response(null, { status: 404 });
      };

      const result = await createProject(
        config,
        new URL('https://saavo.dev/api/templates'),
        new URL('https://saavo.dev/oauth/current-user'),
        'my-project',
        {
          cwd: directory,
          credentialsPath,
          request,
          now: new Date('2030-01-01T00:00:00.000Z'),
          preflight: async () => ({ account, templates: [template] }),
          confirmPrepare: async () => true,
          runner: async (command, args, runOptions) => {
            commands.push({
              command,
              args,
              ...(runOptions?.cwd ? { cwd: runOptions.cwd } : {}),
            });
            return { exitCode: 0, stdout: '', stderr: '' };
          },
        },
      );

      expect(result?.destination).toBe(destination);
      expect(result?.localDevelopmentPrepared).toBe(true);
      expect(commands).toEqual([
        { command: 'npm', args: ['ci'], cwd: destination },
        { command: 'npm', args: ['run', 'saavo:init'], cwd: destination },
      ]);
      expect(await readFile(join(destination, 'README.md'), 'utf8'))
        .toBe('# Created with Saavo\n');
      expect(await readFile(join(destination, 'config', 'base.ts'), 'utf8'))
        .toBe("export const siteName = 'Saavo Starter';\n");
      expect(await readFile(join(destination, 'scripts', 'template-state.ts'), 'utf8'))
        .toBe("export const templateName = 'saavo-template';\n");
      expect(JSON.parse(await readFile(join(destination, 'package.json'), 'utf8')))
        .toMatchObject({ name: 'my-project', version: '0.0.1' });
      expect(JSON.parse(await readFile(join(destination, 'package-lock.json'), 'utf8')))
        .toMatchObject({
          name: 'my-project',
          version: '0.0.1',
          packages: { '': { name: 'my-project', version: '0.0.1' } },
        });
      const wrangler = parse(await readFile(join(destination, 'wrangler.jsonc'), 'utf8'));
      expect(wrangler).toMatchObject({
        name: 'my-project',
        vars: {
          ASYNC_POLICY_TASK_QUEUE_NAME: 'my-project-policy-task',
          ASYNC_LOGGER_QUEUE_NAME: 'my-project-async-logger',
          ANALYTICS_QUEUE_NAME: 'my-project-analytics-events',
          R2_BUCKET_NAME: 'my-project-storage',
        },
        d1_databases: [
          { binding: 'DB', database_name: 'my-project-db' },
          { binding: 'ANALYTICS_DB', database_name: 'my-project-analytics-db' },
        ],
        r2_buckets: [{ binding: 'MAIN_R2', bucket_name: 'my-project-storage' }],
        queues: {
          consumers: [
            { queue: 'my-project-policy-task' },
            { queue: 'my-project-async-logger' },
            { queue: 'my-project-analytics-events' },
          ],
          producers: [
            { binding: 'ASYNC_POLICY_TASK_QUEUE', queue: 'my-project-policy-task' },
            { binding: 'ASYNC_LOGGER_QUEUE', queue: 'my-project-async-logger' },
            { binding: 'ANALYTICS_QUEUE', queue: 'my-project-analytics-events' },
          ],
        },
      });
      expect(calls[0]?.headers.get('Authorization')).toBe('Bearer saavo-access-token');
      expect(calls[1]?.headers.has('Authorization')).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('confirms a normalized project name before creating its directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'saavo-create-command-test-'));
    const archive = templateArchive();
    const sha256 = createHash('sha256').update(archive).digest('hex');
    const template = {
      id: 'saavo-default',
      name: 'Saavo Default',
      description: 'Default template',
      version: '0.1.0',
      sha256,
      sizeBytes: archive.length,
      publishedAt: 1_893_456_000_000,
    };
    const confirmations: Array<{ input: string; proposedName: string }> = [];
    try {
      const request: typeof fetch = async (input) => {
        if (String(input).includes('/download')) {
          return new Response(JSON.stringify({
            success: true,
            data: {
              templateId: template.id,
              version: template.version,
              sha256,
              sizeBytes: archive.length,
              download: {
                method: 'GET',
                url: 'https://objects.example/template.zip',
                expiresAt: 1_893_456_600_000,
              },
            },
          }), { status: 200 });
        }
        return new Response(archive, { status: 200 });
      };
      const result = await createProject(
        config,
        new URL('https://saavo.dev/api/templates'),
        new URL('https://saavo.dev/oauth/current-user'),
        'My_Project',
        {
          cwd: directory,
          request,
          now: new Date('2030-01-01T00:00:00.000Z'),
          templateId: template.id,
          preflight: async () => ({ account, templates: [template] }),
          confirmProjectName: async (input, proposedName) => {
            confirmations.push({ input, proposedName });
            return true;
          },
          confirmPrepare: async () => false,
        },
      );

      expect(confirmations).toEqual([{ input: 'My_Project', proposedName: 'my-project' }]);
      expect(result?.destination).toBe(join(directory, 'my-project'));
      expect(JSON.parse(await readFile(join(directory, 'my-project', 'package.json'), 'utf8')))
        .toMatchObject({ name: 'my-project', version: '0.0.1' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects a project name with no usable characters before preflight', async () => {
    let preflightRan = false;
    await expect(createProject(
      config,
      new URL('https://saavo.dev/api/templates'),
      new URL('https://saavo.dev/oauth/current-user'),
      '日本語',
      {
        preflight: async () => {
          preflightRan = true;
          return { account, templates: [] };
        },
      },
    )).rejects.toThrow('ASCII letter or number');
    expect(preflightRan).toBe(false);
  });

  test('rejects a non-empty directory before preflight or download requests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'saavo-create-command-test-'));
    const destination = join(directory, 'existing');
    let requested = false;
    let preflightRan = false;
    try {
      await mkdir(destination);
      await writeFile(join(destination, '.env'), 'EXISTING=true\n');
      await expect(createProject(
        config,
        new URL('https://saavo.dev/api/templates'),
        new URL('https://saavo.dev/oauth/current-user'),
        'existing',
        {
          cwd: directory,
          credentialsPath: join(directory, 'missing-credentials.json'),
          request: async () => {
            requested = true;
            return new Response(null, { status: 500 });
          },
          templateId: 'saavo-default',
          preflight: async () => {
            preflightRan = true;
            return {
              account,
              templates: [{
                id: 'saavo-default',
                name: 'Saavo Default',
                description: 'Default template',
                version: '0.1.0',
                sha256: 'a'.repeat(64),
                sizeBytes: 1024,
                publishedAt: 1_893_456_000_000,
              }],
            };
          },
        },
      )).rejects.toThrow('Target directory is not empty');
      expect(preflightRan).toBe(false);
      expect(requested).toBe(false);
      expect(await readFile(join(destination, '.env'), 'utf8')).toBe('EXISTING=true\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('preserves the extracted project when local preparation fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'saavo-create-command-test-'));
    const destination = join(directory, 'project');
    const archive = templateArchive();
    const sha256 = createHash('sha256').update(archive).digest('hex');
    const template = {
      id: 'saavo-default',
      name: 'Saavo Default',
      description: 'Default template',
      version: '0.1.0',
      sha256,
      sizeBytes: archive.length,
      publishedAt: 1_893_456_000_000,
    };
    try {
      await mkdir(destination);
      const request: typeof fetch = async (input) => {
        if (String(input).includes('/download')) {
          return new Response(JSON.stringify({
            success: true,
            data: {
              templateId: template.id,
              version: template.version,
              sha256,
              sizeBytes: archive.length,
              download: {
                method: 'GET',
                url: 'https://objects.example/template.zip',
                expiresAt: 1_893_456_600_000,
              },
            },
          }), { status: 200 });
        }
        return new Response(archive, { status: 200 });
      };

      await expect(createProject(
        config,
        new URL('https://saavo.dev/api/templates'),
        new URL('https://saavo.dev/oauth/current-user'),
        'project',
        {
          cwd: directory,
          request,
          now: new Date('2030-01-01T00:00:00.000Z'),
          templateId: template.id,
          preflight: async () => ({ account, templates: [template] }),
          confirmPrepare: async () => true,
          prepareLocalDevelopment: async () => {
            await writeFile(join(destination, 'install-started'), 'true\n');
            throw new Error('local preparation failed');
          },
        },
      )).rejects.toThrow('local preparation failed');

      expect(await readdir(destination)).toEqual([
        'install-started',
        'package.json',
        'wrangler.jsonc',
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
