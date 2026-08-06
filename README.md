# Saavo CLI

The command-line client for authorizing access and creating projects from Saavo templates.

## Requirements

- Node.js 20 or newer
- An OAuth 2.0 public-client registration whose redirect URI accepts an IPv4 loopback address with a dynamic port, as defined by RFC 8252

## Development

```bash
npm install
cp .env.example .env
npm run dev -- login
```

Vite Node automatically loads `.env` for `npm run dev`. Command-line options override environment variables.

## OAuth login

Set the registered public Client ID, then run the login command:

```bash
export SAAVO_OAUTH_CLIENT_ID="your-client-id"
npm run dev -- login
```

PowerShell:

```powershell
$env:SAAVO_OAUTH_CLIENT_ID = "your-client-id"
npm run dev -- login
```

The login flow uses OAuth 2.0 Authorization Code with PKCE S256. It opens the system browser, listens on a random `127.0.0.1` port for the redirect, validates `state`, and exchanges the authorization code as a public client without a Client Secret. It then uses the access token to load the current user's stable ID, name, email, and account metadata before storing the account in `~/.saavo/credentials.json` with owner-only permissions where supported.

Configuration can also be passed explicitly:

```bash
saavo login \
  --client-id "your-client-id" \
  --issuer "https://saavo.dev" \
  --authorization-endpoint "https://saavo.dev/oauth/authorize" \
  --token-endpoint "https://saavo.dev/oauth/token" \
  --current-user-endpoint "https://saavo.dev/oauth/current-user" \
  --scope "user templates:read"
```

Use `--no-browser` when the browser must be opened manually.

`saavo login` reuses the active account when its issuer, Client ID, scopes, and expiration are still valid. When the Access Token is expired and a matching Refresh Token is available, it first uses the standard Refresh Token Grant and atomically updates that account. A missing or rejected Refresh Token falls back to browser authorization. Use `saavo login --force` to bypass reuse and refresh. Accounts use the server user ID when available and otherwise use the normalized email address. No identity is entered manually.

Force the active account through the Refresh Token Grant regardless of Access Token expiry:

```bash
saavo refresh
```

Unlike automatic login fallback, `saavo refresh` never opens a browser. A missing or rejected Refresh Token is reported as an error and written to `last-error.json`.

## Accounts

List stored accounts without exposing tokens:

```bash
saavo account list
saavo account list --json
```

Switch by email, server user ID, or stored account key:

```bash
saavo account use user@example.com
saavo account use user-123
saavo account use email:user@example.com
```

Run `saavo account use` without an argument to select interactively. If the same identifier exists under multiple issuers, pass `--issuer <url>` or use the interactive selector. Switching changes only the active-account pointer and never copies or overwrites tokens.

Log out the active account:

```bash
saavo logout
```

Logout removes only the active account's local credentials. When other accounts remain, the most recently stored remaining account automatically becomes active. When no accounts remain, `credentials.json` is removed.

## Templates

List the templates available to the active account:

```bash
saavo templates
saavo templates --json
```

The command calls the protected template catalog with the active account's Bearer token. If the Access Token has expired and a matching Refresh Token exists, it refreshes the token before loading the catalog. An empty catalog is a successful result and explains that either no release has been published or the active account does not currently have access.

## Configuration

| Environment variable | Purpose | Default |
| --- | --- | --- |
| `SAAVO_OAUTH_CLIENT_ID` | Registered OAuth public Client ID | Required |
| `SAAVO_OAUTH_ISSUER` | Authorization server issuer | `https://saavo.dev` |
| `SAAVO_OAUTH_AUTHORIZATION_ENDPOINT` | Authorization endpoint | `https://saavo.dev/oauth/authorize` |
| `SAAVO_OAUTH_TOKEN_ENDPOINT` | Token endpoint | `https://saavo.dev/oauth/token` |
| `SAAVO_CURRENT_USER_ENDPOINT` | Protected endpoint used to identify the token owner | `https://saavo.dev/oauth/current-user` |
| `SAAVO_TEMPLATES_ENDPOINT` | Protected endpoint used to list available templates | `https://saavo.dev/api/templates` |
| `SAAVO_OAUTH_SCOPE` | Space-separated requested scopes | `user templates:read` |
| `SAAVO_OAUTH_ALLOW_INSECURE` | Allow loopback HTTP OAuth endpoints in local development | `false` |
| `SAAVO_CONFIG_DIR` | Runtime directory for credentials and diagnostic logs | `~/.saavo` |

Configuration precedence is: command-line option, runtime environment variable, embedded production configuration, built-in default.

### Production build

Production configuration is public application metadata, not secret material. Copy the example file, set the registered Client ID, and build:

```bash
cp .env.production.example .env.production
npm run build:production
```

Vite automatically loads `.env.production` in production mode and statically embeds the public configuration into `dist/index.js`. The published CLI therefore works without OAuth environment variables. Runtime environment variables and command-line options can still override embedded values for diagnostics. `.env.production` is ignored by Git and is not published.

Never add a Client Secret: this CLI is an OAuth public client and does not support one.

When the authorization server itself runs locally over HTTP, opt in explicitly:

```env
SAAVO_OAUTH_ISSUER=http://localhost:5173
SAAVO_OAUTH_AUTHORIZATION_ENDPOINT=http://localhost:5173/oauth/authorize
SAAVO_OAUTH_TOKEN_ENDPOINT=http://localhost:5173/oauth/token
SAAVO_CURRENT_USER_ENDPOINT=http://localhost:5173/oauth/current-user
SAAVO_TEMPLATES_ENDPOINT=http://localhost:5173/api/templates
SAAVO_OAUTH_ALLOW_INSECURE=true
```

This exception accepts only loopback hosts (`localhost`, `127.0.0.1`, and `::1`). Production builds never embed the insecure-development flag.

`SAAVO_CONFIG_DIR` is intentionally runtime-only because filesystem locations depend on the current user and operating system. For example:

```powershell
$env:SAAVO_CONFIG_DIR = "D:\saavo-cli"
saavo login
```

The resulting files are `D:\saavo-cli\credentials.json` and, after a failure, `D:\saavo-cli\last-error.json`.

### Error diagnostics

Every unhandled CLI error is printed prominently in the terminal and replaces `last-error.json` in `SAAVO_CONFIG_DIR`. The file records only the latest failure with its timestamp, command, sanitized message, error type, OAuth error fields, HTTP status when available, cause chain, and stack trace. Access Tokens, refresh tokens, authorization codes, state values, PKCE verifiers, and Client Secrets are redacted.

### Current-user response contract

After token exchange, `SAAVO_CURRENT_USER_ENDPOINT` must accept the access token as a Bearer token and return:

```json
{
  "success": true,
  "data": {
    "id": "optional-stable-user-id",
    "name": "Display name",
    "email": "user@example.com"
  }
}
```

`data.name` and `data.email` are required. When `data.id` is present, it is used as the account key; otherwise the trimmed, lowercased email address is used. Optional `isPremium` and boolean `permissions` fields are stored as account metadata. The credential file is versioned and contains an active-account pointer plus one isolated token record per issuer and account key.

### Templates response contract

`SAAVO_TEMPLATES_ENDPOINT` must accept the access token as a Bearer token and return:

```json
{
  "success": true,
  "data": {
    "templates": [
      {
        "id": "saavo-default",
        "name": "Saavo Default",
        "description": "The default application template included with Saavo.",
        "version": "1.0.0",
        "sha256": "64-character SHA-256 digest",
        "sizeBytes": 2048,
        "publishedAt": 1786000000000
      }
    ]
  }
}
```

`data.templates` may be an empty array. All listed release fields are validated before they are displayed.

## Protocol guarantees

- Authorization Code grant
- PKCE with the S256 transformation
- cryptographically random `state` and PKCE verifier values
- exact `state` validation before the Token request
- public-client authentication (`token_endpoint_auth_method=none`)
- HTTPS authorization-server endpoints
- loopback redirect bound only to `127.0.0.1`
- no Client Secret accepted or sent by the CLI

## Checks

```bash
npm test
npm run test:watch
npm run typecheck
npm run build
```
