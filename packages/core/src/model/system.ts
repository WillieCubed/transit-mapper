// Barrel: this file split into system/ (one file per entity category) once
// it grew to 27 types/interfaces with no per-entity organization. Every
// existing named export is re-exported unchanged from its new home, so no
// import path anywhere in the monorepo needs to change. The domain framing
// this file used to open with lives on as this comment's own opening line:
// a System is one *document* — a regional, multimodal network — separating
// INFRASTRUCTURE (Way) from SERVICE (Service); kinds (way types, modes,
// grades, facility classes) live in catalog.ts.
export * from "./system/valueTypes";
export * from "./system/way";
export * from "./system/node";
export * from "./system/namedWay";
export * from "./system/service";
export * from "./system/station";
export * from "./system/facility";
export * from "./system/group";
export * from "./system/document";
