# Production Cloudflare Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push to `main` triggers an automatic production deploy of TransitMapper to `map.lasvegasfortransit.org` via Cloudflare Workers; every PR/non-main push runs a typecheck + dependency-audit CI gate first.

**Architecture:** A shared composite GitHub Action (`setup-node-pnpm`, copied verbatim from the `website` repo) installs Node+pnpm. `ci.yml` runs on PRs/non-main pushes and gates on `pnpm typecheck` + `pnpm audit`. `deploy-production.yml` runs on push to `main` and calls the existing root `pnpm run deploy` script (build + `wrangler deploy`) inside a `production`-scoped GitHub Environment holding the Cloudflare credentials. `apps/worker/wrangler.toml` gains a custom-domain route. A handful of steps (API token creation, real D1 database id, DNS/zone attachment) require the user's own Cloudflare account access and are manual, not scripted.

**Tech Stack:** GitHub Actions, Cloudflare Workers (`wrangler deploy`), pnpm/Turborepo monorepo already in place.

**Reference spec:** `docs/superpowers/specs/2026-07-22-prod-deploy-design.md`

**Note on working directory:** This session's git worktree was removed by an earlier `finishing-a-development-branch` cleanup, so all file operations must target the main checkout at `/Users/williecubed/Projects/LasVegansForTransit/transitmapper` explicitly (not the harness's default cwd, which points at the now-empty removed-worktree path). Every step below uses that absolute path.

---

### Task 1: Composite action — `setup-node-pnpm`

**Files:**
- Create: `/Users/williecubed/Projects/LasVegansForTransit/transitmapper/.github/actions/setup-node-pnpm/action.yml`
- Modify: `/Users/williecubed/Projects/LasVegansForTransit/transitmapper/package.json` (add `engines.node`)

- [ ] **Step 1: Add `engines.node` to root `package.json`**

The root `package.json` currently has `packageManager: "pnpm@11.10.0"` but no `engines` field. Add one so the Node constraint is explicit (matches `website`'s convention where `engines.node` documents the minimum):

```json
{
  "name": "transitmapper",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.10.0",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "dev": "pnpm --filter @transitmapper/web dev",
    "preview": "pnpm --filter @transitmapper/web preview",
    "worker:dev": "pnpm --filter @transitmapper/worker dev",
    "build": "turbo run build:run",
    "typecheck": "turbo run typecheck:run",
    "verify": "turbo run verify:run",
    "deploy": "pnpm run build && pnpm --filter @transitmapper/worker deploy"
  },
  "devDependencies": {
    "turbo": "^2.10.5",
    "typescript": "^7.0.2"
  }
}
```

- [ ] **Step 2: Create the composite action**

```yaml
# .github/actions/setup-node-pnpm/action.yml
name: Setup Node + pnpm
description: >
  Install pnpm (version pinned via the repo's `packageManager` field), set up
  Node with the pnpm store cache, and install dependencies with a frozen
  lockfile. Caller must `actions/checkout` first.

inputs:
  node-version:
    description: Node version (defaults to the engines.node minimum, 24).
    required: false
    default: '24'

runs:
  using: composite
  steps:
    # `packageManager: pnpm@x.y.z` in package.json is the source of truth for
    # the pnpm version; pnpm/action-setup picks it up automatically when no
    # `version` input is given.
    - name: Setup pnpm
      uses: pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v5.0.0

    - name: Setup Node ${{ inputs.node-version }}
      uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
      with:
        node-version: ${{ inputs.node-version }}
        cache: pnpm

    - name: Install dependencies
      shell: bash
      run: pnpm install --frozen-lockfile
```

- [ ] **Step 3: Verify the JSON/YAML are well-formed**

Run: `cd /Users/williecubed/Projects/LasVegansForTransit/transitmapper && node -e "require('./package.json')" && npx -y js-yaml .github/actions/setup-node-pnpm/action.yml > /dev/null && echo OK`
Expected: `OK` (fails loudly on invalid JSON/YAML before it ever hits GitHub Actions).

- [ ] **Step 4: Commit**

```bash
cd /Users/williecubed/Projects/LasVegansForTransit/transitmapper
git add package.json .github/actions/setup-node-pnpm/action.yml
git commit -m "Add engines.node and setup-node-pnpm composite action"
```

---

### Task 2: CI workflow

**Files:**
- Create: `/Users/williecubed/Projects/LasVegansForTransit/transitmapper/.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches-ignore: [main]

# Least-privilege defaults.
permissions:
  contents: read

# Cancel in-progress CI when a newer commit lands on the same ref.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  validate:
    name: Validate
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          persist-credentials: false

      - name: Setup Node + pnpm
        uses: ./.github/actions/setup-node-pnpm

      - name: Typecheck
        run: pnpm typecheck

      - name: Dependency audit
        run: pnpm audit --prod --audit-level=high
```

- [ ] **Step 2: Verify the YAML is well-formed**

Run: `cd /Users/williecubed/Projects/LasVegansForTransit/transitmapper && npx -y js-yaml .github/workflows/ci.yml > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 3: Verify the underlying commands succeed locally**

Run: `cd /Users/williecubed/Projects/LasVegansForTransit/transitmapper && pnpm typecheck && pnpm audit --prod --audit-level=high`
Expected: typecheck passes (all 3 packages), and `pnpm audit --prod --audit-level=high` reports no high/critical vulnerabilities (exits 0). If it fails here, CI will fail identically — fix before committing, don't commit a workflow you know will fail.

- [ ] **Step 4: Commit**

```bash
cd /Users/williecubed/Projects/LasVegansForTransit/transitmapper
git add .github/workflows/ci.yml
git commit -m "Add CI workflow (typecheck + dependency audit)"
```

---

### Task 3: `wrangler.toml` custom domain route

**Files:**
- Modify: `/Users/williecubed/Projects/LasVegansForTransit/transitmapper/apps/worker/wrangler.toml`

- [ ] **Step 1: Add the route**

Current file:

```toml
name = "transitmapper"
main = "src/index.ts"
compatibility_date = "2024-11-06"

# Serve the built SPA. The Worker runs first and handles /api/*; every other
# request is forwarded to the static assets (SPA fallback to index.html).
[assets]
directory = "../web/dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = true

[[d1_databases]]
binding = "DB"
database_name = "transitmapper"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "src/migrations"

[triggers]
crons = ["0 0 * * *"]
```

Add a `[[routes]]` block (placement doesn't matter to wrangler, put it after `[triggers]` for readability):

```toml
name = "transitmapper"
main = "src/index.ts"
compatibility_date = "2024-11-06"

# Serve the built SPA. The Worker runs first and handles /api/*; every other
# request is forwarded to the static assets (SPA fallback to index.html).
[assets]
directory = "../web/dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = true

[[d1_databases]]
binding = "DB"
database_name = "transitmapper"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "src/migrations"

[triggers]
crons = ["0 0 * * *"]

[[routes]]
pattern = "map.lasvegasfortransit.org"
custom_domain = true
```

Leave `database_id` as the placeholder for now — Task 5 (manual, user-run)
replaces it with the real id. Deploying with the placeholder id will fail;
that's expected until Task 5 is done.

- [ ] **Step 2: Verify the TOML is well-formed**

Run: `cd /Users/williecubed/Projects/LasVegansForTransit/transitmapper/apps/worker && node -e "require('toml').parse(require('fs').readFileSync('wrangler.toml','utf8')); console.log('OK')" 2>&1 || npx -y @iarna/toml -e "require('@iarna/toml').parse(require('fs').readFileSync('wrangler.toml','utf8'))" 2>&1 || cat wrangler.toml`

If neither `toml` nor `@iarna/toml` is available, just visually confirm the
file's bracket/section structure is intact (`cat wrangler.toml`) — TOML
syntax errors here are simple enough (a stray bracket, un-quoted string)
that a careful read catches them.

- [ ] **Step 3: Commit**

```bash
cd /Users/williecubed/Projects/LasVegansForTransit/transitmapper
git add apps/worker/wrangler.toml
git commit -m "Add custom domain route for map.lasvegasfortransit.org"
```

---

### Task 4: Deploy workflow

**Files:**
- Create: `/Users/williecubed/Projects/LasVegansForTransit/transitmapper/.github/workflows/deploy-production.yml`

- [ ] **Step 1: Create the workflow**

```yaml
# .github/workflows/deploy-production.yml
name: Deploy production

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  deployments: write

# Never cancel a prod deploy in flight — let it finish, then queue the next.
concurrency:
  group: deploy-prod
  cancel-in-progress: false

jobs:
  deploy:
    name: Build and deploy to Cloudflare Workers
    runs-on: ubuntu-latest
    timeout-minutes: 10
    # Scopes secrets to the production environment + surfaces a deployment
    # record in the GitHub UI. Add required reviewers via repo settings if
    # you want a manual approval gate later.
    environment:
      name: production
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          persist-credentials: false

      - name: Setup Node + pnpm
        uses: ./.github/actions/setup-node-pnpm

      - name: Build and deploy
        run: pnpm run deploy
```

Note: unlike `website`'s two-job build-then-deploy split (which hands a
static `dist/` artifact between jobs via upload/download-artifact),
`wrangler deploy` here needs the freshly-built `apps/web/dist` directory
present on the same runner's filesystem right before it deploys — the root
`pnpm run deploy` script already does `build && deploy` back-to-back, so
there's no reason to split this into two jobs and re-transfer the build
output between them.

- [ ] **Step 2: Verify the YAML is well-formed**

Run: `cd /Users/williecubed/Projects/LasVegansForTransit/transitmapper && npx -y js-yaml .github/workflows/deploy-production.yml > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/williecubed/Projects/LasVegansForTransit/transitmapper
git add .github/workflows/deploy-production.yml
git commit -m "Add production deploy workflow"
```

---

### Task 5: Manual Cloudflare account setup (user-executed)

**Files:** none — this task is a checklist for the user, not code changes.
It cannot be executed by the implementing agent because it requires the
user's own Cloudflare account credentials/access.

- [ ] **Step 1: Create the remote D1 database**

The user runs (needs to be logged into their own Cloudflare account via
`wrangler login` first, or have `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`
env vars set locally):

```bash
cd /Users/williecubed/Projects/LasVegansForTransit/transitmapper/apps/worker
npx wrangler d1 create transitmapper
```

This prints a `database_id`. The user (or the implementing agent, once the
user has pasted the id back) edits `apps/worker/wrangler.toml`, replacing:

```toml
database_id = "00000000-0000-0000-0000-000000000000"
```

with the real id, then commits:

```bash
cd /Users/williecubed/Projects/LasVegansForTransit/transitmapper
git add apps/worker/wrangler.toml
git commit -m "Set real D1 database id for production"
```

- [ ] **Step 2: Apply migrations to the remote database**

```bash
cd /Users/williecubed/Projects/LasVegansForTransit/transitmapper/apps/worker
npx wrangler d1 migrations apply transitmapper --remote
```

Expected: both `0001_init.sql` and `0002_share_expiry.sql` show `✅`, same
shape as the local `--local` runs already done in this repo's history.

- [ ] **Step 3: Create a Cloudflare API token**

Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom
token, scoped to (this account only):
- `Workers Scripts:Edit`
- `Workers Routes:Edit` (needed for the custom domain route)
- `D1:Edit`

- [ ] **Step 4: Add GitHub Environment secrets**

Repo → Settings → Environments → New environment, name it `production`.
Inside that environment:
- Add secret `CLOUDFLARE_API_TOKEN` = the token from Step 3.
- Add variable (not secret) `CLOUDFLARE_ACCOUNT_ID` = the account id (found
  on the Cloudflare dashboard's right sidebar on any account page).

- [ ] **Step 5: Attach the custom domain**

If `lasvegasfortransit.org` is already a zone on this Cloudflare account,
the `[[routes]]` block from Task 3 auto-provisions the DNS record on the
next successful deploy — no separate action needed. If the zone is not yet
on this account, add it first: Cloudflare dashboard → Add a site →
`lasvegasfortransit.org`, follow the nameserver-change instructions, wait
for the zone to go active, then re-run the deploy workflow
(`workflow_dispatch` or push to `main`).

- [ ] **Step 6: Trigger and verify the first production deploy**

Once Steps 1–5 are done, either push to `main` or trigger manually:

```bash
gh workflow run deploy-production.yml --ref main
```

Then confirm:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://map.lasvegasfortransit.org/api/systems/nonexistent-id
```

Expected: `404` (the worker is live and D1-backed; a nonexistent share id
correctly 404s, same "it's alive" signal used when testing this feature
locally against `wrangler dev`).

---

### Task 6: Optional follow-up — branch protection

**Files:** none — repo settings only, not code.

- [ ] **Step 1: Require the CI check before merge**

Repo → Settings → Branches → Add branch protection rule for `main` →
require status check `Validate` (the `ci.yml` job name) to pass before
merging. Not automatable from this plan (GitHub API/`gh` can set this, but
it changes merge policy account-wide — flagging it as a manual decision for
the user rather than silently enabling it).
