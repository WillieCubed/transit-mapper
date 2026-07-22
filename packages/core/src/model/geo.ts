// Barrel: this file split into geo/ (great-circle math, planar offset/
// projection, way-path resolution, path measurement, Service/Pattern-aware
// helpers, the spatial-grid snap engine, and system bounds) once it grew past
// six genuinely unrelated concerns. Every existing named export is
// re-exported unchanged from its new home, so no import path anywhere in the
// monorepo needs to change.
export * from "./geo/spherical";
export * from "./geo/planar";
export * from "./geo/wayPath";
export * from "./geo/measurement";
export * from "./geo/servicePaths";
export * from "./geo/snapIndex";
export * from "./geo/bounds";
