# Catalogs

Every *kind* in TransitMapper — way types, service modes, lane kinds,
facility types, grades, presets — is catalog **data** in
[`src/model/catalog.ts`](../../src/model/catalog.ts), not a union type baked
into logic. Records in the data model reference catalog entries by string
id. Adding a funicular or a queue-jump lane means adding a catalog entry.

Rendering (colors, dashes, icons) for each catalog entry lives separately in
`src/style/catalogStyle.ts`; the catalog itself is pure domain data.

## Way types (`WAY_TYPES`)

The physical carriers. Each declares its family, its capacity unit, its
facility classes, which lane kinds its cross-section may include, and the
default profile a new way starts with.

| Id | Label | Family | Capacity unit |
| --- | --- | --- | --- |
| `heavyRail` | Heavy rail | guideway | tracks |
| `lightRail` | Light rail / tram | guideway | tracks |
| `monorail` | Monorail | guideway | beams |
| `road` | Road | roadway | lanes |
| `bike` | Bike | path | width |
| `pedestrian` | Pedestrian | path | width |
| `aerial` | Aerial / gondola | aerial | cabins/hr |
| `water` | Ferry route | water | vessels |

Heavy rail, light rail, and monorail are separate types (not classes of one
"rail") because they're physically incompatible track standards. Roads carry
classes (transitway / arterial / collector / local); bike ways carry
protection classes; pedestrian ways carry promenade / pathway / stairs.

### Way families (`WAY_FAMILIES`)

Families group types for the UI: each family is one drawing tool in the dock
(`toolLabel`: Road, Track, Path, Aerial, Ferry), and supplies the noun a
shared identity of that family gets (`identityNoun`: Street, Line, Trail,
Route).

## Lane kinds (`LANE_KINDS`)

Elements of a cross-section. Each has a `role` (`travel`, `separator`,
`edge`), a default width and width presets (stored in meters, presented in
feet), whether it counts toward the way's headline capacity, and whether
one-way/flip operations steer it (`directional` — drive lanes and tracks
are; a one-way street's sidewalks stay bidirectional).

`drive`, `bus`, `turnPocket`, `bike`, `sidewalk`, `parking`, `shoulder`,
`median`, `track`, `platform`, `channel` (an aerial span or navigable water
lane).

## Profile presets (`PROFILE_PRESETS`)

One-click cross-sections offered while drawing or editing — the turnkey
path. Roads: 2-lane local, 3-lane with center turn, 4-lane arterial, 5-lane
with center turn, divided boulevard, 3-lane one-way, transitway. Rail:
single / double / quad track. Presets may also set the way's class (the
boulevard preset makes an arterial).

## Modes (`MODES`)

Services people ride. Each mode lists the way types it can run over, which
drives every compatibility check (the mode picker, route drawing, adoption):

| Id | Label | Runs over |
| --- | --- | --- |
| `subway` | Subway / metro | heavyRail |
| `commuterRail` | Commuter rail | heavyRail |
| `lightRail` | Light rail | lightRail, road |
| `tram` | Tram / streetcar | lightRail, road |
| `monorail` | Monorail | monorail |
| `brt` | BRT | road |
| `bus` | Bus | road |
| `gondola` | Gondola / aerial | aerial |
| `ferry` | Ferry | water |

Light rail and trams list `road` because they street-run in a road's
right-of-way (a road's cross-section can include `track` lanes).

## Grades (`GRADES`)

`underground`, `atGrade`, `elevated`. Grade decides junction formation:
same-grade crossings form junctions; different grades pass over each other.

## Facility types (`FACILITY_TYPES`)

Each has a `geometryKind` that decides how the Facility tool works for it —
`point` (click to place) or `area` (drawn to shape):

- Points: `entrance`, `bikeDock`, `elevator`.
- Areas: `building`, `busBay`, `platform`, `parkingLot`, `depot`.

## Extending a catalog

Add the entry to the relevant record and order array in
`src/model/catalog.ts`, add its rendering to `src/style/catalogStyle.ts`,
and add a check to `scripts/verify.ts`. Nothing else should need to change —
if adding an entry forces edits elsewhere, that's a bug in the code that
forced it.
