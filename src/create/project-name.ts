const MAX_PROJECT_NAME_LENGTH = 46;
const PROJECT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;
const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;
const RESERVED_PROJECT_NAMES = new Set(['saavo-template']);

export interface ProjectNameProposal {
  input: string;
  name: string;
  changed: boolean;
}

export function normalizeProjectName(input: string): string {
  return input
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
}

export function validateProjectName(name: string): string | undefined {
  if (!name) return 'must contain at least one ASCII letter or number';
  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    return `must contain at most ${MAX_PROJECT_NAME_LENGTH} characters`;
  }
  if (!PROJECT_NAME_PATTERN.test(name)) {
    return 'must contain only lowercase letters, numbers, and dashes, and cannot start or end with a dash';
  }
  if (WINDOWS_RESERVED_NAMES.test(name)) {
    return 'is reserved by Windows and cannot be used as a cross-platform directory name';
  }
  if (RESERVED_PROJECT_NAMES.has(name)) return 'is reserved by Saavo';
  return undefined;
}

export function proposeProjectName(input: string): ProjectNameProposal {
  const trimmed = input.trim();
  if (/[\\/]/u.test(trimmed)) {
    throw new Error('Project name must be a name, not a directory path.');
  }
  const name = normalizeProjectName(trimmed);
  const validationError = validateProjectName(name);
  if (validationError) throw new Error(`Project name ${validationError}.`);
  return { input: trimmed, name, changed: name !== trimmed };
}
