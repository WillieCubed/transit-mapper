// The inspector's task switcher — an MD3-style segmented control that turns
// a selection's panel into task-based modes (Lanes / Identity / Alignment
// for a way, Turn lanes / Control for a junction) instead of one long
// stacked form. One concern on screen at a time; the tab row is the whole
// navigation.
export interface InspectorTab {
  id: string;
  label: string;
}

export interface InspectorTabsProps {
  tabs: InspectorTab[];
  active: string;
  onChange: (id: string) => void;
}

export function InspectorTabs({ tabs, active, onChange }: InspectorTabsProps) {
  if (tabs.length < 2) return null;
  return (
    <div className="insp-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={`insp-tab ${active === t.id ? "active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
