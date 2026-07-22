# Share Expiration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anonymous shares expire 7 days after creation, enforced both lazily (on read) and by a daily cron sweep, with a schema that anticipates future account-owned shares (`expires_at = NULL` = never expires).

**Architecture:** One D1 migration adds a nullable `expires_at` column and clears existing rows. The `POST /api/systems` handler sets `expires_at` on insert. The `GET /api/systems/:id` handler checks `expires_at` and deletes+404s if expired. A new `scheduled()` handler, wired alongside the existing Hono `app` in the Worker's default export, runs a daily `DELETE` for any expired rows a cron sweep would catch that reads never touched.

**Tech Stack:** Cloudflare Workers, Hono, D1 (SQLite-compatible), Wrangler Cron Triggers. No test framework currently exists in `apps/worker` — verification is manual via `wrangler dev` + `curl` against a local D1 instance, matching the package's existing lack of automated tests.

**Reference spec:** `docs/superpowers/specs/2026-07-21-share-expiry-design.md`

---

### Task 1: Migration — add `expires_at`, clear existing shares

**Files:**
- Create: `apps/worker/src/migrations/0002_share_expiry.sql`

- [ ] **Step 1: Write the migration**

```sql
-- apps/worker/src/migrations/0002_share_expiry.sql
-- No account system exists yet, so all current rows are anonymous shares
-- created under the old (no-expiry) policy. Rather than backfilling a
-- retroactive expiry, we clear them — anyone with an old link will see a 404,
-- consistent with "shares aren't guaranteed to be permanent."
DELETE FROM systems;

ALTER TABLE systems ADD COLUMN expires_at INTEGER;
```

- [ ] **Step 2: Apply the migration to the local dev D1 database**

Run: `cd apps/worker && npx wrangler d1 migrations apply transitmapper --local`
Expected: output listing `0002_share_expiry.sql` as applied, no errors.

- [ ] **Step 3: Verify the column exists**

Run: `cd apps/worker && npx wrangler d1 execute transitmapper --local --command "PRAGMA table_info(systems);"`
Expected: a row for `expires_at` with type `INTEGER`, and the `systems` table has 0 rows (from `SELECT count(*) FROM systems` if you want to double check).

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/migrations/0002_share_expiry.sql
git commit -m "Add expires_at column to systems table, clear existing shares"
```

---

### Task 2: Set `expires_at` on share creation

**Files:**
- Modify: `apps/worker/src/index.ts:19-42` (the `POST /api/systems` handler)

- [ ] **Step 1: Add a shared constant and update the insert**

Modify `apps/worker/src/index.ts`. Add this constant near the top, alongside `MAX_BODY_BYTES`:

```typescript
const MAX_BODY_BYTES = 1_000_000; // ~1 MB — generous for a hand-drawn system.
const ANONYMOUS_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days.
```

Then update the `POST /api/systems` handler's insert to compute and bind `expires_at`:

```typescript
app.post("/api/systems", async (c) => {
  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return c.json({ error: "System too large" }, 413);
  }

  let system;
  try {
    const body = JSON.parse(raw) as { system?: unknown };
    system = parseSystem(body.system);
  } catch (e) {
    return c.json({ error: `Invalid system: ${(e as Error).message}` }, 400);
  }

  const id = shortId(10);
  const now = Date.now();
  const expiresAt = now + ANONYMOUS_SHARE_TTL_MS;
  await c.env.DB.prepare(
    "INSERT INTO systems (id, name, data, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, system.name.slice(0, 200), JSON.stringify(system), now, expiresAt)
    .run();

  return c.json<CreateShareResponse>({ id });
});
```

- [ ] **Step 2: Verify manually with wrangler dev**

Run: `cd apps/worker && npx wrangler dev --local --persist-to .wrangler/state`

In another terminal:
```bash
curl -s -X POST http://localhost:8787/api/systems \
  -H 'content-type: application/json' \
  -d '{"system":{"id":"test-1","name":"Test System","stops":[],"ways":[],"lines":[],"createdAt":0,"updatedAt":0}}'
```
Expected: a JSON response like `{"id":"<10-char-id>"}` (adjust the request body's `system` shape to whatever `parseSystem` in `packages/core/src/model/serialize.ts` actually requires — check that file if this 400s on shape).

Then check the row directly:
```bash
cd apps/worker && npx wrangler d1 execute transitmapper --local --command "SELECT id, created_at, expires_at FROM systems;"
```
Expected: `expires_at` is approximately `created_at + 604800000` (7 days in ms).

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "Set 7-day expires_at on anonymous share creation"
```

---

### Task 3: Enforce expiry on read (lazy delete + 404)

**Files:**
- Modify: `apps/worker/src/index.ts` (the `GET /api/systems/:id` handler)

- [ ] **Step 1: Update the handler to check and enforce expiry**

Replace the existing `GET /api/systems/:id` handler:

```typescript
app.get("/api/systems/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT id, data, created_at, expires_at FROM systems WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; data: string; created_at: number; expires_at: number | null }>();

  if (!row) return c.json({ error: "Not found" }, 404);

  if (row.expires_at !== null && row.expires_at < Date.now()) {
    await c.env.DB.prepare("DELETE FROM systems WHERE id = ?").bind(id).run();
    return c.json({ error: "Not found" }, 404);
  }

  return c.json<GetShareResponse>({
    id: row.id,
    system: JSON.parse(row.data),
    createdAt: row.created_at,
  });
});
```

- [ ] **Step 2: Verify manually — non-expired share still works**

With `wrangler dev` still running, re-run the `curl -X POST` from Task 2 Step 2 to get a fresh `id`, then:
```bash
curl -s http://localhost:8787/api/systems/<id>
```
Expected: `200` with `{"id":..., "system":{...}, "createdAt":...}`.

- [ ] **Step 3: Verify manually — expired share is deleted and 404s**

Force an expiry by writing a past `expires_at` directly:
```bash
cd apps/worker && npx wrangler d1 execute transitmapper --local --command "UPDATE systems SET expires_at = 1 WHERE id = '<id>';"
curl -i http://localhost:8787/api/systems/<id>
```
Expected: HTTP `404` with `{"error":"Not found"}`.

Then confirm the row is actually gone:
```bash
cd apps/worker && npx wrangler d1 execute transitmapper --local --command "SELECT id FROM systems WHERE id = '<id>';"
```
Expected: no rows returned.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "Delete and 404 expired shares on read"
```

---

### Task 4: Daily cron sweep for unread expired shares

**Files:**
- Modify: `apps/worker/wrangler.toml`
- Modify: `apps/worker/src/index.ts` (add `scheduled()` handler, change default export)

- [ ] **Step 1: Add the cron trigger to wrangler.toml**

Modify `apps/worker/wrangler.toml`, adding this block (anywhere after the existing `[[d1_databases]]` section is fine):

```toml
[triggers]
crons = ["0 0 * * *"]
```

- [ ] **Step 2: Add the scheduled handler and update the default export**

Modify `apps/worker/src/index.ts`. Change the final line from:

```typescript
export default app;
```

to:

```typescript
async function scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM systems WHERE expires_at IS NOT NULL AND expires_at < ?",
  )
    .bind(Date.now())
    .run();
}

export default {
  fetch: app.fetch,
  scheduled,
};
```

- [ ] **Step 3: Verify manually — seed an expired row and trigger the scheduled event**

With `wrangler dev` running, seed one expired and one non-expired row:
```bash
cd apps/worker && npx wrangler d1 execute transitmapper --local --command \
  "INSERT INTO systems (id, name, data, created_at, expires_at) VALUES ('exp-1', 'x', '{}', 0, 1), ('keep-1', 'x', '{}', 0, 9999999999999);"
```

Trigger the scheduled event (wrangler dev supports this via its `__scheduled` test endpoint):
```bash
curl "http://localhost:8787/__scheduled?cron=0+0+*+*+*"
```

- [ ] **Step 4: Confirm only the expired row was deleted**

```bash
cd apps/worker && npx wrangler d1 execute transitmapper --local --command "SELECT id FROM systems WHERE id IN ('exp-1', 'keep-1');"
```
Expected: only `keep-1` is returned; `exp-1` is gone.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/wrangler.toml apps/worker/src/index.ts
git commit -m "Add daily cron sweep to delete expired shares"
```

---

### Task 5: Typecheck the worker package

**Files:** none (verification only)

- [ ] **Step 1: Run the worker's typecheck**

Run: `cd apps/worker && pnpm typecheck:run`
Expected: exits 0, no type errors (in particular, confirm `ScheduledEvent` is recognized — it comes from `@cloudflare/workers-types`, already a devDependency).

If `ScheduledEvent` is not found, check that `apps/worker/tsconfig.json` includes `@cloudflare/workers-types` in its `types` array or that ambient types are picked up the same way the existing `D1Database`/`Fetcher` types in `Env` already are (those work today, so `ScheduledEvent` should resolve the same way — if not, add `"types": ["@cloudflare/workers-types"]` to `apps/worker/tsconfig.json`'s `compilerOptions`).

- [ ] **Step 2: Commit (only if tsconfig needed a change)**

```bash
git add apps/worker/tsconfig.json
git commit -m "Ensure Cloudflare Workers ambient types resolve for ScheduledEvent"
```

(Skip this commit if no file changed in Step 1.)
