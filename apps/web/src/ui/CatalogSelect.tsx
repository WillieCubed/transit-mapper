import { DropdownMenu, DropdownMenuItem } from "./DropdownMenu";
import { Icon } from "./Icon";

interface CatalogSelectOption {
  id: string;
  label: string;
  color: string;
}

interface CatalogSelectProps {
  label: string;
  value: string;
  options: CatalogSelectOption[];
  onChange: (id: string) => void;
  disabled?: boolean;
}

/**
 * A labeled dropdown for picking a catalog entry (way type, mode) that has an
 * associated render color — shows that color as a swatch on the trigger and
 * next to every option, so the picker reads at a glance (see
 * style/catalogStyle.ts's WAY_TYPE_RENDER/MODE_RENDER, the single source for
 * these colors) instead of requiring every label to be read to tell entries
 * apart. Used in place of a plain <select> anywhere the choice is a catalog
 * entry with a real color; parametric choices with no associated color
 * (grade, class) stay plain selects.
 */
export function CatalogSelect({ label, value, options, onChange, disabled }: CatalogSelectProps) {
  const current = options.find((o) => o.id === value) ?? options[0];
  return (
    <div className="opt-field">
      <span className="control-label">{label}</span>
      <DropdownMenu
        align="start"
        trigger={
          <button type="button" className="cs-trigger" disabled={disabled}>
            <span className="cs-trigger-left">
              <span className="cs-trigger-swatch" style={{ background: current?.color }} />
              <span>{current?.label ?? value}</span>
            </span>
            <Icon name="chevronDown" size={14} style={{ opacity: 0.6, flex: "none" }} />
          </button>
        }
      >
        {options.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => onChange(o.id)}>
            <span className="cs-item-swatch" style={{ background: o.color }} />
            <span style={{ flex: 1 }}>{o.label}</span>
            {o.id === value && <Icon name="check" size={14} />}
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
    </div>
  );
}
