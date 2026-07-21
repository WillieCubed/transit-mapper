import { parseSystem } from "@transitmapper/core/model/serialize";
import type { TransitSystem } from "@transitmapper/core/model/system";
import type { CreateShareResponse, GetShareResponse } from "@transitmapper/core/share/contract";

/** POST a system snapshot; returns the share id. */
export async function createShare(system: TransitSystem): Promise<string> {
  const res = await fetch("/api/systems", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Share failed (${res.status}): ${msg}`);
  }
  const data = (await res.json()) as CreateShareResponse;
  return data.id;
}

/** Fetch a shared system by id and validate it. */
export async function fetchShare(id: string): Promise<TransitSystem> {
  const res = await fetch(`/api/systems/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error("This shared system was not found.");
  if (!res.ok) throw new Error(`Failed to load shared system (${res.status}).`);
  const data = (await res.json()) as GetShareResponse;
  return parseSystem(data.system);
}
