import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import {
  assertEmptyDestination,
  commitProjectFromWorkDirectory,
  CREATE_WORK_DIRECTORY,
  downloadArchive,
  extractArchive,
} from '../src/templates/archive.js';

describe('template archives', () => {
  test('downloads, verifies, and extracts a valid ZIP', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'saavo-archive-test-'));
    const archivePath = join(directory, 'template.zip');
    const destination = join(directory, 'project');
    const archive = zipSync({
      'package.json': strToU8('{"name":"example"}\n'),
      'src/index.ts': strToU8('export const ready = true;\n'),
    });
    const sha256 = createHash('sha256').update(archive).digest('hex');

    try {
      const requests: Array<{ url: string; headers: Headers }> = [];
      const request: typeof fetch = async (input, init) => {
        requests.push({
          url: String(input),
          headers: new Headers(init?.headers),
        });
        return new Response(archive, {
          status: 200,
          headers: { 'Content-Length': String(archive.length) },
        });
      };
      await downloadArchive(new URL('https://objects.example/template.zip'), archivePath, {
        expectedSize: archive.length,
        expectedSha256: sha256,
        request,
      });
      await extractArchive(archivePath, destination);

      expect(await readFile(join(destination, 'package.json'), 'utf8'))
        .toBe('{"name":"example"}\n');
      expect(requests[0]?.headers.has('Authorization')).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects a checksum mismatch and removes the downloaded file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'saavo-archive-test-'));
    const archivePath = join(directory, 'template.zip');
    const archive = zipSync({ 'README.md': strToU8('hello') });
    try {
      await expect(downloadArchive(
        new URL('https://objects.example/template.zip'),
        archivePath,
        {
          expectedSize: archive.length,
          expectedSha256: '0'.repeat(64),
          request: async () => new Response(archive, { status: 200 }),
        },
      )).rejects.toThrow('SHA-256 verification failed');
      await expect(readFile(archivePath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects ZIP path traversal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'saavo-archive-test-'));
    const archivePath = join(directory, 'template.zip');
    try {
      await writeFile(archivePath, zipSync({ '../outside.txt': strToU8('unsafe') }));
      await expect(extractArchive(archivePath, join(directory, 'project')))
        .rejects.toThrow('unsafe path');
      await expect(readFile(join(directory, 'outside.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('treats hidden entries as content in the target directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'saavo-archive-test-'));
    const destination = join(directory, 'project');
    try {
      await mkdir(destination);
      await writeFile(join(destination, '.gitkeep'), '');
      await expect(assertEmptyDestination(destination)).rejects.toThrow(
        'Target directory is not empty',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('retries a transient error while committing the extracted project', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'saavo-archive-test-'));
    const destination = join(directory, 'project');
    const extractionDirectory = join(destination, CREATE_WORK_DIRECTORY, 'project');
    try {
      await mkdir(join(extractionDirectory, 'src'), { recursive: true });
      await writeFile(join(extractionDirectory, 'src', 'index.ts'), 'export {}\n');
      let attempts = 0;

      await commitProjectFromWorkDirectory(extractionDirectory, destination, {
        renameEntry: async (source, target) => {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error('directory is temporarily locked'), { code: 'EPERM' });
          }
          await rename(source, target);
        },
        retryDelaysMs: [0],
        wait: async () => undefined,
      });

      expect(attempts).toBe(2);
      expect(await readFile(join(destination, 'src', 'index.ts'), 'utf8')).toBe('export {}\n');
      await expect(readFile(join(destination, CREATE_WORK_DIRECTORY)))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
