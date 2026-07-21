# TransitMapper

Design regional transit systems on a real map. Sketch lines the way you'd
sketch them on a napkin, then build out the physical network underneath:
streets with lanes and turn pockets, rail with real track counts,
intersections that form themselves, stations with land and structures.

TransitMapper started as a tool for [Las Vegans for Transit](https://lasvegansfortransit.org)
to model a better transit future for the Las Vegas Valley, but nothing in it
is specific to one city. The map is the canvas; the transit system is
the document.

> **Status: work in progress.** The editor is usable and changing fast.
> Expect rough edges, schema migrations (old saves migrate automatically),
> and missing features. See [Roadmap](#roadmap).

## What it does

- **Two levels of detail, one model.** The Network view is the clean
  schematic: colored lines, stops, interchanges. The Infrastructure view is
  the physical world: lane-by-lane cross-sections, junction footprints, turn
  lanes, station land. Both views render the same objects at different
  levels of meaning.
- **Roads and rail as first-class infrastructure.** Every way carries a
  cross-section profile: drive lanes, bus lanes, bike lanes, sidewalks,
  medians, tracks. Widths are real meters. One-way streets, divided
  boulevards with paired carriageways under a single street name, center
  turn lanes, and pedestrian-only paths are all representable.
- **Intersections that build themselves.** Draw one road across another and
  both split at the crossing, a junction forms with a computed footprint,
  and default turn-lane connectors appear. Elevated over surface stays an
  overpass. Click a junction to edit turn lanes per lane.
- **Stations are places, not dots.** In the Infrastructure view you draw a
  station's land; its border is the station. Buildings, platforms, and bus
  bays are drawn structures on that land and attach to the station
  automatically.
- **Services ride infrastructure.** Draw a line in the Network view and it
  can route along existing streets and track through real junctions, or
  sketch it free and adopt the built network later. Many services can share
  one way.
- **Import the real world.** Pull streets from OpenStreetMap for the current
  viewport and draw your system over them.
- **Local-first, shareable.** Everything autosaves in your browser. Share
  publishes a read-only snapshot at a link; anyone can fork it and keep
  editing their own copy.

## Quick start

```sh
npm install
npm run dev        # editor at http://localhost:5173
```

Other commands:

```sh
npm run verify     # run the test suite (scripts/verify.ts)
npm run typecheck  # TypeScript, app + worker
npm run build      # production build
```

The share/fork backend is a Cloudflare Worker with D1 (`npm run worker:dev`),
but the editor runs fully without it.

## Documentation

Docs live in [`docs/`](docs/README.md), organized by the
[Diátaxis](https://diataxis.fr/) framework:

- [Getting started tutorial](docs/tutorials/getting-started.md) — build your
  first system in ten minutes.
- [How-to guides](docs/README.md#how-to-guides) — draw roads, design
  stations, route services, import OSM data.
- [Reference](docs/README.md#reference) — the data model, catalogs,
  keyboard shortcuts, project structure.
- [Explanation](docs/README.md#explanation) — why the editor works the way
  it does: the three views, the design principles, the geometry engine.

## Roadmap

Near-term direction, in rough order:

1. Direction-aware routing (services respect one-way lanes).
2. Rounded curb returns and painted approach arrows at junctions.
3. OSM import enrichment: real lane counts and turn tags from map data.
4. Analysis: ridership sketching, travel-time comparisons.
5. Accounts and collaboration.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
conventions, and what makes a good change here. The short version: the
catalogs are data, the model stays pure, and every behavior change comes
with a check in `scripts/verify.ts`.

## License

[MIT](LICENSE).
