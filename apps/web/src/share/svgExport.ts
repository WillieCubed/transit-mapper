import type { Feature, LineString, Point } from "geojson";
import type { Map as MLMap } from "maplibre-gl";
import type { Selection } from "../editor/store";
import { buildFeatures, type ViewOptions } from "../map/layers";
import { getMap } from "../map/mapRef";
import { systemBounds } from "@transitmapper/core/model/geo";
import type { LngLat, TransitSystem } from "@transitmapper/core/model/system";
import { legendEntriesFor, type LegendEntry } from "./exportLegend";

const INK = "#191a17";
const PAD = 20;
const TITLE_SIZE = 22;
const SWATCH = 14;
const ROW_H = 22;

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

function titleMarkup(title: string, width: number): string {
  if (!title.trim()) return "";
  // Rough width estimate (no DOM measurement available for a detached SVG
  // string) — generous enough that the backing panel never clips real titles.
  const w = Math.min(width, title.length * TITLE_SIZE * 0.62 + PAD * 2);
  return (
    `<rect x="0" y="0" width="${w.toFixed(0)}" height="${(TITLE_SIZE * 1.9).toFixed(0)}" fill="rgba(255,255,255,0.88)"/>` +
    `<text x="${PAD}" y="${(TITLE_SIZE * 1.15).toFixed(0)}" font-family="system-ui,sans-serif" font-size="${TITLE_SIZE}" font-weight="700" fill="${INK}">${escapeXml(title)}</text>`
  );
}

function legendMarkup(legend: LegendEntry[], width: number, height: number): string {
  if (legend.length === 0) return "";
  const panelH = legend.length * ROW_H + PAD;
  const maxChars = Math.max(...legend.map((e) => e.label.length));
  const panelW = Math.min(width, SWATCH + 10 + maxChars * 7.5 + PAD * 2);
  const top = height - panelH;
  const rows = legend
    .map((e, i) => {
      const y = top + PAD / 2 + i * ROW_H;
      return (
        `<rect x="${PAD}" y="${(y + (ROW_H - SWATCH) / 2).toFixed(1)}" width="${SWATCH}" height="${SWATCH}" fill="${e.color}"/>` +
        `<text x="${PAD + SWATCH + 10}" y="${(y + ROW_H / 2 + 4).toFixed(1)}" font-family="system-ui,sans-serif" font-size="13" font-weight="500" fill="${INK}">${escapeXml(e.label)}</text>`
      );
    })
    .join("");
  return `<rect x="0" y="${top.toFixed(1)}" width="${panelW.toFixed(0)}" height="${panelH}" fill="rgba(255,255,255,0.88)"/>${rows}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface SvgComposeOptions {
  title: string;
  legend: LegendEntry[];
}

/**
 * Vector export of the schematic: ways/services as paths, stations as
 * circles, facilities as colored dots (a simplified stand-in for their
 * on-map pictograms — PNG export is what captures full icon fidelity), plus
 * a title and line-color legend so the export reads as a finished map on its
 * own, not just an extracted line drawing. Projected through the *given*
 * map's own project() — pass the export dialog's own preview map instance
 * (already framed to the whole system) rather than always reading the live
 * app map, so the SVG matches whatever framing the user chose.
 */
export function svgMarkup(system: TransitSystem, view: ViewOptions, map: MLMap, opts: SvgComposeOptions): string {
  const container = map.getContainer();
  const width = container.clientWidth;
  const height = container.clientHeight;
  const project = (lnglat: LngLat) => map.project(lnglat as [number, number]);

  const selection: Selection = null;
  const fc = buildFeatures(system, selection, [], view);
  const parts: string[] = [];

  const pathD = (coords: LngLat[]) =>
    coords.map((c, i) => `${i === 0 ? "M" : "L"}${project(c).x.toFixed(1)},${project(c).y.toFixed(1)}`).join(" ");

  for (const f of fc.ways.features as Feature<LineString>[]) {
    const p = f.properties as { color: string; width: number; dashed?: boolean };
    parts.push(
      `<path d="${pathD(f.geometry.coordinates as LngLat[])}" fill="none" stroke="${p.color}" stroke-width="${p.width}" stroke-linecap="round" stroke-linejoin="round"${p.dashed ? ' stroke-dasharray="4,4"' : ""} opacity="0.85"/>`,
    );
  }
  for (const f of fc.services.features as Feature<LineString>[]) {
    const p = f.properties as { color: string; width: number; underground?: boolean };
    parts.push(
      `<path d="${pathD(f.geometry.coordinates as LngLat[])}" fill="none" stroke="${p.color}" stroke-width="${p.width}" stroke-linecap="round" stroke-linejoin="round"${p.underground ? ' stroke-dasharray="5,4"' : ""}/>`,
    );
  }
  for (const f of fc.stations.features as Feature<Point>[]) {
    const p = f.properties as { color: string; interchange?: boolean; name?: string };
    const { x, y } = project(f.geometry.coordinates as LngLat);
    const r = p.interchange ? 7 : 5;
    parts.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#ffffff" stroke="${p.interchange ? "#111827" : p.color}" stroke-width="3"/>`,
    );
    if (p.name) {
      parts.push(
        `<text x="${x.toFixed(1)}" y="${(y - r - 6).toFixed(1)}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="${p.interchange ? 700 : 500}" fill="${INK}">${escapeXml(p.name)}</text>`,
      );
    }
  }
  for (const f of fc.facilities.features as Feature<Point>[]) {
    const p = f.properties as { color: string; radius: number; name?: string };
    const { x, y } = project(f.geometry.coordinates as LngLat);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${p.radius}" fill="${p.color}" stroke="#ffffff" stroke-width="1.5"/>`);
    if (p.name) {
      parts.push(
        `<text x="${x.toFixed(1)}" y="${(y + p.radius + 13).toFixed(1)}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="${INK}">${escapeXml(p.name)}</text>`,
      );
    }
  }

  parts.push(titleMarkup(opts.title, width));
  parts.push(legendMarkup(opts.legend, width, height));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/>${parts.join("")}</svg>`;
}

/** Export from an already-framed map (e.g. the export dialog's own preview
 *  instance) — no bounds-fitting, whatever that map currently shows is what
 *  gets exported. */
export function exportSvgFromMap(system: TransitSystem, view: ViewOptions, map: MLMap, opts: SvgComposeOptions, filename = "transit-system.svg"): void {
  downloadBlob(new Blob([svgMarkup(system, view, map, opts)], { type: "image/svg+xml" }), filename);
}

/** Quick-export path: temporarily fit the live app map to the whole system's
 *  extent, export with title/legend, then restore the camera — mirrors
 *  exportFullSystemPng (see share/pngExport.ts). */
export function exportFullSystemSvg(system: TransitSystem, view: ViewOptions, filename = "transit-system.svg"): void {
  const map = getMap();
  if (!map) return;
  const prev = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  const bounds = systemBounds(system);
  if (bounds) map.fitBounds(bounds, { padding: 56, animate: false });
  map.once("idle", () => {
    exportSvgFromMap(system, view, map, { title: system.name || "Transit system", legend: legendEntriesFor(system, view) }, filename);
    map.jumpTo(prev);
  });
  map.triggerRepaint();
}
