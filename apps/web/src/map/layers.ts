// Barrel: this file split into layers/ (shared SRC_*/LYR_* constants, the
// system-to-GeoJSON projector, the MapLibre layer paint specs, and icon
// registration) once it grew past four genuinely separate concerns living in
// one 982-line file. Every existing named export is re-exported unchanged
// from its new home, so no import path anywhere in the app needed to change.
export * from "./layers/constants";
export * from "./layers/icons";
export * from "./layers/buildFeatures";
export * from "./layers/layerSpecs";
