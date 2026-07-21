# TransitMapper documentation

> TransitMapper is a work in progress. These docs track the editor as it
> exists today; where a feature is planned but not built, the docs say so.

The documentation follows the [Diátaxis](https://diataxis.fr/) framework:
tutorials teach, how-to guides solve, reference informs, explanation
deepens.

## Tutorials

- [Getting started](tutorials/getting-started.md) — from an empty map to a
  small working system: streets, a rail line, stations, and a bus route.

## How-to guides

- [Draw and edit roads](how-to/draw-roads.md) — presets, lanes, one-way
  streets, divided carriageways, street names.
- [Work with intersections](how-to/edit-intersections.md) — automatic
  junctions, turn lanes, signals, grade separation.
- [Design stations](how-to/design-stations.md) — station land, buildings,
  platforms, bus bays, complexes.
- [Route services over infrastructure](how-to/route-services.md) —
  snap-to-streets drawing, adopting existing ways under a sketch.
- [Import streets from OpenStreetMap](how-to/import-osm.md).
- [Share and export](how-to/share-and-export.md) — read-only links, forking,
  PNG export.

## Reference

- [Data model](reference/data-model.md) — every record in a saved system.
- [Catalogs](reference/catalogs.md) — way types, modes, lane kinds,
  facility types, presets, and how to extend them.
- [Keyboard shortcuts](reference/keyboard-shortcuts.md).
- [Project structure](reference/project-structure.md) — what lives where in
  the source tree.

## Explanation

- [The three views](explanation/views.md) — Network, Infrastructure,
  Diagram, and why "the Infrastructure view is 2D" is a hard rule.
- [Design principles](explanation/design-principles.md) — catalog-driven
  kinds, style/domain separation, menus versus modes.
- [Geometry and routing](explanation/geometry-and-routing.md) — how lane
  offsets, junction footprints, and the route graph are derived.

Design documents for larger pieces of work live in
[`superpowers/specs/`](superpowers/specs/).
