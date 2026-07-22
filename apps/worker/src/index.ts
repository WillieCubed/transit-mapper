import { Hono } from "hono";
import { parseSystem } from "@transitmapper/core/model/serialize";
import { shortId } from "@transitmapper/core/model/ids";
import type {
  CreateShareResponse,
  GetShareResponse,
} from "@transitmapper/core/share/contract";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const MAX_BODY_BYTES = 1_000_000; // ~1 MB — generous for a hand-drawn system.
const ANONYMOUS_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days.

const app = new Hono<{ Bindings: Env }>();

// Create an immutable snapshot of a system and return its share id.
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

// Fetch a shared system snapshot.
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

// Proxy RTC Southern Nevada's real GTFS feed — its own host doesn't send
// CORS headers, so the browser can't fetch it directly; this endpoint (same
// origin as the app) sidesteps that. Passed straight through, not cached —
// the feed is ~6 MB and imported rarely, not worth a KV/R2 cache layer yet.
app.get("/api/gtfs/rtc", async (c) => {
  const upstream = await fetch("https://developer.rtcsnv.com/transitData/google_transit.zip");
  if (!upstream.ok || !upstream.body) {
    return c.json({ error: `RTC GTFS feed unavailable (${upstream.status})` }, 502);
  }
  return new Response(upstream.body, {
    headers: { "content-type": "application/zip" },
  });
});

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// Everything else is a static asset (with SPA fallback to index.html for
// client routes like /s/:id), served by the assets binding.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

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
