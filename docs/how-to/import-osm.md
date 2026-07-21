# Import streets from OpenStreetMap

Rather than tracing a whole city by hand, you can pull real infrastructure
from OpenStreetMap into your system and plan on top of it.

## Import

1. Open the File menu and choose **Import real streets** (or open the Import
   dialog from wherever you are).
2. Frame the map on the area you want first — the import covers the current
   viewport.
3. Pick categories: Streets, Heavy rail, Light rail / tram, Bike
   infrastructure.
4. Click **Import into this system**.

The import queries the Overpass API (a free public service; large areas can
be slow or get rate-limited, so start with a neighborhood, not a metro).

## What you get

Imported ways are ordinary ways, identical to hand-drawn ones except for a
provenance marker. OSM's road grades map onto the catalog's road classes
(motorways come in as transitways, primary/secondary roads as arterials,
residential streets as locals) and each way gets its type's default
cross-section — OSM lane tagging is not yet read, so widen or re-profile
specific streets yourself where it matters.

Imported ways start as bare infrastructure carrying no service. From there
the normal tools apply: route services over them, edit their lanes, form
junctions, adopt them under existing sketches.

## Practical notes

- Import is additive; running it twice over the same area duplicates ways.
  Undo reverses an import in one step.
- Imported ways arrive unjoined — crossings become real junctions when you
  edit the ways involved, or you can leave them visual if you're only using
  the streets as context.
