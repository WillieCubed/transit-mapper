# The three views

TransitMapper's core idea is that one system deserves more than one
representation. The same document renders three ways:

- **Network** — the schematic. Colored service lines, point stops, one-way
  chevrons. This is the transit map as riders think of it, and the view
  where you draw and route *services*.
- **Infrastructure** — the physical world. Roads with lanes, tracks,
  junction footprints, station land, buildings. This is where you draw and
  edit *infrastructure*.
- **Diagram** — a read-only straightened diagram of the network, in the
  tradition of printed transit maps.

The unifying principle: **a unified model that can represent complex
physical infrastructure as a simple network**. In one document a divided
six-lane boulevard is simultaneously "the red line goes down Decatur" and
two one-way carriageways with specific lanes, medians, and signalized
junctions. Neither view is a simplification of the other; they're
projections of the same data, and details like one-way direction surface
in both (chevrons in Network, lane arrows in Infrastructure).

## Why the Infrastructure view is 2D

This rule does real work: **everything drawn in the Infrastructure view
has physical extent.** Ways have cross-sections with real widths. Stations
are land; the boundary you draw defines the station's identity in this
view. Buildings and bus bays are shapes on that land.

The rule exists because point placement in a physical view lies. A station
dot on an infrastructure map defers every real question — where the
platforms are, how big the site is, what it displaces — and those questions
are the point of an infrastructure view. Abstraction to a point is the
Network view's job. So the Station tool draws land in
Infrastructure and places stops in Network, and genuinely point-like things
(an entrance, an elevator) are the only facilities placed as points.

## Why drawing infrastructure never creates a service

Roads exist independently of buses. When drawing a road also spawned a
service, the model claimed every street was a transit line, and the UI had
to ask about frequencies while you were laying asphalt. So the views'
responsibilities are strict: Infrastructure produces ways, Network produces
services over ways. The bridge between them is explicit and two-directional
— route a service over existing infrastructure, or adopt real infrastructure
under a sketched line — rather than an implicit side effect of drawing.

## Sketch-first and infrastructure-first are both real workflows

Some people start with a fantasy network map and only later care about
streets; some start by importing a real city and running service over it.
The two bridges exist so neither workflow is a dead end: a freehand sketch
can adopt real streets later, and real streets can carry a routed service
from the first click.
