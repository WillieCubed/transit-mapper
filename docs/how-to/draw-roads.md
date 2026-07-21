# Draw and edit roads

All of this happens in the **Infrastructure** view with the **Road** tool
(`R`). Drawing a road never creates a transit service; streets are context
that services ride later.

## Draw a road with a chosen cross-section

1. Activate the Road tool. Its chevron menu lists cross-section presets
   ("2-lane local", "4-lane arterial", "Divided boulevard", …); picking one
   arms it for everything you draw next. `1`–`9` select presets from the
   keyboard.
2. Click to place points; `Enter` or double-click finishes; `Esc` cancels.
3. The Shape control (Straight / Curved / Freeform) sets how segments render
   between your points. Freeform samples a dragged path instead.

Grade (underground / at grade / elevated) is in the options row. Underground
ways render dashed; elevated ways cross surface streets without forming
intersections.

## Edit lanes after drawing

Select the road and open the inspector's **Lanes** tab. The lane strip shows
the cross-section left-to-right as you'd see it facing the direction the
road was drawn.

- Click a lane card to change its kind, width (presets are in feet), or
  direction.
- Add, remove, and reorder lanes with the buttons under the strip; `[` and
  `]` change the lane count from the keyboard.
- "Apply preset…" swaps the whole cross-section.

## One-way streets

- Before drawing: set **Direction: One-way** in the options row (or press
  `O` with the tool armed). One-way streets travel in the direction you
  draw them.
- After drawing: select the road and press `O` to toggle, `D` to flip the
  whole cross-section (equivalent to having drawn it the other way).
- Per-lane exceptions (a contraflow bus lane, say) are set on the lane card:
  give one lane the opposite direction.

In the Network view, served one-way ways show chevrons along the line in the
direction of travel.

## Divided streets and couplets

Two ways to get a pair of one-way carriageways that are still one street:

- **Separate an existing two-way road**: select it, Lanes tab, "Separate
  carriageways". The road splits into two one-way ways around a median gap;
  both stay under one street identity.
- **Branch from an endpoint**: with the Road tool active, right-click near
  any road's open endpoint. A new one-way segment starts there, inheriting
  the street's cross-section and name — the natural gesture for the point
  where a street splits into a couplet.

"Combine carriageways" (on either member) merges a pair back into one
two-way road.

## Street names

A road's name lives in the inspector's **Identity** tab. Names are shared
identities: every segment carrying the same name is one street, across
junction splits and separated carriageways, and renaming any segment renames
the street. Names label the map at close zoom.

## Splitting and merging segments

- Ctrl-click a control point to split a way there.
- Junctions split ways automatically at crossings.
- "Merge with connected way" (Alignment tab) joins two segments end-to-end
  when a plain two-way joint connects them — the inverse of splitting.
