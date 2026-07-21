# Share and export

## Share a read-only link

**Share…** (top bar) uploads a snapshot of the current system and gives you a
URL. Anyone with the link sees a read-only copy — they can pan, zoom, and
switch views, and can **fork** it into their own editable copy. The snapshot
is frozen at the moment you shared; later edits need a new link.

Sharing requires the backend (a Cloudflare Worker with a D1 database). In
local development without a worker running, sharing is unavailable; the rest
of the editor works fine.

## Export an image

The **Export** button exports the current view straight to **PNG**; the
dropdown next to it also offers **SVG**, and **Export…** opens a dialog with
a live preview where you can choose what's included. `C` captures a quick
PNG of the whole system from the keyboard.

Exports are rendered from the system data itself, not screenshotted from the
map, so they come out clean at any size and include a legend.

## Save data

Systems save automatically in your browser (local storage); the Systems
dialog manages multiple systems. A JSON export of the full system document is
available for backup or moving between browsers — it round-trips through the
same versioned serializer the app uses, so old files keep loading as the
schema evolves.

## Hide the interface

`\` toggles all floating panels away, leaving just the map — useful for
screen-sharing or screenshots beyond the built-in export.
