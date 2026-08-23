import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
const semanticVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const version = tag.startsWith('v') ? tag.slice(1) : '';

if (!semanticVersion.test(version)) {
  throw new Error(`Release tag must use v<semver>; received ${tag || '(missing)'}.`);
}

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
if (packageJson.name !== 'saavo-cli' || packageLock.name !== 'saavo-cli') {
  throw new Error('package.json and package-lock.json must both use the public name saavo-cli.');
}
if (packageJson.bin?.saavo !== 'dist/index.js') {
  throw new Error('package.json must publish the saavo executable from dist/index.js.');
}
const versions = [
  packageJson.version,
  packageLock.version,
  packageLock.packages?.['']?.version,
];
if (versions.some(candidate => candidate !== version)) {
  throw new Error(
    `Release tag ${tag} does not match package versions ${versions.join(', ')}.`,
  );
}

console.info(`Validated ${packageJson.name} release ${tag}`);
