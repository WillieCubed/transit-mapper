# Route services over infrastructure

TransitMapper supports two workflows and a bridge between them:

- **Infrastructure-first**: draw streets and track, then run services over
  them.
- **Sketch-first**: draw service lines freehand in the Network view, then
  attach real infrastructure underneath later.

## Run a service over existing ways

In the **Network** view, start drawing a line (the way-drawing tool with a
service-compatible mode selected) and begin **on existing infrastructure** —
press within snapping distance of a way the mode can use (bus on roads, light
rail on light-rail track or streets, and so on; compatibility comes from the
mode catalog).

Instead of laying new geometry, each click extends a *route* through the
network: the editor finds a path from your last point to the click through
the junction graph, previews it, and follows the streets around corners. You
only click at meaningful places — where the route turns, roughly one click
per turn. `Enter` or double-click commits the whole thing as a new service;
`Esc` abandons it.

Clicks in the middle of a block are fine: the route can enter and leave a
way mid-segment, not only at junctions.

If you start a line on empty ground instead, you get the freehand sketch
behavior — new geometry with a service on it, the classic sketching flow.

## Adopt infrastructure under a sketched line

The bridge in the other direction. Say you sketched a bus line freehand
months ago, and have since imported or drawn the real street grid under it:

1. Select the sketched service.
2. Open the inspector's **Route** tab.
3. Click **Adopt existing infrastructure**.

The editor re-routes the service through the real network, using the sketch
as a corridor bias so the adopted route follows the streets nearest your
original drawing. Stops re-anchor onto the adopted ways, and the now-orphaned
sketch geometry (unnamed, hand-drawn, serving nothing else) is cleaned up.

Adoption only considers way types the service's mode can run on, and it
leaves shared or named ways alone.

## Direction and one-way streets

Routing treats ways as traversable in both directions for now;
direction-aware routing that respects one-way profiles is on the roadmap
(the lane model already stores everything it needs). One-way ways a service
runs over display travel-direction chevrons in the Network view, so couplet
routings read correctly even before the router enforces them.
