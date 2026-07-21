# Geometry and routing

How TransitMapper turns a small stored model — points, profiles, junctions —
into street-level geometry and routable networks. Everything on this page is
derived at render or query time; none of it is saved.

## From centerline to lanes

A way stores only a centerline and a cross-section (an ordered lane list
with widths). `src/geometry/streets.ts` derives the rest: each lane's
polyline is the centerline offset sideways by the running sum of lane widths
(miter-joined, clamped at sharp angles), which yields lane surfaces,
divider lines between them (dashed between same-direction lanes, the yellow
center line between opposing ones, edge lines at the border), and direction
arrows along travel lanes.

The lane-list convention follows osm2streets: left-to-right as seen facing
the way's forward direction. Adopting an existing convention meant lane
ordering, flipping, and one-way logic had prior art to check against.

This detail is expensive at scale, so it's gated: lane geometry is derived
only in the Infrastructure view, above a zoom threshold, for ways
intersecting the viewport — and memoized per way, so a drag invalidates one
way rather than the world. Below the threshold, ways render as the cheap
lines the Network view always uses.

## Junction footprints

Where ways meet at a node, drawing every way at full width would overlap
messily. `src/geometry/junctions.ts` computes, per arm, how far to trim the
way back: sort the arms around the junction, intersect each arm's edge line
with its neighbor's, and trim to the farthest intersection (capped so a
tiny side street can't consume a long block). The trimmed arm ends are then
connected into the junction's surface polygon. Two collinear arms — a
segment boundary, not a real junction — get no polygon at all.

Trim distances feed back into lane derivation, so lanes visibly stop at the
junction edge. This trim-back approach follows the intersection algorithm
A/B Street documented for osm2streets.

## The lane-connectivity graph

A junction also carries meaning: which incoming lane may continue into
which outgoing lane. Defaults are derived by heuristic (through lanes pair
up index-aligned from the right; the leftmost approach lane may also turn
left, the rightmost also right; no U-turns), and the turn-lane editor
stores explicit connectors only once a junction is customized. Turn arrows
and the guide curves through the junction are both derived from connectors
— stored turn arrows could contradict the graph; derived ones can't. The
graph is also the foundation for future lane-level routing and simulation.

## Routing

Service drawing and infrastructure adoption both ride
`src/model/routeGraph.ts`. The graph's vertices are junction nodes and way
endpoints; its edges are the way segments between them, weighted by length
and filtered to way types the service's mode can use. Path-finding is
Dijkstra's algorithm, with two refinements:

- **Mid-way anchors.** A click in the middle of a block shouldn't force
  the route to the nearest junction. The clicked point becomes a temporary
  vertex on that way, connected to the way's real vertices, so routes can
  begin and end anywhere along a way.
- **Corridor bias.** Adoption re-routes a service near its original
  sketch by discounting edges close to the sketched path, so among many
  plausible street routings the one following the user's drawing wins.

Committing a route *materializes* it: anchors that fall mid-way become real
control points, ways are split there, and the service's patterns list the
resulting ways in travel order. Materializing rather than storing fractional
positions keeps the service model uniform — a routed service and a sketched
one are the same shape.

Routing currently treats ways as bidirectional; honoring one-way profiles
is the natural next step, since the profile already encodes direction.
