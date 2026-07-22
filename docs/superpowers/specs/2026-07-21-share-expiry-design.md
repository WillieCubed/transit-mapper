# Share expiration for anonymous shares

## Context

TransitMapper's share feature (`POST/GET /api/systems`, backed by a D1 `systems`
table) currently stores shared system snapshots indefinitely — no expiry, no
cleanup, no ownership. There is no account system yet. This spec adds a basic
expiration policy for today's anonymous shares, structured so that adding
accounts later (where an account-owned share could be kept indefinitely)
requires no further schema change.

## Goals

- Anonymous shares expire 7 days after creation.
- Expired shares are unreachable via the API (`404`) and are actually deleted,
  not just hidden.
- The schema anticipates future accounts: a share's expiry is nullable, so an
  account-owned share can later be inserted with `expires_at = NULL` (never
  expires) without a migration.
- No UI changes required.

## Non-goals

- Account system implementation.
- Any change to share creation/viewing UX or copy.
- Retaining or migrating existing share rows — per decision, the existing
  `systems` table is cleared as part of this migration rather than backfilled.

## Design

### Schema

New migration `apps/worker/src/migrations/0002_share_expiry.sql`:

- Deletes all existing rows in `systems` (nuked, not backfilled).
- Adds `expires_at INTEGER` (nullable, epoch milliseconds) to `systems`.

`expires_at IS NULL` means "never expires" (reserved for future account-owned
shares). Every anonymous share created after this ships gets a concrete value.

### Create (`POST /api/systems`)

Sets `expires_at = created_at + 7 * 24 * 60 * 60 * 1000` on insert. All shares
today are anonymous, so this is unconditional for now.

### Read (`GET /api/systems/:id`)

After fetching the row:

- If `expires_at` is not null and `expires_at < now`: delete the row, return
  `404` (same shape as "not found" — a caller can't distinguish "never
  existed" from "expired," which is intentional, not a new concern).
- Otherwise: return the row as today.

This means an expired-but-not-yet-cron-swept row that gets requested is
deleted immediately, not left for the cron job.

### Cron cleanup

- `apps/worker/wrangler.toml` gains a `[triggers]` block: `crons = ["0 0 * * *"]`
  (daily, free-tier eligible).
- `apps/worker/src/index.ts` gains a `scheduled()` handler exported alongside
  the existing Hono `app`, running:
  `DELETE FROM systems WHERE expires_at IS NOT NULL AND expires_at < ?`
  bound to the current timestamp.
- This is a backstop for expired shares nobody ever re-requests (so the lazy
  delete on read never fires for them).

### Wiring `scheduled()` with Hono

Hono's `app.fetch` handles HTTP; the Worker's default export needs both a
`fetch` and a `scheduled` handler. The module's default export changes from
`export default app` to an object `{ fetch: app.fetch, scheduled }`.

## Testing

- Unit/integration test (if the worker has a test harness) or manual
  `wrangler dev` check:
  - Create a share, confirm `expires_at` is set to ~7 days out.
  - Manually set an `expires_at` in the past (via direct D1 query in a local
    dev DB) and confirm `GET` returns `404` and the row is gone afterward.
  - Confirm a non-expired share still round-trips normally.
- No automated test for the cron handler's schedule itself (that's
  infrastructure config, not logic) — but the `scheduled()` handler's DELETE
  logic should be exercised directly by invoking it in a test with a mixed
  set of expired/non-expired rows.
