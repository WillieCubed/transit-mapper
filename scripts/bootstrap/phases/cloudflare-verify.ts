import { readFileSync } from "node:fs";
import path from "node:path";
import { runCommand } from "../lib/shell.js";
import { printToolTable, type ToolRow } from "../lib/ui.js";
import type { PhaseResult } from "./auth.js";

const WORKER_DIR = path.join("apps", "worker");
const WRANGLER_TOML = path.join(WORKER_DIR, "wrangler.toml");
const PLACEHOLDER_DB_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Read-only checks against what Task 5 of the deploy plan provisions by
 * hand: the real D1 database and the custom-domain route. This phase never
 * creates anything — it exists so re-running bootstrap on a fresh clone (or
 * after someone forgets whether setup finished) gives a clear yes/no instead
 * of silently doing nothing.
 */
export async function runCloudflareVerifyPhase(): Promise<PhaseResult> {
  const rows: ToolRow[] = [];
  let allReady = true;

  const toml = readFileSync(WRANGLER_TOML, "utf8");

  const dbIdMatch = toml.match(/database_id\s*=\s*"([^"]+)"/);
  const dbId = dbIdMatch?.[1];
  if (!dbId || dbId === PLACEHOLDER_DB_ID) {
    rows.push({
      label: "D1 database id",
      status: "failed",
      detail: "wrangler.toml still has the placeholder id — run `wrangler d1 create transitmapper` first",
    });
    allReady = false;
  } else {
    const list = runCommand(`cd ${WORKER_DIR} && wrangler d1 list`);
    if (list.ok && list.stdout.includes(dbId)) {
      rows.push({ label: "D1 database", status: "ready", detail: dbId });
    } else {
      rows.push({
        label: "D1 database",
        status: "failed",
        detail: `id ${dbId} not found in \`wrangler d1 list\` for the currently authenticated account`,
      });
      allReady = false;
    }
  }

  const hasCustomDomainRoute = /\[\[routes\]\]/.test(toml) && /custom_domain\s*=\s*true/.test(toml);
  if (hasCustomDomainRoute) {
    const patternMatch = toml.match(/pattern\s*=\s*"([^"]+)"/);
    rows.push({ label: "Custom domain route", status: "ready", detail: patternMatch?.[1] ?? "configured" });
  } else {
    rows.push({
      label: "Custom domain route",
      status: "failed",
      detail: "no `[[routes]]` with custom_domain = true in wrangler.toml",
    });
    allReady = false;
  }

  printToolTable("Cloudflare deployment config", rows);
  return { success: allReady };
}
