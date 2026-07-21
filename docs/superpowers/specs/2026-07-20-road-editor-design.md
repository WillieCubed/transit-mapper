# Road Editor: Lane-Level Cross-Sections, Geometric Intersections & Shared Identity

## Context

TransitMapper's unified `Way` model treats roads as first-class infrastructure, but a road today is just a centerline with a scalar `capacity` fanned into identical parallel lines. The user wants a SimCity/Cities: Skylines-grade road editor: drag roads with the existing tools, customize lanes (count, width, kind, direction), get **real geometric intersections** automatically when roads cross, edit turn lanes per junction, model medians and paired one-way carriageways that share one identity ("Decatur Avenue"), and support pedestrian-only lanes/paths — all turnkey via GUI with optional keyboard shortcuts.

Decisions made in brainstorming (all user-confirmed):
- **Full geometric intersections** (trimmed carriageways, junction polygons, corner fillets, lane connector curves) — not schematic-only.
- **Real lane-connectivity graph** (incoming lane → outgoing lane per junction) so future routing/simulation gets the graph for free.
- **Generalized to ALL way types** — cross-section profiles replace scalar capacity for rail/bike/etc. too (tracks are a lane kind). No road-only parallel system; catalog-driven, no hardcoded kinds (standing non-negotiable).
- **Roll our own pure-TS geometry engine**; osm2streets researched and rejected as a dependency (OSM-XML batch converter, fights interactive editing) but its left-to-right lane-list schema convention and A/B Street's published intersection algorithm are adopted as reference. Optional future: osm2streets-js to enrich OSM imports.
- Shared-identity entity is **`NamedWay`** (neutral internal name); the way-type family in the catalog supplies the user-facing noun ("Street" / "Line" / "Trail"). "Corridor" rejected as planning-jargon.

## Data model (src/model/)

All pure domain data; style stays in `src/style/catalogStyle.ts` per the enforced boundary.

**catalog.ts additions:**
- `LaneKindDef { id, label, role: "travel"|"separator"|"edge", defaultWidthM, widthPresetsM }`; `LANE_KINDS`: drive, bus, bike, parking, turnPocket, median, sidewalk, shoulder, track, platform, …
- Each `WayType` declares allowed lane kinds + default profile. Pedestrian-only path = a way type whose default profile is one sidewalk lane (no special casing).
- `ProfilePreset { id, label, wayTypeId, classId?, lanes }` — e.g. "2-lane local", "4-lane arterial", "Divided boulevard", "5-lane w/ center turn".
- Way-type family gains a display noun for identities ("Street"/"Line"/"Trail").

**system.ts:**
```ts
interface LaneSpec { id: string; kindId: string; widthM: number;
  direction: "forward"|"backward"|"both"|"none" }   // relative to point order
interface CrossSection { lanes: LaneSpec[] }         // left-to-right facing forward (osm2streets convention)
// Way: + profile: CrossSection; capacity becomes DERIVED (count of travel lanes)
interface LaneConnector { from: {wayId, laneId}; to: {wayId, laneId} }
// Node: + connectors?: LaneConnector[]  (auto-derived by heuristic; stored only once user customizes)
//       + control?: "uncontrolled"|"signal"|"stop"|"roundabout"
interface NamedWay { id: string; name: string; wayIds: string[] }
```
- Profile is **constant per Way**; cross-section changes (turn pocket appears, lane drop) = split the way (`splitWayAt` exists); pieces keep identity via `NamedWay`.
- Widths stored meters, displayed feet (Vegas presets 10/11/12 ft).
- Turn arrows are derived from connectors, never stored separately.

**serialize.ts:** bump to v6; migrate capacity+classId → default profiles for every way type (rail included). Round-trip tests on v3–v5 fixtures so saved systems and D1 snapshots load unchanged.

**store.ts new actions:** profile edits (set/add/remove/reorder/flip lane, apply preset), `setNodeControl`, `setLaneConnectors`, `formCrossingJunctions`, `separateCarriageways(wayId)`, `combineCarriageways(namedWayId)`, `mergeWays` (missing inverse of `splitWayAt`), NamedWay CRUD. Keep helpers in sync: `cascadeMove`, node-ref shifting, `reanchorStations`, undo checkpoints.

## Geometry engine (new src/geometry/, pure & network-free)

Derives drawable geometry from the model on demand; never mutates it. Memoized via `WeakMap` on immutable objects like `resolveWayPath`. Four staged pure functions + orchestrator `deriveStreetGeometry(system, bbox)`:
1. `laneOffsets(way)` — signed per-lane offset polylines from cumulative widths; carriageway edge polylines. Local-meter math via existing `geo.ts` mercator helpers.
2. `junctionFootprint(node, ways)` — A/B Street algorithm: thicken incident ways, intersect adjacent edge lines for per-way **trim-back distances**, connect trim points with corner fillets. Explicit fallbacks for degenerate cases (2-way pass-through, acute angles, overlap). Densest unit tests in the repo (T, 4-way, 5-way, acute).
3. `connectorCurves(node)` — cubic Béziers between trimmed lane endpoints per lane connector (stored or heuristic default); rendered as junction lane guides; future routing edges.
4. `markings(way, node)` — dividers (dashed same-direction, double-solid between directions), turn arrows from connectors, crosswalks where sidewalk lanes meet junctions, median fills.
Trim distances from stage 2 feed stage 1 (carriageways shorten at junctions).

**Performance (user-probed, approved):** zoom-gated LOD (lane geometry only ≥ ~z15–16; below, today's cheap line rendering — whole-valley view never derives lanes); viewport-scoped derivation over a new grid spatial index (shared with the snap engine, currently a linear scan); per-way/per-node memoization (a drag invalidates 1 way + ≤2 nodes); split MapLibre sources — static derived geometry rebuilt on commit/viewport change vs a small scratch source for the actively-dragged way updated via existing `rafThrottle`. Escape hatch: module is pure → Web Worker move is mechanical. Add a `verify.ts` perf budget check.

## Rendering (src/map/layers.ts + src/style/catalogStyle.ts)

- Promote `emitCrossSection` (currently a scalar-fan closure in `buildFeatures`, layers.ts:150–174) to consume derived per-lane geometry; junction polygons, lane fills, markings, connector guides as new sources/layers, **Infrastructure view only**; Network view unchanged.
- All colors/widths/dashes in `catalogStyle.ts` (style boundary; per-lane-kind styling).
- Street name labels along NamedWays at high zoom.
- Junction footprints hit-testable/selectable.

## Editing UX

- **Drawing unchanged & unified** — roads draw via the existing `startDraw` path; the draft panel gains catalog-driven profile preset chips. Turnkey = pick preset, drag.
- **Auto-intersection on crossing:** on way commit / endpoint drag-release, `formCrossingJunctions` splits both ways at same-grade crossings (`segmentsCross` in validate.ts finds them; `splitWayAt` + node linking) and derives default connectors. Grade-aware: elevated over surface = overpass, NO junction. One undo checkpoint.
- **Cross-section editor** in `WayInspector` (Inspector.tsx): horizontal lane-card strip mirroring the street left-to-right; per-card kind picker (allowed kinds from catalog), width preset chips (ft), direction toggle; add/remove/reorder/mirror/flip; one-way ⇄ two-way toggle. The strip doubles as the live cross-section preview.
- **Junction editor:** new `NodeInspector` on footprint selection — control type; per-approach lane list with toggleable turn arrows (←↑→) that edit real connectors; map redraws connector guides live.
- **Identity:** name field on `WayInspector` creates/joins a `NamedWay` (label from family noun); "Separate carriageways" (two-way profile → two one-way ways around a median, same NamedWay) / "Combine carriageways"; `mergeWays` for end-to-end joins.
- **Keyboard** (declarative keymap.ts additions, all optional-secondary): `[`/`]` lane count, `D` flip direction, `O` one-way, `1–9` presets while drawing.

## Phasing (each shippable + browser-verified)

- **R1 — Model & migration:** catalogs, CrossSection, NamedWay, Node connectors/control, v6 migration, store actions, verify.ts coverage. No visual change beyond nothing breaking.
- **R2 — Lanes visible & editable:** geometry stage 1 + markings, LOD, spatial index, source split; lane-card editor; preset chips. Multi-lane roads drawable and fully customizable.
- **R3 — Real intersections:** junction footprints + trim-back, auto-intersection on crossing, connector curves, NodeInspector turn-lane editor. The Cities: Skylines payoff.
- **R4 — Identity & carriageways:** NamedWay + labels, separate/combine, mergeWays, keyboard shortcuts.
- (Future, out of scope: routing/simulation over the lane graph; osm2streets-js import enrichment.)

## Critical files

Modify: `src/model/catalog.ts`, `src/model/system.ts`, `src/model/serialize.ts`, `src/model/geo.ts` (spatial index), `src/model/validate.ts` (crossing reuse), `src/editor/store.ts`, `src/editor/keymap.ts`, `src/map/layers.ts`, `src/map/interactions.ts`, `src/ui/Inspector.tsx` (+ new `NodeInspector`), `src/style/catalogStyle.ts`.
New: `src/geometry/` (offsets, junction, connectors, markings, orchestrator + tests).

Reuse (do not reinvent): `splitWayAt`, `joinWayPointToWay`, `cascadeMove`, node-ref sync helpers, `snap`/`nearestOpenEndpoint`, `resolveWayPath`/`roundedCorners`, `segmentsCross`, `rafThrottle`, undo checkpoint wrappers, chip/stepper UI patterns in Inspector.

Standing constraints honored: no hardcoded kinds (all catalogs); style/domain separation; no inline typedefs (named interfaces); zustand selector stability gotcha; monochrome chrome (lane/junction rendering is infrastructure ink, not UI accent color); Escape cancels in-flight gestures (new drags must register with `cancelActiveGesture`).

## Verification

- `verify.ts` unit suites per pure module: profile ops, migration round-trips (v3–v5 fixtures), junction trim-back matrix (2-way/T/4-way/5-way/acute), connector heuristics, perf budget (derive a few-hundred-way viewport under budget).
- Browser (per transitmapper-verification-notes: pump 1–2 screenshots first, resize before fitBounds): draw two crossing arterials → junction forms with footprint; edit lanes in the strip → map updates; toggle turn arrows → connector guides change; separate Decatur into carriageways → two one-way ways, one label; zoom out → LOD collapses to lines; undo/redo and Escape-cancel across all new gestures; existing saves load (v6 migration).
- On completion, invoke superpowers:writing-plans conventions already satisfied by this plan; commit only when asked (ASCII-cow rule applies).

## First implementation step

Commit this design as `docs/superpowers/specs/2026-07-20-road-editor-design.md` (per brainstorming skill; deferred from plan mode), then begin R1.
