import type { Map as MLMap } from "maplibre-gl";
import { PATHS } from "../ui/Icon";

// On-map pictograms, rasterized at runtime from the same 24x24 stroke-path
// vocabulary the React UI's <Icon/> uses (see ui/Icon.tsx) — one icon set,
// not two to keep in sync. Regular (non-SDF) images: color is baked in per
// registered image rather than tinted via icon-color, since every caller here
// wants a fixed catalog color, not a per-feature one.
const ICON_PX = 48; // registered image resolution; icon-size scales it down/up

function rasterize(pathD: string, color: string, fill: boolean): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(ICON_PX / 24, ICON_PX / 24);
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const path = new Path2D(pathD);
  if (fill) {
    ctx.fillStyle = color;
    ctx.fill(path);
  } else {
    ctx.strokeStyle = color;
    ctx.stroke(path);
  }
  return ctx.getImageData(0, 0, ICON_PX, ICON_PX).data;
}

/** Deterministic registered-image name for a (glyph, color) pair. */
export function iconName(pathKey: string, color: string): string {
  return `tm-icon-${pathKey}-${color}`;
}

export interface EnsureIconOptions {
  fill?: boolean;
}

/** Registers an icon image once per (glyph, color) pair; safe to call
 *  repeatedly (e.g. once per feature build) — a no-op once registered. */
export function ensureIcon(map: MLMap, pathKey: string, color: string, opts?: EnsureIconOptions): string {
  const name = iconName(pathKey, color);
  if (!map.hasImage(name)) {
    const d = PATHS[pathKey];
    if (d) map.addImage(name, { width: ICON_PX, height: ICON_PX, data: rasterize(d, color, opts?.fill ?? false) });
  }
  return name;
}
