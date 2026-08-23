import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type ParseError,
} from 'jsonc-parser';

export const INITIAL_PROJECT_VERSION = '0.0.1';

type JsonObject = Record<string, unknown>;

interface WranglerConfig extends JsonObject {
  d1_databases?: Array<{ binding?: unknown; database_name?: unknown }>;
  queues?: {
    consumers?: Array<{ queue?: unknown }>;
    producers?: Array<{ binding?: unknown; queue?: unknown }>;
  };
  r2_buckets?: Array<{ binding?: unknown; bucket_name?: unknown }>;
  vars?: JsonObject;
}

type JsonPath = Array<string | number>;
type JsonChange = { path: JsonPath; value: unknown };

function parseJsoncObject(source: string, label: string): JsonObject {
  const errors: ParseError[] = [];
  const value = parse(source, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const summary = errors
      .map((error) => `${printParseErrorCode(error.error)} at ${error.offset}`)
      .join(', ');
    throw new Error(`${label} is invalid: ${summary}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return value as JsonObject;
}

function applyJsonChanges(source: string, changes: JsonChange[]): string {
  let updated = source;
  for (const change of changes) {
    updated = applyEdits(updated, modify(updated, change.path, change.value, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }));
  }
  return updated;
}

function requireArray<T>(value: T[] | undefined, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`wrangler.jsonc must define ${label}.`);
  return value;
}

function requireBindingIndex<T extends { binding?: unknown }>(
  values: T[],
  binding: string,
  label: string,
): number {
  const index = values.findIndex((value) => value.binding === binding);
  if (index < 0) throw new Error(`wrangler.jsonc is missing the ${binding} ${label}.`);
  return index;
}

function projectResourceNames(projectName: string) {
  return {
    db: `${projectName}-db`,
    analyticsDb: `${projectName}-analytics-db`,
    r2: `${projectName}-storage`,
    queues: {
      ASYNC_POLICY_TASK_QUEUE: `${projectName}-policy-task`,
      ASYNC_LOGGER_QUEUE: `${projectName}-async-logger`,
      ANALYTICS_QUEUE: `${projectName}-analytics-events`,
    },
  } as const;
}

async function customizePackage(directory: string, projectName: string): Promise<void> {
  const packagePath = join(directory, 'package.json');
  const source = await readFile(packagePath, 'utf8');
  const packageJson = parseJsoncObject(source, 'package.json');
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    throw new Error('Template package.json must define scripts.');
  }
  for (const script of ['cf-typegen', 'saavo:init']) {
    if (typeof (scripts as JsonObject)[script] !== 'string') {
      throw new Error(`Template package.json must define the ${script} script.`);
    }
  }
  await writeFile(packagePath, applyJsonChanges(source, [
    { path: ['name'], value: projectName },
    { path: ['version'], value: INITIAL_PROJECT_VERSION },
  ]), 'utf8');

  const lockPath = join(directory, 'package-lock.json');
  try {
    const lockSource = await readFile(lockPath, 'utf8');
    const lockJson = parseJsoncObject(lockSource, 'package-lock.json');
    const changes: JsonChange[] = [
      { path: ['name'], value: projectName },
      { path: ['version'], value: INITIAL_PROJECT_VERSION },
    ];
    const packages = lockJson.packages;
    if (packages && typeof packages === 'object' && !Array.isArray(packages)) {
      const rootPackage = (packages as JsonObject)[''];
      if (rootPackage && typeof rootPackage === 'object' && !Array.isArray(rootPackage)) {
        changes.push(
          { path: ['packages', '', 'name'], value: projectName },
          { path: ['packages', '', 'version'], value: INITIAL_PROJECT_VERSION },
        );
      }
    }
    await writeFile(lockPath, applyJsonChanges(lockSource, changes), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function customizeWrangler(directory: string, projectName: string): Promise<void> {
  const path = join(directory, 'wrangler.jsonc');
  const source = await readFile(path, 'utf8');
  const config = parseJsoncObject(source, 'wrangler.jsonc') as WranglerConfig;
  const databases = requireArray(config.d1_databases, 'd1_databases');
  const buckets = requireArray(config.r2_buckets, 'r2_buckets');
  const producers = requireArray(config.queues?.producers, 'queues.producers');
  const consumers = requireArray(config.queues?.consumers, 'queues.consumers');
  if (!config.vars || typeof config.vars !== 'object' || Array.isArray(config.vars)) {
    throw new Error('wrangler.jsonc must define vars.');
  }

  const dbIndex = requireBindingIndex(databases, 'DB', 'D1 binding');
  const analyticsDbIndex = requireBindingIndex(databases, 'ANALYTICS_DB', 'D1 binding');
  const r2Index = requireBindingIndex(buckets, 'MAIN_R2', 'R2 binding');
  const names = projectResourceNames(projectName);
  const queueVariables = {
    ASYNC_POLICY_TASK_QUEUE: 'ASYNC_POLICY_TASK_QUEUE_NAME',
    ASYNC_LOGGER_QUEUE: 'ASYNC_LOGGER_QUEUE_NAME',
    ANALYTICS_QUEUE: 'ANALYTICS_QUEUE_NAME',
  } as const;
  const changes: JsonChange[] = [
    { path: ['name'], value: projectName },
    { path: ['d1_databases', dbIndex, 'database_name'], value: names.db },
    { path: ['d1_databases', analyticsDbIndex, 'database_name'], value: names.analyticsDb },
    { path: ['r2_buckets', r2Index, 'bucket_name'], value: names.r2 },
    { path: ['vars', 'R2_BUCKET_NAME'], value: names.r2 },
  ];

  for (const [binding, queueName] of Object.entries(names.queues)) {
    const producerIndex = requireBindingIndex(producers, binding, 'Queue producer binding');
    const previousQueueName = producers[producerIndex]?.queue;
    if (typeof previousQueueName !== 'string') {
      throw new Error(`wrangler.jsonc ${binding} producer must define queue.`);
    }
    const consumerIndexes = consumers
      .map((consumer, index) => consumer.queue === previousQueueName ? index : -1)
      .filter((index) => index >= 0);
    if (consumerIndexes.length === 0) {
      throw new Error(`wrangler.jsonc is missing the consumer for ${binding}.`);
    }
    changes.push(
      { path: ['queues', 'producers', producerIndex, 'queue'], value: queueName },
      { path: ['vars', queueVariables[binding as keyof typeof queueVariables]], value: queueName },
      ...consumerIndexes.map((consumerIndex) => ({
        path: ['queues', 'consumers', consumerIndex, 'queue'],
        value: queueName,
      })),
    );
  }

  await writeFile(path, applyJsonChanges(source, changes), 'utf8');
}

export async function customizeExtractedProject(
  directory: string,
  projectName: string,
): Promise<void> {
  await customizePackage(directory, projectName);
  await customizeWrangler(directory, projectName);
}
