import type { TransitSystem } from "@transitmapper/core/model/system";

// Same download-a-blob dance as pngExport.ts/svgExport.ts's own
// downloadDataUrl/downloadBlob — kept as its own tiny copy rather than a
// shared util, since each caller's blob type differs and there's nothing
// else in common worth abstracting.
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Downloads the system's raw data as a .json file — the portable escape
 * hatch out of browser localStorage (the only other place a system lives;
 * see storage/localStore.ts). Unlike Share (a hosted, read-only snapshot)
 * this is the actual editable document: back it up, put it in git, move it
 * to another browser/computer, or feed it to external tooling. It's exactly
 * what parseSystem (model/serialize.ts) already accepts, so this file is
 * also what a future "Import system…" would read back in.
 */
export function exportSystemJson(system: TransitSystem): void {
  const blob = new Blob([JSON.stringify(system, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${system.name || "transit-system"}.json`);
}
