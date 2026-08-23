# Publishing Saavo CLI

The public npm package is `saavo`, and its executable is also `saavo`.

## Repository prerequisites

1. Create the public GitHub repository `saavo-dev/saavo-cli` and push this repository to it.
2. In GitHub repository variables, create `SAAVO_OAUTH_CLIENT_ID` with the OAuth public Client ID registered for the CLI.
3. Confirm the OAuth client accepts IPv4 loopback redirects matching `http://127.0.0.1:<dynamic-port>/oauth/callback`.
4. Keep the repository public so npm can generate public provenance attestations.

The `repository` value in `package.json` must continue to match the GitHub repository exactly.

## First publication

Trusted Publisher settings belong to an existing npm package, so the package name must first be claimed once.

1. Create a short-lived granular npm access token that can publish new public packages and save it as the GitHub Actions secret `NPM_TOKEN`.
2. Make sure `package.json` and both root version fields in `package-lock.json` are `0.1.0`.
3. Push the release commit and tag:

   ```bash
   git tag -a v0.1.0 -m v0.1.0
   git push origin master
   git push origin v0.1.0
   ```

4. Wait for `.github/workflows/publish.yml` to publish `saavo@0.1.0`.
5. On npmjs.com, open the `saavo` package settings and configure its Trusted Publisher:

   - Provider: GitHub Actions
   - Organization or user: `saavo-dev`
   - Repository: `saavo-cli`
   - Workflow filename: `publish.yml`
   - Allowed action: `npm publish`

6. Delete the `NPM_TOKEN` GitHub secret and revoke the bootstrap token. Subsequent releases authenticate through GitHub OIDC. The workflow requests npm provenance for both the bootstrap publication and later Trusted Publisher releases.

If the first workflow reports that the name is unavailable, do not rename only the GitHub workflow. Choose a new package name and update `package.json`, `package-lock.json`, README commands, smoke tests, and release validation together.

## Normal release

Start from a clean `master` branch after CI succeeds:

```bash
npm version patch
git push origin master --follow-tags
```

Use `npm version minor` or `npm version major` when appropriate. `npm version` synchronizes `package.json` and `package-lock.json`, creates the release commit, and creates the matching `v<version>` tag. Pushing the tag starts the publish workflow.

The workflow rejects tags that do not match all package version fields. It then installs locked dependencies, runs tests and type checking, injects the public OAuth Client ID, builds the production CLI, packs and installs the npm artifact, and publishes it.

Published npm name/version combinations are immutable. Never move or reuse a release tag after npm publication.
