import type { CSSProperties } from "react";

// Minimal inline-SVG icon set (stroke-based, 24x24) so we avoid an icon-font
// dependency. Inherits color via currentColor. Exported: map/icons.ts
// rasterizes these same paths for on-map pictograms (facility types, etc.) —
// one icon vocabulary for both the React UI and the map canvas.
export const PATHS: Record<string, string> = {
  cursor: "M4 3l7 17 2.5-7L21 10.5 4 3z",
  line: "M6 18a3 3 0 100-6 3 3 0 000 6zM18 9a3 3 0 100-6 3 3 0 000 6zM8 15l8-6",
  station: "M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 1 0 0-15z",
  road: "M4 20l4-16M20 20l-4-16M12 5v2M12 11v2M12 17v2",
  pan: "M8 13V6a1.5 1.5 0 013 0V6a1.5 1.5 0 013 0v1a1.5 1.5 0 013 0v5a6 6 0 01-6 6h-1a5 5 0 01-4-2l-3-4a1.5 1.5 0 012.4-1.8L8 13z",
  share: "M6 12a3 3 0 100 .01M18 6a3 3 0 100 .01M18 18a3 3 0 100 .01M8.5 10.5l7-3.5M8.5 13.5l7 3.5",
  download: "M12 4v10m0 0l-4-4m4 4l4-4M5 19h14",
  plus: "M12 5v14M5 12h14",
  trash: "M5 7h14M9 7V5h6v2M6 7l1 13h10l1-13",
  x: "M6 6l12 12M18 6L6 18",
  copy: "M9 9h10v10H9zM5 15V5h10",
  file: "M7 3h7l4 4v14H7zM14 3v4h4",
  geoStraight: "M5 19L19 5",
  geoCurved: "M4 17C8 17 8 7 12 7s4 10 8 10",
  geoFreeform: "M4 15c2-6 4 2 6-2s3-6 5-2 3 8 5 4",
  keyboard: "M3 7h18v10H3zM6.5 10.5h1M10.5 10.5h1M14.5 10.5h1M8 14h8",
  chevronDown: "M6 9l6 6 6-6",
  check: "M5 13l4 4L19 7",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5",
  undo: "M9 14L4 9l5-5M20 20v-7a4 4 0 00-4-4H4",
  redo: "M15 14l5-5-5-5M4 20v-7a4 4 0 014-4h12",
  sidebar: "M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM9 5v14",
  door: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  bike: "M5.5 17.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM18.5 17.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM12 17.5l2-8h4M9 9.5h3l3 4",
  elevator: "M4 3h16v18H4zM12 8l2.5 2.5M12 8l-2.5 2.5M12 16l2.5-2.5M12 16l-2.5-2.5",
  parking: "M7 3v18M7 3h6a4 4 0 010 8H7",
  depot: "M4 21V9l8-6 8 6v12M9 21v-6h6v6M4 21h16",
  bus: "M4 16V6a2 2 0 012-2h12a2 2 0 012 2v10M4 16a1 1 0 001 1h1.5a1 1 0 001-1M4 16h16m0 0a1 1 0 01-1 1h-1.5a1 1 0 01-1-1M7 6h10",
  platform: "M3 18h18M6 18v-7a1 1 0 011-1h10a1 1 0 011 1v7M9 10V6M15 10V6",
  square: "M5 5h14v14H5z",
  warning: "M12 3l9.5 17H2.5L12 3zM12 9.5v4.2M12 17v.01",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3.5 2",
};

interface IconProps {
  name: keyof typeof PATHS | string;
  size?: number;
  style?: CSSProperties;
}

export function Icon({ name, size = 20, style }: IconProps) {
  const d = PATHS[name] ?? "";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={d} />
    </svg>
  );
}
