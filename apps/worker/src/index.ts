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
  await c.env.DB.prepare(
    "INSERT INTO systems (id, name, data, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, system.name.slice(0, 200), JSON.stringify(system), now)
    .run();

  return c.json<CreateShareResponse>({ id });
});

// Fetch a shared system snapshot.
app.get("/api/systems/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT id, data, created_at FROM systems WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; data: string; created_at: number }>();

  if (!row) return c.json({ error: "Not found" }, 404);

  return c.json<GetShareResponse>({
    id: row.id,
    system: JSON.parse(row.data),
    createdAt: row.created_at,
  });
});

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// Everything else is a static asset (with SPA fallback to index.html for
// client routes like /s/:id), served by the assets binding.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
