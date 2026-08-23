import { access } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import * as clack from '@clack/prompts';
import {
  requestTemplateDownload,
  type AvailableTemplate,
} from '../api/templates.js';
import { runCommand, type CommandRunner } from '../create/command.js';
import {
  runCreatePreflight,
  type CreatePreflightOptions,
  type PreflightRunner,
} from '../create/preflight.js';
import { proposeProjectName } from '../create/project-name.js';
import type { OAuthConfig } from '../oauth/config.js';
import {
  cleanupProjectTarget,
  commitProjectFromWorkDirectory,
  downloadArchive,
  extractArchive,
  prepareProjectTarget,
} from '../templates/archive.js';
import { customizeExtractedProject } from '../templates/customize.js';

export interface CreateProjectOptions {
  templateId?: string | undefined;
  credentialsPath?: string | undefined;
  cwd?: string | undefined;
  request?: typeof fetch | undefined;
  now?: Date | undefined;
  openBrowser?: boolean | undefined;
  preflight?: PreflightRunner | undefined;
  runner?: CommandRunner | undefined;
  confirmProjectName?: ((
    input: string,
    proposedName: string,
  ) => Promise<boolean | null>) | undefined;
  confirmPrepare?: ((message: string) => Promise<boolean>) | undefined;
  prepareLocalDevelopment?: (
    destination: string,
    runner: CommandRunner,
  ) => Promise<void> | undefined;
}

export interface CreatedProject {
  destination: string;
  template: AvailableTemplate;
  localDevelopmentPrepared: boolean;
}

async function defaultConfirmProjectName(
  _input: string,
  proposedName: string,
): Promise<boolean | null> {
  const answer = await clack.confirm({
    message: `Use "${proposedName}" as the project name?`,
    initialValue: true,
  });
  return clack.isCancel(answer) ? null : answer;
}

async function resolveProjectInput(
  input: string | undefined,
  confirmProjectName = defaultConfirmProjectName,
): Promise<string | null> {
  let candidateInput = input?.trim() || undefined;
  while (true) {
    if (!candidateInput) {
      const answer = await clack.text({
        message: 'Project name',
        placeholder: 'my-saavo-app',
        validate(value) {
          if (!value?.trim()) return 'Enter a project name.';
          try {
            proposeProjectName(value);
            return undefined;
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        },
      });
      if (clack.isCancel(answer)) {
        clack.cancel('Project creation cancelled.');
        return null;
      }
      candidateInput = answer.trim();
    }

    const proposal = proposeProjectName(candidateInput);
    if (!proposal.changed) return proposal.name;
    const confirmed = await confirmProjectName(proposal.input, proposal.name);
    if (confirmed === null) {
      clack.cancel('Project creation cancelled.');
      return null;
    }
    if (confirmed) return proposal.name;
    candidateInput = undefined;
  }
}

async function selectTemplate(
  templates: AvailableTemplate[],
  templateId: string | undefined,
): Promise<AvailableTemplate | null> {
  if (templates.length === 0) return null;
  if (templateId) {
    const template = templates.find((candidate) => candidate.id === templateId);
    if (!template) throw new Error(`Template is not available: ${templateId}`);
    return template;
  }
  if (templates.length === 1) return templates[0]!;
  const selected = await clack.select({
    message: 'Select a template',
    options: templates.map((template) => ({
      value: template.id,
      label: template.name,
      hint: `${template.version} - ${template.description}`,
    })),
  });
  if (clack.isCancel(selected)) {
    clack.cancel('Project creation cancelled.');
    return null;
  }
  return templates.find((template) => template.id === selected) ?? null;
}

async function defaultConfirmPrepare(message: string): Promise<boolean> {
  const answer = await clack.confirm({ message, initialValue: true });
  return !clack.isCancel(answer) && answer;
}

async function dependencyInstallCommand(destination: string): Promise<'ci' | 'install'> {
  try {
    await access(join(destination, 'package-lock.json'));
    return 'ci';
  } catch {
    return 'install';
  }
}

async function defaultPrepareLocalDevelopment(
  destination: string,
  runner: CommandRunner,
): Promise<void> {
  const installCommand = await dependencyInstallCommand(destination);
  const result = await runner('npm', [installCommand], {
    cwd: destination,
    interactive: true,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Project dependency installation failed while running npm ${installCommand}.`,
    );
  }

  const initialized = await runner('npm', ['run', 'saavo:init'], {
    cwd: destination,
    interactive: true,
  });
  if (initialized.exitCode !== 0) {
    throw new Error('Local development initialization failed while running npm run saavo:init.');
  }
}

function displayDestination(destination: string, cwd: string): string {
  const fromCwd = relative(cwd, destination);
  return fromCwd && !fromCwd.startsWith('..') ? fromCwd : destination;
}

export function formatProjectNextSteps(
  shownDestination: string,
  installCommand: 'ci' | 'install',
  localDevelopmentPrepared: boolean,
): string {
  if (localDevelopmentPrepared) {
    return `cd "${shownDestination}"\nnpm run dev\n\nReview .env and configure any optional integrations you plan to use.\nBefore deployment, customize config/ and content/, then run npm run deploy:init.`;
  }
  return `cd "${shownDestination}"\nnpm ${installCommand}\nnpm run saavo:init\nnpm run dev\n\nAfter initialization, review .env and configure any optional integrations you plan to use.`;
}

export async function createProject(
  config: OAuthConfig,
  templatesEndpoint: URL,
  currentUserEndpoint: URL,
  projectInput?: string,
  options: CreateProjectOptions = {},
): Promise<CreatedProject | null> {
  const projectName = await resolveProjectInput(
    projectInput,
    options.confirmProjectName ?? defaultConfirmProjectName,
  );
  if (!projectName) return null;

  const cwd = resolve(options.cwd ?? process.cwd());
  const destination = resolve(cwd, projectName);
  const target = await prepareProjectTarget(destination);
  const runner = options.runner ?? runCommand;
  let projectCommitted = false;

  try {
    const preflightOptions: CreatePreflightOptions = {
      config,
      templatesEndpoint,
      currentUserEndpoint,
      credentialsPath: options.credentialsPath,
      openBrowser: options.openBrowser,
      request: options.request,
      runner,
    };
    const preflight = await (options.preflight ?? runCreatePreflight)(preflightOptions);
    const template = await selectTemplate(preflight.templates, options.templateId);
    if (!template) {
      await cleanupProjectTarget(destination, target.state);
      return null;
    }

    clack.log.step(`Requesting ${template.name} ${template.version}`);
    const release = await requestTemplateDownload(
      templatesEndpoint,
      template,
      preflight.account.credentials,
      {
        allowInsecure: config.allowInsecure,
        request: options.request,
        now: options.now,
      },
    );

    clack.log.step('Downloading and verifying template archive');
    await downloadArchive(release.download.url, target.archivePath, {
      expectedSize: release.sizeBytes,
      expectedSha256: release.sha256,
      request: options.request,
    });
    clack.log.step('Extracting template');
    await extractArchive(target.archivePath, target.extractionDirectory);
    clack.log.step('Applying project name');
    await customizeExtractedProject(target.extractionDirectory, projectName);
    await commitProjectFromWorkDirectory(target.extractionDirectory, destination);
    projectCommitted = true;

    const localDevelopmentPrepared = await (
    options.confirmPrepare ?? defaultConfirmPrepare
    )(
      'Prepare the project for local development?\nInstalls dependencies, creates .env, and initializes local databases.',
    );
    if (localDevelopmentPrepared) {
      clack.log.step('Preparing local development');
      await (options.prepareLocalDevelopment ?? defaultPrepareLocalDevelopment)(
        destination,
        runner,
      );
      clack.log.success('Project is ready for local development');
    }

    const shownDestination = displayDestination(destination, cwd);
    const installCommand = await dependencyInstallCommand(destination);
    clack.log.success(
      `Created ${basename(destination)} from ${template.name} ${template.version}.`,
    );
    clack.note(
      formatProjectNextSteps(
        shownDestination,
        installCommand,
        localDevelopmentPrepared,
      ),
      'Next steps',
    );
    return { destination, template, localDevelopmentPrepared };
  } catch (error) {
    if (projectCommitted) {
      const shownDestination = displayDestination(destination, cwd);
      const installCommand = await dependencyInstallCommand(destination);
      clack.note(
        `The extracted project was preserved. Fix the error, then run:\n\ncd "${shownDestination}"\nnpm ${installCommand}\nnpm run saavo:init\nnpm run dev`,
        'Resume setup',
      );
    } else {
      await cleanupProjectTarget(destination, target.state).catch((cleanupError) => {
        const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        clack.log.warn(`Project cleanup failed: ${message}`);
      });
    }
    throw error;
  }
}
