<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:1778e9a58376feb11ebc141af79e2d3b159853cf38ee6301d047983b18d5924d -->

# Darker

Darker includes a landing page, a persistent account/project workspace, and a separate preset-layout demo. The workspace runs on Node 24+, Express, and SQLite.

## Run locally

```sh
pnpm install --frozen-lockfile
pnpm start
```

Open `http://localhost:4173`. The server creates `.data/darker.sqlite` automatically. Use Node 24 or newer for its built-in SQLite module. Git must be installed for repository import. The lockfile uses pnpm 11.

The default installation does **not** contact an AI provider. Accounts, project editing, supported GitHub imports, source export, skills, settings, HTML preview, and static HTML publishing work without an AI key.

## What is implemented

- Email/password signup and sign-in, including Gmail addresses. Passwords use salted scrypt hashes; session cookies are HttpOnly and SameSite Strict. This is not Google single sign-on.
- A searchable list of supported country calling codes, sortable A–Z or Z–A. The server validates the mobile number against its selected country. Email and phone ownership are **not verified**.
- Customer allowance: 10 successful AI requests in a rolling 24-hour window starting with the first successful request. Provider failures and conflicting edits do not consume allowance. The server enforces the limit and returns its reset timestamp; the browser displays a countdown and upgrade dialog.
- Server-provisioned owner/admin accounts bypass Darker's prompt allowance. Public signup always creates a customer, regardless of submitted role fields.
- Per-account project files, conversation history (latest 30 messages), reusable instruction skills, and project preferences in SQLite.
- A configurable OpenAI-compatible Chat Completions adapter. Each successful generation returns project files, a summary, and three suggested next steps. Existing project context, preferences, and skills are included. Backend files and database schemas can be generated as source.
- Official `https://github.com/owner/repository.git` imports for active public repositories and public forks. GitHub metadata must report a public repository under 50 MB. Import retains up to 100 supported text files, 100 KB per file and 1.5 MB total. Hidden paths, dependencies, symlinks, and submodules are excluded. Imported repository code and scripts are never executed. GitHub rate limits and network permissions still apply. This does not create a fork on GitHub.
- File editing, a JSON source-file-map download, and a sandboxed interactive preview for **self-contained `index.html`**. The preview does not install packages, run backend code, connect to external services, or represent a full-stack runtime.
- Static HTML snapshots at `/sites/:slug` on this same server. Publishing makes the snapshot available to anyone with its URL. Backend source is not deployed; availability depends on the Darker server and its stored data.
- A minimal owner/admin-only MCP JSON-RPC tool endpoint at `/api/mcp`, using the existing signed-in session. It supports initialization, tools/list, and the read-only list_projects tool. It is not an external MCP connection manager; OAuth discovery and personal access tokens are not configured.
- Three proposed pricing cards. Prices and checkout remain unavailable until the owner supplies package prices, entitlements, and a billing provider. No payment is accepted and no paid entitlement is activated.

## Connect an AI provider

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:2e5aa43052dc560269459e529a622a7e676610b5e6b0f0f18c0bcca3292a4009 -->

Copy `.env.example` to a private `.env` file and configure `AI_API_KEY`, `AI_MODEL`, and, optionally, `AI_BASE_URL`. The `pnpm start` command loads `.env` automatically when present.

<!-- /coderabbit-ai-generated:v1 --> Choose a provider/model that supports `/chat/completions` with `response_format: {"type":"json_object"}`. `AI_BASE_URL` defaults to `https://api.openai.com/v1`; include `/v1` if required by your provider. The model has no default: select an actual model identifier from your provider.

```sh
node --env-file=.env server/index.js
```

The key is read only by the server and is never returned to the browser. Settings report configuration status, not a successful paid provider request. Real generation must be tested after configuration. Do not commit `.env`, expose provider keys in generated projects, or paste keys into chat.

Owner/admin access removes Darker's internal quota. It does **not** remove AI, email/SMS, storage, domain, or hosting provider charges. A local compatible model can be configured if you operate one, but infrastructure and hardware still have costs. There is no promise that building and hosting every application is free.

## Provision an owner or admin

There is no public role-upgrade API. On the server, create a private JSON file outside the repository, accessible only to the server operator (mode 600), containing `email`, `password` (12–128 characters), and `role` (`owner` or `admin`). Use a unique email not already registered; this command creates an account rather than promoting an existing one. Never put passwords in shell command arguments or checked-in files.

```sh
node --env-file=.env server/provision.js /absolute/path/to/private-account.json
```

Remove the private file after the command succeeds. Sign in through the normal account page. Use the same `DATA_DIR` as the running application. No owner/admin account or default privileged password is shipped.

## Production configuration and remaining integrations

Set `DATA_DIR` to durable private storage and back it up using a SQLite-aware backup procedure. Keep this directory out of public web roots. The application serves an explicit allowlist of frontend files; it does not expose the database or server source. Use HTTPS, set `NODE_ENV=production` for Secure session cookies, and configure your reverse proxy to preserve the public Host header. Review proxy-aware rate limiting for your chosen deployment topology before accepting public traffic.

The current implementation uses local SQLite and password authentication. It has no connected managed database, Google OAuth, email verification/delivery, password recovery, SMS ownership verification, billing, or managed full-stack deployment provider. Selecting and configuring those services is required before calling this a production app-building platform. No user payment details or third-party credentials are stored by placeholder integrations.

Generated code and imported code are untrusted. Only sandboxed self-contained HTML executes in the browser; generated backend and shell scripts are downloadable source. A secure isolated build/runtime service and deployment integration are needed to install dependencies, run arbitrary full-stack applications, and publish their backends. Do not run user code in the Darker server process.

The `/api/mcp` interface is intentionally limited to the signed-in owner/admin's project list and cannot run scripts or access other users' projects. External clients need an authenticated session; general MCP authorization is not implemented.

## Verification

```sh
pnpm check
pnpm test
```

For backend-only changes, use `node --test tests/server.test.js`; the legacy layout demo has `node --test tests/builder.test.cjs`. The server tests use temporary databases, synthetic accounts, and a local HTTP provider fixture. They explicitly discard inherited AI credentials and never prove real model generation, billing, or external deployment readiness.


<!-- /coderabbit-ai-generated:v1 -->