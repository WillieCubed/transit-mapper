import { useState } from "react";
import { ColorSpectrum } from "./ColorSpectrum";
import { Icon } from "./Icon";
import { Popover } from "./Popover";

/**
 * A single labeled color control: shows the current color, opens a compact
 * popover of the system's common colors (its palette) plus a custom picker.
 * The palette is passed in, so it stays a centralized, per-system data source.
 */
interface ColorFieldProps {
  value: string;
  palette: string[];
  label?: string;
  disabled?: boolean;
  onChange: (hex: string) => void;
  onAddToPalette?: (hex: string) => void;
}

export function ColorField({ value, palette, label = "Color", disabled, onChange, onAddToPalette }: ColorFieldProps) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);

  const inPalette = palette.some((c) => c.toLowerCase() === value.toLowerCase());

  return (
    <div className="cf-root">
      <span className="control-label">{label}</span>
      <Popover
        open={open && !disabled}
        onOpenChange={setOpen}
        className="cf-popover"
        align="start"
        side="top"
        trigger={
          <button type="button" className="cf-trigger" disabled={disabled} aria-label={`${label}: ${value}`}>
            <span className="cf-trigger-swatch" style={{ background: value }} />
            <Icon name="chevronDown" size={16} />
          </button>
        }
      >
        <div className="cf-swatches" role="group" aria-label="Palette colors">
          {palette.map((c) => (
            <button
              key={c}
              type="button"
              className={`cf-swatch ${c.toLowerCase() === value.toLowerCase() ? "active" : ""}`}
              style={{ background: c }}
              aria-label={c}
              aria-pressed={c.toLowerCase() === value.toLowerCase()}
              title={c}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
            />
          ))}
        </div>

        <button type="button" className={`cf-custom-toggle ${custom ? "active" : ""}`} aria-pressed={custom} onClick={() => setCustom((v) => !v)}>
          <Icon name="plus" size={16} /> Custom color
        </button>

        {custom && (
          <div className="cf-custom">
            <ColorSpectrum value={value} onChange={onChange} />
            {onAddToPalette && !inPalette && (
              <button type="button" className="cf-add" onClick={() => onAddToPalette(value)}>
                Save to palette
              </button>
            )}
          </div>
        )}
      </Popover>
    </div>
  );
}
