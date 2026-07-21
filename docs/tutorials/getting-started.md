# Getting started

This tutorial takes you from an empty map to a small working system: a
street grid, a light rail line with stations, and a bus route running on
your streets. It should take about ten minutes.

You'll need the editor running (`npm run dev`, then open
`http://localhost:5173`). A fresh browser starts you with an empty system
framed on the Las Vegas Valley; pan and zoom anywhere you like — nothing is
tied to Las Vegas.

## 1. Learn the camera

The map never pans on a plain left-drag; the left button always belongs to
the active tool, like a map editor rather than a map viewer.

- Pan: right-drag, or hold space and drag.
- Zoom: scroll, or `Z`/`X`.

## 2. Build two streets

Switch to the **Infrastructure** view (top center). This view is the
physical world: what you draw here is bare infrastructure with real
dimensions, and no transit line is created by drawing it.

1. Click the **Road** tool (or press `R`).
2. In the options row above the dock, pick a cross-section from the
   **Cross-section** menu — "4-lane arterial" is a good start.
3. Click once to start the street, click again to place each bend, and
   press `Enter` (or double-click) to finish.
4. Draw a second road crossing the first.

Where the two roads cross, both split and a junction forms on its own. Zoom
in past street level and the roads become real lanes: asphalt, dashed lane
lines, a yellow center line, direction arrows, and a junction footprint at
the crossing.

Select a road (`V`, then click it) and look at the inspector on the right.
The **Lanes** tab is the cross-section editor: each card is a lane, in
order, at its real width. Try making the street one-way (`O`), flipping it
(`D`), or picking a different preset.

## 3. Lay a rail line

Still in the Infrastructure view:

1. Click the **Track** tool (or press `T`). The chevron on the button picks
   the track standard — heavy rail, light rail, or monorail.
2. Draw an alignment the same way you drew the roads.

Like the roads, this is bare infrastructure: track on the ground, no service
yet. Where it crosses your streets at grade, junctions form; set the track's
grade to Elevated in the options row first if you want it to fly over
instead.

## 4. Give the rail a station

1. Click the **Station** tool (or press `S`).
2. Drag a rectangle over the track. The rectangle becomes the station's
   land, anchored to the track it straddles, with corner handles to
   reshape.
3. With the station selected, use the inspector's **Physical** tab to add
   platforms, or pick Building or Bus bay from the **Facility** tool's menu
   and drag structures directly onto the station's land. Anything drawn on
   the land belongs to the station automatically.

Name the station in the inspector's header field.

## 5. Draw the line itself

Switch to the **Network** view. This is the schematic: you draw *services*
here — the colored lines people ride.

1. Click the **Line** tool. Its chevron picks the mode; choose Light rail.
2. Press on your track and click along it. Because you started on existing
   compatible infrastructure, the line *routes along it* through the
   junction graph instead of laying new geometry. Press `Enter` to finish.

The line appears in the left panel with a color and a name you can edit.
Stops you place with the Station tool in this view are schematic points
that snap onto the line.

## 6. Run a bus down your street

Still in the Network view:

1. Line tool again; pick Bus from the chevron.
2. Press on one of your streets and route along the grid, turning at the
   junction. `Enter` to finish.

You now have a system: streets and track in the Infrastructure view, a rail
line and a bus route in the Network view, and a station that exists in both
worlds — a dot on the schematic, a parcel of land with structures in the
physical view.

## Where to go next

- [Draw and edit roads](../how-to/draw-roads.md) for one-way couplets,
  medians, and street identities.
- [Work with intersections](../how-to/edit-intersections.md) for turn lanes.
- [Import streets from OpenStreetMap](../how-to/import-osm.md) to build over
  a real city instead of drawing every street.
- [Share and export](../how-to/share-and-export.md) when you want to show
  someone.
