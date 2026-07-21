# Work with intersections

Junctions form and maintain themselves; your job is deciding what they mean.

## How junctions form

- Finish drawing a way across another way of the same grade and both split
  at the crossing; the shared point becomes a junction with four arms.
- Dragging a way's endpoint across other ways on release does the same.
- Snapping an endpoint onto another way while drawing joins them at that
  point.
- Different grades never auto-join: an elevated road crossing a surface
  street is an overpass. Set grade in the drawing tool's options row or on
  the way afterward.

At close zoom in the Infrastructure view, a junction renders as a real
footprint: each arm's lanes trim back and the shared asphalt fills the
middle, with per-lane guide curves showing which lane continues where.

## Edit turn lanes

Click a junction footprint with the Select tool. The junction inspector has
two tabs:

- **Turn lanes** lists each approach (lanes that travel *into* the
  junction), left-to-right as a driver sees them. The arrows on each lane
  toggle whether that lane may turn left, go straight, or turn right; each
  toggle edits the real lane-connectivity graph, and the guide curves on the
  map update as you click. "Reset to automatic" discards your custom
  connectors and returns to the derived defaults.
- **Control** sets the junction's traffic control: none, signal, stop, or
  roundabout. (Control is stored and editable today; distinct rendering for
  each is still on the roadmap.)

The default connectivity, when you haven't customized a junction: through
lanes match up straight across, the leftmost approach lane also turns left,
and the rightmost also turns right.

## Grade separation

To make an overpass out of an existing at-grade crossing, you currently
delete the junction's effect by re-drawing: set one way's grade to Elevated
*before* drawing it across. Changing grade after a junction has formed does
not yet un-form the junction; that cleanup is on the roadmap.
