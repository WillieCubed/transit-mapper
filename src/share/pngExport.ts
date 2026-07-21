import type { Map as MLMap } from "maplibre-gl";
import { systemBounds } from "../model/geo";
import type { TransitSystem } from "../model/system";
import type { ViewOptions } from "../map/layers";
import { getMap } from "../map/mapRef";
import { legendEntriesFor, type LegendEntry } from "./exportLegend";

const INK = "#191a17";
const PAD = 20; // export-canvas padding, independent of the app's 4px UI grid (this is print/image space)
const TITLE_SIZE = 22;
const SWATCH = 14;
const ROW_H = 22;

export interface ComposeOptions {
  title: string;
  legend: LegendEntry[];
}

function downloadDataUrl(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Draws the title (top-left) and a line-color legend (bottom-left) onto a
 *  copy of the map's rendered canvas — the same visual treatment an MTA-style
 *  wayfinding map uses, composited at export time so the live preview stays a
 *  cheap HTML overlay (see ExportPreviewMap) instead of redrawing on every frame. */
function composeCanvas(src: HTMLCanvasElement, opts: ComposeOptions): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  const scale = window.devicePixelRatio || 1;

  ctx.drawImage(src, 0, 0);

  if (opts.title.trim()) {
    ctx.font = `700 ${TITLE_SIZE * scale}px system-ui, sans-serif`;
    const w = ctx.measureText(opts.title).width;
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillRect(0, 0, w + PAD * 2 * scale, TITLE_SIZE * scale + PAD * 1.6 * scale);
    ctx.fillStyle = INK;
    ctx.textBaseline = "top";
    ctx.fillText(opts.title, PAD * scale, PAD * 0.8 * scale);
  }

  if (opts.legend.length > 0) {
    const rowH = ROW_H * scale;
    const panelH = opts.legend.length * rowH + PAD * scale;
    ctx.font = `500 ${13 * scale}px system-ui, sans-serif`;
    const maxLabelW = Math.max(...opts.legend.map((e) => ctx.measureText(e.label).width));
    const panelW = SWATCH * scale + 10 * scale + maxLabelW + PAD * 2 * scale;
    const top = out.height - panelH;
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillRect(0, top, panelW, panelH);
    opts.legend.forEach((entry, i) => {
      const y = top + PAD * 0.5 * scale + i * rowH;
      ctx.fillStyle = entry.color;
      ctx.fillRect(PAD * scale, y + (rowH - SWATCH * scale) / 2, SWATCH * scale, SWATCH * scale);
      ctx.fillStyle = INK;
      ctx.textBaseline = "middle";
      ctx.fillText(entry.label, PAD * scale + SWATCH * scale + 10 * scale, y + rowH / 2);
    });
  }

  return out;
}

/** Capture an already-framed map (e.g. the export dialog's own preview
 *  instance) as a PNG, with the title/legend composited on top. */
export function exportPngFromMap(map: MLMap, opts: ComposeOptions, filename = "transit-system.png"): void {
  map.once("idle", () => {
    downloadDataUrl(composeCanvas(map.getCanvas(), opts).toDataURL("image/png"), filename);
  });
  map.triggerRepaint();
}

/** Quick-export path: temporarily fit the live app map to the whole system's
 *  extent, capture with title/legend, then restore the camera exactly where
 *  the user left it — so "Export PNG" from the quick menu shows the whole
 *  network (MTA-map style) rather than whatever happened to be on screen. */
export function exportFullSystemPng(system: TransitSystem, view: ViewOptions, filename = "transit-system.png"): void {
  const map = getMap();
  if (!map) return;
  const prev = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  const bounds = systemBounds(system);
  if (bounds) map.fitBounds(bounds, { padding: 56, animate: false });
  map.once("idle", () => {
    downloadDataUrl(
      composeCanvas(map.getCanvas(), { title: system.name || "Transit system", legend: legendEntriesFor(system, view) }).toDataURL(
        "image/png",
      ),
      filename,
    );
    map.jumpTo(prev);
  });
  map.triggerRepaint();
}
