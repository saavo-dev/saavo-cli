# Publishing Saavo CLI

The public npm package is `saavo-cli`, and its executable is `saavo`.

## Repository prerequisites

1. Create the public GitHub repository `saavo-dev/saavo-cli` and push this repository to it.
2. In GitHub repository variables, create `SAAVO_OAUTH_CLIENT_ID` with the OAuth public Client ID registered for the CLI.
3. Confirm the OAuth client accepts IPv4 loopback redirects matching `http://127.0.0.1:<dynamic-port>/oauth/callback`.
4. Keep the repository public so npm can generate public provenance attestations.

The `repository` value in `package.json` must continue to match the GitHub repository exactly.

## Trusted Publisher

`saavo-cli` is connected to npm Trusted Publishing with this configuration:

- Provider: GitHub Actions
- Organization or user: `saavo-dev`
- Repository: `saavo-cli`
- Workflow filename: `publish.yml`
- Allowed action: `npm publish`

The package publishing-access setting requires two-factor authentication and disallows bypass-2FA tokens. Do not add an `NPM_TOKEN` GitHub secret: releases authenticate through GitHub OIDC and receive npm provenance.

## Normal release

Start from a clean `master` branch after CI succeeds:

```bash
npm version patch
git push origin master --follow-tags
```

Use `npm version minor` or `npm version major` when appropriate. `npm version` synchronizes `package.json` and `package-lock.json`, creates the release commit, and creates the matching `v<version>` tag. Pushing the tag starts the publish workflow.

The workflow rejects tags that do not match all package version fields. It then installs locked dependencies, runs tests and type checking, injects the public OAuth Client ID, builds the production CLI, packs and installs the npm artifact, and publishes it.

Published npm name/version combinations are immutable. Never move or reuse a release tag after npm publication.
