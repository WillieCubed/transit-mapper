# Keyboard shortcuts

Press `?` in the editor for this list in a dialog. Everything the keyboard
does is also reachable by mouse. Shortcuts don't fire while you're typing
in a text field.

The single source of truth is `KEY_BINDINGS` in
[`src/editor/keymap.ts`](../../src/editor/keymap.ts); this page mirrors it.

## Tools

| Key | Action |
| --- | --- |
| `V` | Select & edit |
| `L` | Draw way / line (last kind used) |
| `R` | Draw road |
| `T` | Draw track |
| `P` | Draw path |
| `S` | Add station |
| `F` | Place facility |

## Camera

| Key | Action |
| --- | --- |
| Arrow keys | Pan |
| `Z`, `+`, `PageUp` | Zoom in |
| `X`, `-`, `PageDown` | Zoom out |
| Hold `Space` + drag | Pan with the mouse |

## Editing

| Key | Action |
| --- | --- |
| `Esc` | Back out one level: cancel the in-progress draw or armed flow, then drop the tool, then clear the selection |
| `Enter` | Commit the line or road being drawn |
| `Delete` / `Backspace` | Delete the selection |
| `Ctrl`/`⌘` + `Z` | Undo |
| `Ctrl`/`⌘` + `Shift` + `Z`, `Ctrl`/`⌘` + `Y` | Redo |

Undo/redo are the only browser-style modifier combos the app claims; all
other `Ctrl`/`⌘` shortcuts pass through to the browser.

## Lanes

These act on the way being drawn right now, or else the selected way —
whichever the cross-section editor is showing.

| Key | Action |
| --- | --- |
| `[` / `]` | Remove / add a lane |
| `D` | Flip direction (reverse the whole cross-section) |
| `O` | Toggle one-way ⇄ two-way; with only the drawing tool armed, arms one-way for the next draw |
| `1`–`9` | Apply that numbered cross-section preset (or arm it as the drawing default) |

## Other

| Key | Action |
| --- | --- |
| `C` | Capture a PNG of the whole system |
| `\` | Show / hide the UI |
| `?` | Show the shortcuts dialog |
