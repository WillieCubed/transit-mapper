# Project structure

TransitMapper is a Vite + React + TypeScript single-page app with an
optional Cloudflare Worker backend for sharing. The layering rule that
organizes everything: **model → store → rendering/UI**, with purity
increasing toward the model.

```
src/
  model/       Pure domain: types, catalogs, geometry math, routing. No DOM,
               no network (import.ts's one fetch excepted), no store access.
  geometry/    Pure derived geometry: lane offsets, junction footprints.
  editor/      The zustand store (all mutation) and the keyboard system.
  map/         MapLibre integration: layers, pointer interactions, canvas.
  ui/          React components. Thin: read the store, call actions.
  style/       How catalog kinds LOOK (colors, widths, dashes, icons).
  share/       Export (PNG/SVG/JSON) and the share-API client.
  storage/     Local persistence.
scripts/       verify.ts — the test suite.
worker/        Cloudflare Worker + D1 migrations for shared snapshots.
docs/          This documentation.
```

## src/model/ — the domain

- `system.ts` — every record in a saved document ([Data model](data-model.md)).
- `catalog.ts` — every kind ([Catalogs](catalogs.md)).
- `profile.ts` — pure cross-section operations: build/flip/one-way/derive
  capacity, separate/combine carriageway profiles.
- `geo.ts` — geographic math: projections, distances, polyline offsetting,
  point-in-polygon.
- `routeGraph.ts` — the routing graph over ways and junctions;
  `routeBetween` finds paths for service drawing and adoption.
- `validate.ts` — system-level checks (crossings, dangling refs) surfaced in
  the Issues popover.
- `serialize.ts` — versioned save/load with migrations (v3 → current).
- `import.ts` — OpenStreetMap import: pure tag classification plus the one
  Overpass fetch.
- `diagramLayout.ts` — the Diagram view's schematic layout.
- `cost.ts` — rough cost estimation.
- `ids.ts` — id generation.

## src/geometry/ — derived street geometry

- `streets.ts` — per-lane polylines, divider lines, and direction arrows
  derived from a way's profile; trimming at junctions.
- `junctions.ts` — junction footprints (arm trim-back, corner geometry),
  default lane connectors, connector curves.

Both are pure and memoized; nothing here is stored. See
[Geometry and routing](../explanation/geometry-and-routing.md).

## src/editor/ — mutation and input

- `store.ts` — the single zustand store. Every change to the system goes
  through an action here; undo checkpoints, junction bookkeeping, station
  re-anchoring, and NamedWay upkeep all live in the actions.
- `keymap.ts` — the declarative keyboard table
  ([Keyboard shortcuts](keyboard-shortcuts.md)).

## src/map/ — MapLibre

- `layers.ts` — turns the system into GeoJSON sources and layers per view;
  owns paint order (street surfaces below footprints, labels on top).
- `interactions.ts` — the pointer state machine: drawing, dragging,
  snapping, route drafting, station-land drawing.
- `MapCanvas.tsx` — the map component; keeps sources in sync with the store
  and heals overlay layers if the style reloads.
- `vehicles.ts` — the ambient vehicle animation.
- `basemap.ts`, `icons.ts`, `mapRef.ts`, `selectionFocus.ts` — supporting
  pieces.

## src/ui/ — components

`Workbench.tsx` is the shell that arranges everything; `Toolbar.tsx` is the
bottom dock; `Inspector.tsx` (with `NodeInspector.tsx`,
`CrossSectionEditor.tsx`, `InspectorTabs.tsx`) is the right-hand panel;
plus dialogs (export, import, share, schedule, systems) and primitives
(popover, modal, dropdown). Components hold no domain logic.

## Testing

`npm run verify` runs `scripts/verify.ts`: hundreds of deterministic checks
over the model, profile operations, migrations, junction geometry, routing,
store actions, and layer emission — no browser required. `npm run typecheck`
covers both the app and the worker. Both must pass before a PR.
