# Design stations

A station means different things in different views. In the Network view it's
a stop: a point on a line. In the Infrastructure view it's a place: land with
a boundary, and structures on that land. Both are the same station record.

## Draw station land (Infrastructure view)

With the **Station** tool (`S`):

- **Drag** a rectangle where the station goes, or
- **click** corner points one at a time and finish with `Enter` or
  double-click (`Esc` cancels).

The boundary you draw *is* the station — its primary identity in the physical
world. The station anchors itself to the nearest way inside or near the
boundary, so its Network-view stop lands on the line it serves. Reshape the
land later by selecting the station and dragging its corner handles.

There is no click-to-place-a-point in this view: the Infrastructure view
is 2D, and everything drawn there has physical extent.

## Add structures on the land

The **Facility** tool's (`F`) menu is organized by what the thing physically
is:

- **Access points (placed)** — entrance, elevator, bike dock. These are
  points in the real world too; click to place.
- **Structures (drawn to shape)** — building, bus bay, platform, parking,
  depot. Drag to draw their footprint.
- **Site boundary** — draw the outline of a standalone facility complex
  (a transit center that isn't a rail station, say).

Anything you draw inside a station's land joins that station automatically:
a building becomes the station's building, a bus bay its bus bay. The
inspector's **Complex** tab lists everything the station owns.

Platforms can also be added from the station inspector's **Physical** tab,
which places them along the anchored way.

## Stops in the Network view

In the Network view the Station tool places schematic stops: click on or near
a line and the stop snaps to it. Stops placed here have no land until you
switch to the Infrastructure view and draw some; the two representations stay
linked through the one station record.

## Station complexes

Draw a **Site boundary** (Facility tool) around several related things — a
terminal building, bus bays, an adjacent station — and they group into one
complex with its own name and color. Use this for transfer centers and
intermodal terminals where several stations and structures form one real
place.
