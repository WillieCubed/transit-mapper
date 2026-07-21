# Design principles

The conventions here are enforced in review and encoded in the test suite;
this page explains why they exist. The short version lives in
[CONTRIBUTING.md](../../CONTRIBUTING.md).

## Kinds are catalog data, never unions

A transit tool's kinds never stop growing: someone always wants a gondola, a
funicular, a queue-jump lane. If "way type" were a TypeScript union, each
addition would touch every switch over that union — and each switch is a
place to forget one. Instead every kind (way types, modes, lane kinds,
facility types, grades) is a record in `src/model/catalog.ts` carrying its
own behavior as data: which lane kinds a road allows, which way types a
tram can run over, whether a facility is a point or an area. Code consumes
catalog fields and never branches on catalog ids. Adding a kind is one
entry plus its style.

The test for whether a design honors this: could a hypothetical
user-defined catalog entry work? If some behavior only exists for
`typeId === "road"`, it couldn't.

## Style is separate from domain

Domain modules say what a drive lane *is* (a travel lane, ~11 feet, counts
toward capacity, directional). `src/style/catalogStyle.ts` says how it
*looks* (asphalt gray, white dashes). Mixing them makes the model
untestable without caring about colors and makes restyling a schema
migration. The one deliberate exception: a service's `color` is domain,
because "the red line" is an identity.

## The model stays pure

`src/model/` and `src/geometry/` are data-in/data-out. No DOM, no network,
no store. That's what lets `npm run verify` exercise migrations, junction
geometry, and routing as plain function calls, fast enough to run on every
change, with nothing mocked.

## Derive, don't store

Nothing drawable is persisted: lane polygons, junction footprints, turn
arrows, capacity numbers are all computed from the model on demand (and
memoized). Stored derived data can go stale; derived derived data can't.
The same rule gives the schema its small surface — a way is points plus a
profile, and everything else follows.

## Menus versus modes

The bottom dock is *modes*: one click starts doing the thing the button
names — Road draws a road, Station draws a station. Variants of a mode
(which track standard, which facility) live in the tool's flyout menu, and
contextual settings (direction, grade, preset) in the options row above the
dock. The dock is split into surfaces by what tools *produce*: selection,
then path-drawing tools, then place-defining tools. The test: a button's
label must describe what happens on the next click, and no capability may
exist only inside an unrelated dropdown.

## Tools tell the truth

Corollaries that keep recurring: a tool that says it draws a thing must
draw it (not place a proxy for it); labels use meaningful nouns from the
domain (a station has a *boundary* and *structures*, not "markers" and
"footprints"); and views enforce their own semantics (see
[The three views](views.md)).

## Shared identity is an entity

"Decatur Avenue" isn't a property of one way — it's a `NamedWay` spanning
however many ways the street has been split into. Modeling identity as its
own entity is what lets a couplet's two carriageways, or a rail line's
junction-split segments, stay one nameable thing. The noun for the identity
("Street", "Line", "Trail") comes from the catalog, because the same
mechanism serves every family.
