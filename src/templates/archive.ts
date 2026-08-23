import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
} from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { unzipSync, type UnzipFileInfo } from 'fflate';

export const MAX_TEMPLATE_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_TEMPLATE_FILES = 20_000;
export const MAX_TEMPLATE_EXPANDED_BYTES = 1024 * 1024 * 1024;

export interface DownloadArchiveOptions {
  expectedSize: number;
  expectedSha256: string;
  request?: typeof fetch | undefined;
}

function contentLength(response: Response): number | null {
  const value = response.headers.get('content-length');
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function downloadArchive(
  url: URL,
  path: string,
  options: DownloadArchiveOptions,
): Promise<void> {
  if (options.expectedSize <= 0 || options.expectedSize > MAX_TEMPLATE_ARCHIVE_BYTES) {
    throw new Error(
      `Template archive size must be between 1 byte and ${MAX_TEMPLATE_ARCHIVE_BYTES} bytes.`,
    );
  }

  const request = options.request ?? fetch;
  const response = await request(url, { method: 'GET', redirect: 'error' });
  if (!response.ok) throw new Error(`Template archive download failed (HTTP ${response.status}).`);
  if (!response.body) throw new Error('Template archive download returned an empty response body.');

  const declaredLength = contentLength(response);
  if (declaredLength !== null && declaredLength !== options.expectedSize) {
    throw new Error(
      `Template archive size mismatch: expected ${options.expectedSize} bytes, received ${declaredLength}.`,
    );
  }

  const hash = createHash('sha256');
  let received = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > options.expectedSize || received > MAX_TEMPLATE_ARCHIVE_BYTES) {
        callback(new Error('Template archive exceeded its declared size.'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.from(response.body as AsyncIterable<Uint8Array>),
      meter,
      createWriteStream(path, { flags: 'wx', mode: 0o600 }),
    );
  } catch (error) {
    await rm(path, { force: true }).catch(() => undefined);
    throw error;
  }

  if (received !== options.expectedSize) {
    await rm(path, { force: true });
    throw new Error(
      `Template archive size mismatch: expected ${options.expectedSize} bytes, received ${received}.`,
    );
  }
  const actualSha256 = hash.digest('hex');
  if (actualSha256 !== options.expectedSha256.toLowerCase()) {
    await rm(path, { force: true });
    throw new Error('Template archive SHA-256 verification failed.');
  }
}

interface ArchiveEntry {
  archiveName: string;
  path: string;
  directory: boolean;
}

function safeArchivePath(name: string): { path: string; directory: boolean } {
  if (!name || name.includes('\0')) throw new Error('Template archive contains an invalid path.');
  const normalized = name.replace(/\\/gu, '/');
  const directory = normalized.endsWith('/');
  const withoutTrailingSlash = normalized.replace(/\/+$/u, '');
  if (
    !withoutTrailingSlash
    || normalized.startsWith('/')
    || /^[a-z]:/iu.test(normalized)
  ) {
    throw new Error(`Template archive contains an unsafe path: ${name}`);
  }
  const segments = withoutTrailingSlash.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Template archive contains an unsafe path: ${name}`);
  }
  return { path: segments.join('/'), directory };
}

function resolvedEntryPath(root: string, entryPath: string): string {
  const output = resolve(root, ...entryPath.split('/'));
  const fromRoot = relative(root, output);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`Template archive contains an unsafe path: ${entryPath}`);
  }
  return output;
}

export async function extractArchive(archivePath: string, destination: string): Promise<void> {
  const archiveStats = await stat(archivePath);
  if (archiveStats.size <= 0 || archiveStats.size > MAX_TEMPLATE_ARCHIVE_BYTES) {
    throw new Error('Template archive has an invalid size.');
  }

  const entries = new Map<string, ArchiveEntry>();
  let fileCount = 0;
  let expandedBytes = 0;
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(await readFile(archivePath), {
      filter(info: UnzipFileInfo) {
        const safe = safeArchivePath(info.name);
        fileCount += 1;
        expandedBytes += info.originalSize;
        if (fileCount > MAX_TEMPLATE_FILES) {
          throw new Error(`Template archive contains more than ${MAX_TEMPLATE_FILES} entries.`);
        }
        if (expandedBytes > MAX_TEMPLATE_EXPANDED_BYTES) {
          throw new Error('Template archive expands beyond the allowed size.');
        }
        if (entries.has(safe.path)) {
          throw new Error(`Template archive contains a duplicate path: ${safe.path}`);
        }
        entries.set(safe.path, {
          archiveName: info.name,
          path: safe.path,
          directory: safe.directory,
        });
        return true;
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Template archive')) throw error;
    throw new Error('Template archive is not a valid ZIP file.', { cause: error });
  }

  if (entries.size === 0) throw new Error('Template archive does not contain any files.');
  await mkdir(destination, { recursive: false, mode: 0o700 });
  for (const entry of entries.values()) {
    const output = resolvedEntryPath(destination, entry.path);
    if (entry.directory) {
      await mkdir(output, { recursive: true, mode: 0o755 });
      continue;
    }
    const contents = unzipped[entry.archiveName];
    if (!contents) throw new Error(`Template archive entry could not be read: ${entry.path}`);
    await mkdir(dirname(output), { recursive: true, mode: 0o755 });
    await writeFile(output, contents, { flag: 'wx', mode: 0o644 });
  }
}

export async function assertEmptyDestination(destination: string): Promise<'missing' | 'empty'> {
  const absolute = resolve(destination);
  if (absolute === parse(absolute).root) {
    throw new Error('The project directory must not be a filesystem root.');
  }
  try {
    const destinationStats = await lstat(absolute);
    if (!destinationStats.isDirectory()) {
      throw new Error(`Target path is not a directory: ${absolute}`);
    }
    if ((await readdir(absolute)).length > 0) {
      throw new Error(
        `Target directory is not empty: ${absolute}\nChoose an empty directory or a different project name.`,
      );
    }
    return 'empty';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

export const CREATE_WORK_DIRECTORY = '.saavo-create';

const RENAME_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1_600] as const;
const TRANSIENT_RENAME_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);

type RenameEntry = (source: string, destination: string) => Promise<void>;

export interface CommitProjectOptions {
  renameEntry?: RenameEntry | undefined;
  retryDelaysMs?: readonly number[] | undefined;
  wait?: ((milliseconds: number) => Promise<void>) | undefined;
}

function isTransientRenameError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' && TRANSIENT_RENAME_ERROR_CODES.has(code);
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function renameEntryWithRetry(
  source: string,
  destination: string,
  options: CommitProjectOptions,
): Promise<void> {
  const renameEntry = options.renameEntry ?? rename;
  const retryDelays = options.retryDelaysMs ?? RENAME_RETRY_DELAYS_MS;
  const waitForRetry = options.wait ?? wait;

  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameEntry(source, destination);
      return;
    } catch (error) {
      const retryDelay = retryDelays[attempt];
      if (retryDelay === undefined || !isTransientRenameError(error)) throw error;
      await waitForRetry(retryDelay);
    }
  }
}

export async function prepareProjectTarget(destination: string): Promise<{
  state: 'missing' | 'empty';
  workDirectory: string;
  archivePath: string;
  extractionDirectory: string;
}> {
  const state = await assertEmptyDestination(destination);
  if (state === 'missing') await mkdir(destination, { recursive: true, mode: 0o700 });
  const workDirectory = join(destination, CREATE_WORK_DIRECTORY);
  await mkdir(workDirectory, { recursive: false, mode: 0o700 });
  return {
    state,
    workDirectory,
    archivePath: join(workDirectory, 'template.zip'),
    extractionDirectory: join(workDirectory, 'project'),
  };
}

export async function commitProjectFromWorkDirectory(
  extractionDirectory: string,
  destination: string,
  options: CommitProjectOptions = {},
): Promise<string[]> {
  const destinationEntries = await readdir(destination);
  if (
    destinationEntries.length !== 1
    || destinationEntries[0] !== CREATE_WORK_DIRECTORY
  ) {
    throw new Error(
      `Target directory changed while the project was being created: ${destination}`,
    );
  }
  const names = await readdir(extractionDirectory);
  for (const name of names) {
    await renameEntryWithRetry(
      join(extractionDirectory, name),
      join(destination, name),
      options,
    );
  }
  await rm(join(destination, CREATE_WORK_DIRECTORY), { recursive: true, force: true });
  return names;
}

export async function cleanupProjectTarget(
  destination: string,
  originalState: 'missing' | 'empty',
): Promise<void> {
  if (originalState === 'missing') {
    await rm(destination, { recursive: true, force: true });
    return;
  }
  const failures: unknown[] = [];
  for (const name of await readdir(destination)) {
    await rm(join(destination, name), { recursive: true, force: true })
      .catch((error) => failures.push(error));
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'The existing target directory could not be restored.');
  }
}

export async function createTemporaryArchivePath(): Promise<{
  directory: string;
  archivePath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'saavo-create-'));
  return { directory, archivePath: join(directory, 'template.zip') };
}

export async function commitExtractedProject(
  stagingDirectory: string,
  destination: string,
  destinationState: 'missing' | 'empty',
): Promise<string[]> {
  const names = await readdir(stagingDirectory);
  if (destinationState === 'missing') {
    await rename(stagingDirectory, destination);
    return names;
  }

  if ((await readdir(destination)).length > 0) {
    throw new Error(
      `Target directory is not empty: ${destination}\nChoose an empty directory or a different project name.`,
    );
  }

  const moved: string[] = [];
  try {
    for (const name of names) {
      await rename(join(stagingDirectory, name), join(destination, name));
      moved.push(name);
    }
  } catch (error) {
    for (const name of moved.reverse()) {
      await rename(join(destination, name), join(stagingDirectory, name)).catch(() => undefined);
    }
    throw error;
  }
  return moved;
}

export async function cleanupCommittedProject(
  destination: string,
  destinationState: 'missing' | 'empty',
  createdTopLevelEntries: Iterable<string>,
): Promise<void> {
  if (destinationState === 'missing') {
    await rm(destination, { recursive: true, force: true });
    return;
  }
  const failures: unknown[] = [];
  for (const name of new Set(createdTopLevelEntries)) {
    await rm(join(destination, name), { recursive: true, force: true })
      .catch((error) => failures.push(error));
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'One or more generated project entries could not be removed.');
  }
}
