# Data model

A saved document is one `TransitSystem` (defined in
[`src/model/system.ts`](../../src/model/system.ts)): a regional, multimodal
network. The model's central split is **infrastructure versus service** — a
`Way` is the physical carrier, a `Service` is a colored route people ride,
and many services can share one way.

All kind fields (`typeId`, `modeId`, `kindId`, and so on) are string ids
into the catalogs — see [Catalogs](catalogs.md). The schema is versioned
(currently v7) and migrated on load in `src/model/serialize.ts`, so older
saves and shared snapshots keep working.

## TransitSystem

| Field | Meaning |
| --- | --- |
| `version` | Schema version (7). |
| `id`, `name`, `description` | Identity. |
| `viewport` | Saved camera (`center`, `zoom`). |
| `ways` | Physical infrastructure. |
| `services` | Transit lines. |
| `stations` | Stops / stations. |
| `facilities` | Catalog-typed point and area features. |
| `groups` | Bundles of members; a facility complex when it has a footprint. |
| `nodes` | Junctions — coordinates shared by 2+ ways. |
| `namedWays` | Shared identities across ways ("Decatur Avenue"). |
| `palette` | The system's saved colors. |

## Way — physical infrastructure

One alignment on, above, or below the ground: a road, a track, a bike path,
a gondola span, a ferry route. One unified type covers all of them,
discriminated by `typeId` into the way-type catalog; there is no per-mode
class hierarchy.

| Field | Meaning |
| --- | --- |
| `typeId` | Way-type catalog id (`road`, `heavyRail`, `bike`, …). |
| `points` | Control vertices (`[lng, lat]`) defining the alignment. |
| `geometry` | How the path renders between points: `straight`, `curved`, `freeform`. |
| `grade` | `underground`, `atGrade`, or `elevated`. |
| `profile` | The cross-section (below). |
| `classId` | Facility class within the type (arterial vs. local, …). |
| `source` | Provenance marker, e.g. `"osm"` for imported ways. |

### CrossSection and LaneSpec

A way's `profile` is its full cross-section: an ordered list of lanes,
**left-to-right as seen facing forward** (the direction of increasing point
index, the osm2streets convention).

```ts
interface LaneSpec {
  id: string;         // stable, so junction connectors can reference it
  kindId: string;     // lane-kind catalog id: drive, track, median, sidewalk, …
  widthM: number;     // meters (the UI shows feet)
  direction: "forward" | "backward" | "both" | "none";
}
```

The profile is constant along a way. Where a street's section changes — a
turn pocket appears, a lane drops — the way is split and the pieces share
identity through a `NamedWay`. Capacity (a road's "lanes", a railway's
"tracks") is **derived** from the profile (`src/model/profile.ts`), never
stored.

## Node — junctions

A `Node` is a coordinate shared by two or more ways' control points — real
topology, not two paths that happen to cross visually. Every
store mutation that inserts, deletes, or moves control points keeps `refs`
(`{wayId, pointIndex}` pairs) in sync.

- `control` — traffic control: `uncontrolled`, `signal`, `stop`,
  `roundabout`.
- `connectors` — the lane-connectivity graph: each `LaneConnector` says one
  specific incoming lane continues into one specific outgoing lane. Stored
  only once the user customizes turn lanes; otherwise derived by heuristic
  on demand. Turn arrows are derived from connectors rather than stored.

## NamedWay — shared identity

```ts
interface NamedWay { id: string; name: string; wayIds: string[] }
```

One named physical facility spanning several ways: the two one-way
carriageways of a boulevard, a trail crossing many junction-split segments.
What the identity is *called* in the UI ("Street", "Line", "Trail") comes
from the way family's catalog noun.

## Service, Pattern, SchedulePeriod

A `Service` is a colored route: `name`, `modeId` (mode catalog), `color`,
and one or more `Pattern`s. Each pattern is an ordered list of `wayIds` —
a plain line has one pattern; two or more model branches sharing the
service's identity ("via Airport").

Scheduling stays at the level of headways rather than timetables:

- Quick fields: `frequencyMinutes` (peak headway), `spanStart`/`spanEnd`
  (24-hour `"HH:MM"`).
- Optional detail: `schedule`, a list of `SchedulePeriod`s
  (`label`, `days: "daily" | "weekday" | "weekend"`, span, headway). When
  present it supersedes the quick fields.

## Station

| Field | Meaning |
| --- | --- |
| `coord` | Network-node position, snapped onto its way. |
| `anchor` | `{wayId, t}` — normalized arc-length position along the way; how a station follows its way when the alignment is reshaped. |
| `footprint` | The station's land: a boundary polygon drawn in the Infrastructure view. |
| `platforms` | Platform polygons inside the station (`edges: 1` side, `2` island). |
| `dwellSeconds` | Vehicle dwell time for the ambient animation. |

## Facility and Group

A `Facility` is a catalog-typed feature that isn't a way or station: its
`geometry` is a single point (entrance, elevator, bike dock) or a polygon
(building, bus bay, platform, parking, depot), as the facility type's
`geometryKind` dictates.

A `Group` bundles any members into one unit. With a `footprint` polygon (and
optionally a `color`), it's a facility complex — a real physical site like a
transfer center; without one it's a plain logical grouping.
