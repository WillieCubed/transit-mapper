import { useEffect, useRef, useState } from "react";

// --- color math ---------------------------------------------------------
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function hsvToHex(h: number, s: number, v: number): string {
  return rgbToHex(...hsvToRgb(h, s, v));
}
export const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

interface ColorSpectrumProps {
  value: string;
  onChange: (hex: string) => void;
}

/** Saturation/value square + hue slider + hex input for arbitrary colors. */
export function ColorSpectrum({ value, onChange }: ColorSpectrumProps) {
  const [h, s, v] = rgbToHsv(...hexToRgb(HEX_RE.test(value) ? value : "#888888"));
  const [hue, setHue] = useState(h);
  const [hexDraft, setHexDraft] = useState(value.toUpperCase());
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  useEffect(() => setHexDraft(value.toUpperCase()), [value]);

  const dragSV = (clientX: number, clientY: number) => {
    const r = svRef.current!.getBoundingClientRect();
    onChange(hsvToHex(hue, clamp01((clientX - r.left) / r.width), 1 - clamp01((clientY - r.top) / r.height)));
  };
  const dragHue = (clientX: number) => {
    const r = hueRef.current!.getBoundingClientRect();
    const nh = clamp01((clientX - r.left) / r.width) * 360;
    setHue(nh);
    onChange(hsvToHex(nh, s || 1, v || 1));
  };
  const trackDrag = (move: (x: number, y: number) => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    move(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const commitHex = () => {
    if (HEX_RE.test(hexDraft)) onChange(hexDraft.startsWith("#") ? hexDraft : `#${hexDraft}`);
    else setHexDraft(value.toUpperCase());
  };

  return (
    <div className="cs-root">
      <div
        className="cs-sv"
        ref={svRef}
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hue} 100% 50%))` }}
        onPointerDown={trackDrag(dragSV)}
      >
        <span className="cs-sv-thumb" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: value }} />
      </div>
      <div className="cs-hue" ref={hueRef} onPointerDown={trackDrag((x) => dragHue(x))}>
        <span className="cs-hue-thumb" style={{ left: `${(hue / 360) * 100}%` }} />
      </div>
      <input
        className="cs-hex"
        value={hexDraft}
        spellCheck={false}
        aria-label="Hex color"
        onChange={(e) => setHexDraft(e.target.value)}
        onBlur={commitHex}
        onKeyDown={(e) => e.key === "Enter" && commitHex()}
      />
    </div>
  );
}
