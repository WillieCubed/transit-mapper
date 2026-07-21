# Contributing to TransitMapper

Thanks for your interest. TransitMapper is a work in progress with a small
surface of hard rules and a lot of open room. This document covers setup,
the conventions the codebase enforces, and how to land a change.

## Project status

This is early software under active development. APIs, the on-disk schema,
and the UI all still move. If you're planning anything larger than a bug
fix, open an issue first so we can talk about it before you sink time in.

## Setup

Requirements: Node 20+ and [pnpm](https://pnpm.io).

```sh
git clone git@github.com:WillieCubed/transit-mapper.git
cd transit-mapper
pnpm install
pnpm dev
```

The editor runs at `http://localhost:5173` with no backend required. The
share backend (Cloudflare Worker + D1) is optional for development; run it
with `pnpm worker:dev` if you're working on sharing.

Before opening a PR:

```sh
pnpm typecheck
pnpm verify
```

Both must pass. `verify` is the whole test suite — hundreds of fast,
deterministic checks over the model, store, geometry engine, and rendering
emission, with no browser needed.

## Architecture in five sentences

The domain model (`packages/core/src/model/`) is pure data and pure
functions: a `TransitSystem` document holding ways, services, stations,
facilities, junction nodes, and named ways. All mutation goes through one
zustand store (`apps/web/src/editor/store.ts`), which is the only place the
system changes; undo, junction bookkeeping, and migrations hang off it.
Rendering derives everything (`apps/web/src/map/layers.ts` plus the geometry
engine in `packages/core/src/geometry/`) — nothing drawable is stored.
Pointer and keyboard input live in `apps/web/src/map/interactions.ts` and
`apps/web/src/editor/keymap.ts`. React components under `apps/web/src/ui/`
are thin: they read the store and call actions.

A longer version with a directory map lives in
[docs/reference/project-structure.md](docs/reference/project-structure.md).

## The rules that are not negotiable

These come up in review every time, so here they are up front:

1. **Kinds are catalog data, never unions.** Way types, modes, lane kinds,
   facility types, grades: all of them live in
   `packages/core/src/model/catalog.ts` as records. Adding a gondola or a
   new lane kind means adding a catalog entry, with no switches scattered
   through the code.
2. **Style is separate from domain.** Colors, widths, icons, and dash
   patterns live in `apps/web/src/style/catalogStyle.ts`. Model modules must
   not import style. If your domain type has a `color` field, it's in the
   wrong file (services are the one exception: a line's color is part of
   its identity).
3. **The model stays pure.** `packages/core/src/model/` and
   `packages/core/src/geometry/` are data-in/data-out with no network, no
   DOM, no store access. That is what keeps the test suite fast and free of
   mocks.
4. **The Infrastructure view is 2D.** Everything drawable there has physical
   extent: ways have cross-sections, stations are land, structures are
   shapes. Point placement belongs to the Network view's schematic and to
   facilities that really are points (an entrance, an elevator).
5. **Tools do what their labels say.** A button called Road draws a road on
   the first click. Variants go in a tool's flyout menu; contextual settings
   go in the options row; nothing gets buried in an unrelated dropdown.
6. **Named parameter types.** Function and component parameter shapes get a
   named interface, even small one-offs.
7. **Every behavior change gets a check.** Add to `apps/web/scripts/verify.ts`
   in the section that matches your change. If you fixed a bug, add the
   check that would have caught it.

## Making changes

- Branch from `main`.
- Keep PRs focused; unrelated refactors go in their own PR.
- Match the codebase's comment style: comments explain constraints and
  intent the code can't express on its own.
- If your change touches rendering or interaction, describe how you
  verified it in the browser (view, zoom level, gesture) in the PR body.
- Schema changes need a migration in `packages/core/src/model/serialize.ts`
  plus round-trip checks, so existing saved systems and shared snapshots
  keep loading.

## Reporting bugs

Open an issue with:

- what you did (tool, view, gesture),
- what you expected,
- what happened instead,
- and, if it's about a specific system, an exported share link or the
  relevant part of a save.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
