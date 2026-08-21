# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- `npm run dev`, `npm run build`, `npm test`, and `npm run lint` work on Windows, macOS, and Linux.
- The optional hardened `npm run install:ci` lifecycle requires Linux with `flock`, `curl`, and GNU `timeout`.

## Required security setup

Run the `0001_secure_state_and_auth` D1 migration before serving this version. It invalidates all legacy sessions and removes accounts that were originally seeded from committed passwords.

Configure a new administrator with deployment secrets (never committed files):

```text
SALS_ADMIN_USERNAME=your-admin-name
SALS_ADMIN_PASSWORD=use-a-long-random-secret
SALS_ADMIN_NAME=Display Name
SALS_ADMIN_PASSWORD_VERSION=1
```

The deployment-secret account is the **Super Admin**. Increment `SALS_ADMIN_PASSWORD_VERSION` whenever its password changes. The next authentication attempt derives a new PBKDF2 hash and invalidates that account's sessions.

The enforced application roles are:

- **Super Admin:** creates Admin accounts, deletes Admin or Standard User accounts, and can review comments or accept appeals.
- **Admin:** manages personnel records, creates or deletes Standard User accounts, and can review comments or accept appeals.
- **Standard User:** has read-only personnel access and can submit comments, reviews, suggestions, and appeals. Submissions remain pending until an Admin or Super Admin reviews them.

Feedback counts for pending, reviewed, appeal-accepted, and rejected submissions appear on the Dashboard. Reviewed comments and accepted appeals are visible to all signed-in users. Rejected appeals remain visible to the submitter and both administrator roles.

Each staff and worker profile includes a linked **Comment / Appeal** box. A Standard User manager can submit either type against that specific record. Admins and Super Admins mark comments **Reviewed**; appeals must be either **Rejected** or **Appeal Accepted**. Completed personnel responses are shown on the Dashboard without changing the person's offence points or violation history.

The Dashboard provides a **Reset** action only to the Super Admin. It requires typing `RESET`, clears every staff and worker offence history, returns demerit points to 0 and total points to 100, restores **No Disciplinary Action**, and removes all feedback records. Personnel records, offence rules, staff and worker thresholds, and user accounts are preserved.

Workspace identity is disabled by default. It may be enabled only when a trusted dispatch layer strips and injects the `oai-authenticated-user-*` headers:

```text
SALS_TRUST_WORKSPACE_HEADERS=true
SALS_ADMIN_EMAILS=admin@example.com
SALS_AUTHORIZED_EMAILS=viewer1@example.com,viewer2@example.com
```

Only explicitly allowlisted emails receive access. Administrators can write; authorized viewers are read only. Requests without an authenticated, allowlisted identity or valid administrator session cannot read personnel data.

The former personnel seed JSON files were removed from deployable source. A local recovery copy may exist under ignored `.private-data/`; do not commit, upload, or package that folder. Populate a fresh environment through the protected Excel import after signing in.

For a local recovery import, start the development server and run the following in a second terminal. The command reads credentials from `.dev.vars`, validates the private files, and writes through the authenticated API so revision and audit controls remain active:

```text
npm run db:import-private
```

The command refuses to replace non-empty staff or worker lists. Use `npm run db:import-private -- --force` only when replacing both lists is intentional.

## Sites Lifecycle

The Sites lifecycle CLI runs the locked dependency install before returning this checkout. Edit the source under `app/`, then checkpoint when a coherent milestone is ready to inspect or share. The remote Sites builder runs `npm run build` against the pushed commit. Do not repeat install or build as a normal pre-checkpoint step.

This starter does not use `wrangler.jsonc`.

`install:ci` is intentionally a single, non-retrying `npm ci`. It refuses a concurrent install for the same project, consumes a matching image-seeded npm cache with `--prefer-offline` while retaining registry fallback for a missing cache object, otherwise downloads and verifies the complete vinext tarball recorded in `package-lock.json`, limits npm to one socket, and terminates a stalled install. `build` applies a short timeout. These helpers target Linux and use GNU `timeout`; they are not native macOS scripts.

Scripts that need writable project-scoped home, npm, XDG, and temporary paths use `scripts/sites-env.sh`. The `dev` and `start` scripts honor the caller's runtime environment and keep Wrangler logs inside the checkout. The generated `.sites-runtime/` directory is disposable and ignored by Git.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` defines revisioned application snapshots, PBKDF2-backed accounts, login throttling, sessions, and append-only audit events
- `app/api/users/route.ts` enforces hierarchical account creation without exposing password hashes
- `app/api/feedback/route.ts` enforces Standard User submission and Super Admin-only moderation
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Diagnostic Commands

- `npm run install:ci`: perform the one bounded lockfile install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: start the built Vinext application
- `npm test`: build and verify the rendered development-preview metadata
- `npm run db:generate`: generate Drizzle migrations after schema changes
- `npm run db:import-private`: securely recover ignored local staff and worker JSON into a running local preview
- `npm run test:unit`: run validation and security-contract tests without building
- `npm audit --package-lock-only --omit=dev`: verify the production dependency lock

Use build commands for targeted diagnosis after a remote failure, not as part of the normal checkpoint path.

The timeout defaults can be overridden for a controlled canary with `SITES_INSTALL_TIMEOUT`, `SITES_INSTALL_KILL_AFTER`, `SITES_BUILD_TIMEOUT`, and `SITES_BUILD_KILL_AFTER`. A timeout fails the command; the helpers never retry an unchanged install or build.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
