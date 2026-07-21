import { useEditor } from "../editor/EditorProvider";
import { exportSystemJson } from "../share/jsonExport";
import { DropdownMenu, DropdownMenuItem } from "./DropdownMenu";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { useUi } from "./UiProvider";

/** Figma-style file menu: New/Import/Export, tucked behind one trigger in
 *  the left panel instead of sitting loose among the top bar's action
 *  buttons — these are whole-document actions, not in-place edits. */
export function FileMenu() {
  const system = useEditor((s) => s.system);
  const readOnly = useEditor((s) => s.readOnly);
  const newSystem = useEditor((s) => s.newSystem);
  const { openDialog } = useUi();

  if (readOnly) return null;

  return (
    <DropdownMenu align="start" trigger={<IconButton icon="file" size={17} label="File menu" />}>
      <DropdownMenuItem onSelect={newSystem}>
        <Icon name="file" size={17} /> New system
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => openDialog("systems")}>
        <Icon name="layers" size={17} /> My systems…
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => openDialog("import")}>
        <Icon name="road" size={17} /> Import streets…
      </DropdownMenuItem>
      {/* The portable escape hatch out of browser localStorage (the only
          other place a system lives) — back it up, put it in git, move it
          to another browser/computer. Not the same as Share, which creates
          a hosted read-only snapshot rather than a file you keep. */}
      <DropdownMenuItem onSelect={() => exportSystemJson(system)}>
        <Icon name="download" size={17} /> Export system data (.json)
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
