import { useMemo } from "react";
import { useEditor } from "../editor/EditorProvider";
import { validateSystem } from "@transitmapper/core/model/validate";
import { IconButton } from "./IconButton";
import { Popover } from "./Popover";
import { useListboxKeyboardNav } from "./useListboxKeyboardNav";

/**
 * A pure sanity check surfaced as UI: ghost ways/services, orphaned stations,
 * and ways that cross without joining (see model/validate.ts). Hidden
 * entirely when the system is clean — this is a warning light, not a panel
 * that's always present and usually empty.
 */
export function IssuesPopover() {
  const system = useEditor((s) => s.system);
  const selectAndFocus = useEditor((s) => s.selectAndFocus);
  const issues = useMemo(() => validateSystem(system), [system]);
  const { containerRef, onKeyDown } = useListboxKeyboardNav<HTMLDivElement>();

  if (issues.length === 0) return null;

  const label = `${issues.length} issue${issues.length === 1 ? "" : "s"} found`;
  const firstJumpableId = issues.find((i) => i.target)?.id;

  return (
    <Popover trigger={<IconButton icon="warning" label={label} active className="issues-trigger" />}>
      <div className="issues-popover" role="listbox" aria-label="Issues" ref={containerRef} onKeyDown={onKeyDown}>
        <span className="panel-section-label">{label}</span>
        <ul className="issues-list">
          {issues.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                tabIndex={issue.id === firstJumpableId ? 0 : -1}
                className="issues-item"
                disabled={!issue.target}
                onClick={() => issue.target && selectAndFocus(issue.target)}
              >
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Popover>
  );
}
