# Production deployment to Cloudflare

## Context

TransitMapper (`apps/web` + `apps/worker`, Cloudflare Workers + D1 + Hono) has
no deployment automation yet — no `.github/` directory, no remote D1
database, no custom domain. The sibling `website` repo (Astro on Cloudflare
Pages) already has a mature CI/CD setup: composite GitHub Actions, pinned
action SHAs, secrets scoped to a GitHub `environment`, a same-repo-PR guard.
This spec adapts those conventions for a Worker deployment (assets + D1 +
cron), which is a different Cloudflare product than Pages and has a
different deploy command (`wrangler deploy`, not `wrangler pages deploy`).

## Goals

- Push to `main` → automatic production deploy to `map.lasvegasfortransit.org`.
- Every PR and non-main push runs a CI gate (typecheck + dependency audit)
  before merge.
- Match `website`'s security conventions where they transfer: pinned action
  SHAs, least-privilege `permissions:`, secrets scoped to a GitHub
  `environment`, no tokens passed through composite-action `with:` inputs.
- Clearly separate what this spec automates (workflow YAML, `wrangler.toml`)
  from what requires the user's own Cloudflare account access (API token
  creation, D1 database provisioning, custom domain attachment) — those are
  manual one-time steps with exact commands, not something executed on the
  user's behalf.

## Non-goals

- PR preview deployments (explicitly deferred — see the auth/scope
  discussion; add later if PR volume justifies it).
- Porting `website`'s content-quality audit suite (Lighthouse, axe,
  visual-regression, bundle-size, structured-data, etc.) — those are tuned
  for a marketing/content static site and don't fit a map editor. TypeScript
  is the only thing enforced as correctness here today (no test suite
  exists), so CI enforces that plus a dependency vulnerability gate.
- Any change to application code/behavior.

## Design

### CI workflow (`.github/workflows/ci.yml`)

Triggers: `pull_request` (branches: `[main]`) and `push` (branches-ignore:
`[main]`) — same trigger shape as `website`'s `ci.yml`.

One job, `validate`:
- Checkout (`persist-credentials: false`)
- Setup Node + pnpm (composite action, see below)
- `pnpm typecheck` (root script already exists: `turbo run typecheck:run`)
- `pnpm audit --prod --audit-level=high`

`permissions: contents: read` at the workflow level (least privilege).
`concurrency: group: ci-${{ github.ref }}, cancel-in-progress: true`.

### Deploy workflow (`.github/workflows/deploy-production.yml`)

Triggers: `push` (branches: `[main]`), `workflow_dispatch`.

One job, `deploy`:
- Checkout, setup Node + pnpm
- `environment: { name: production }` — scopes `CLOUDFLARE_API_TOKEN`
  (`secrets`) and `CLOUDFLARE_ACCOUNT_ID` (`vars`) to that GitHub
  Environment, same as `website`.
- Run `pnpm run deploy` (the root package.json script already does
  `pnpm run build && pnpm --filter @transitmapper/worker deploy` — no new
  script needed, just wire CI to call it).

`permissions: { contents: read, deployments: write }`.
`concurrency: { group: deploy-prod, cancel-in-progress: false }` (never
cancel a prod deploy in flight, matching `website`).

No separate "build" job/artifact-upload step like `website`'s two-job split
— `wrangler deploy` needs the built `apps/web/dist` present in the same
job's filesystem right before it deploys (it's not a static artifact handed
to a separate Pages upload step), so build and deploy stay in one job here.

### Composite action: `setup-node-pnpm`

Copy `website`'s `.github/actions/setup-node-pnpm/action.yml` verbatim
(pnpm via `packageManager` field, Node via `engines.node` or an input
default, frozen-lockfile install). `transitmapper`'s root `package.json` has
`packageManager: pnpm@11.10.0` but no `engines.node` — the action's default
Node version input (`22`) is used as-is; add `engines: { node: ">=22" }` to
root `package.json` so the constraint is explicit and matches.

### `wrangler.toml` changes (`apps/worker/wrangler.toml`)

Add a custom domain route:

```toml
[[routes]]
pattern = "map.lasvegasfortransit.org"
custom_domain = true
```

The placeholder `database_id = "00000000-0000-0000-0000-000000000000"` in
`[[d1_databases]]` must be replaced with the real id from the manual `d1
create` step below — deploy will fail against the placeholder id.

### Manual one-time steps (user-executed, not automated by this spec)

These require the user's own Cloudflare account access and are called out
explicitly rather than scripted on their behalf:

1. **Create the remote D1 database:**
   `cd apps/worker && npx wrangler d1 create transitmapper`
   → copy the returned `database_id` into `wrangler.toml`.
2. **Apply migrations to the remote database:**
   `npx wrangler d1 migrations apply transitmapper --remote`
3. **Create a Cloudflare API token** (dashboard → My Profile → API Tokens)
   scoped to: `Workers Scripts:Edit`, `Workers Routes:Edit` (for the custom
   domain route), `D1:Edit`, restricted to the account. Add it as
   `CLOUDFLARE_API_TOKEN` under a `production` GitHub Environment secret
   (repo Settings → Environments → New environment `production` → add
   secret). Add `CLOUDFLARE_ACCOUNT_ID` as an Environment variable (not
   secret — matches `website`'s convention; account id isn't sensitive).
4. **Attach the custom domain:** if `lasvegasfortransit.org` (or its `map`
   subdomain) is already on this Cloudflare account as a zone, the
   `routes`/`custom_domain = true` block above auto-provisions the DNS
   record on next deploy. If the zone lives elsewhere or under a different
   account, the domain needs to be added to this Cloudflare account first
   (dashboard → Add a site) before the route will resolve.

## Testing

- After the manual steps are done, a push to `main` (or manual
  `workflow_dispatch`) should produce a successful `deploy-production` run;
  confirm `https://map.lasvegasfortransit.org/api/systems` responds (404 for
  a nonexistent id is the expected "it's alive" signal, same shape as local
  `wrangler dev` testing already done for the share-expiry feature).
- A PR against `main` should trigger `ci.yml` and show a passing check
  before merge is allowed (branch protection requiring the check is a
  separate manual repo-settings step, not scripted here, but worth noting
  to the user as a follow-up).
