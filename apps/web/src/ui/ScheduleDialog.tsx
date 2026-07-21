import { useState } from "react";
import { shortId } from "@transitmapper/core/model/ids";
import type { ScheduleDayScope, SchedulePeriod } from "@transitmapper/core/model/system";
import { blurOnEnter } from "./formUtils";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";

interface ScheduleDialogProps {
  serviceName: string;
  /** The service's CURRENT detailed schedule, if it already has one. */
  schedule: SchedulePeriod[] | undefined;
  /** The service's simple headway/span — used to seed a first period when
   *  it doesn't have a detailed schedule yet, so this dialog never opens to
   *  a blank sheet (see the design note on ServiceInspector's "Use a full
   *  schedule instead" link). */
  frequencyMinutes: number | undefined;
  spanStart: string | undefined;
  spanEnd: string | undefined;
  readOnly: boolean;
  /** Fires on every add/edit/remove — this dialog has no separate "Save"
   *  step, matching how every other field in the Inspector commits live. */
  onSave: (periods: SchedulePeriod[] | undefined) => void;
  onClose: () => void;
}

const DAY_SCOPE_OPTIONS: [ScheduleDayScope, string][] = [
  ["daily", "Every day"],
  ["weekday", "Weekdays"],
  ["weekend", "Weekends"],
];

function seedPeriods(
  schedule: SchedulePeriod[] | undefined,
  frequencyMinutes: number | undefined,
  spanStart: string | undefined,
  spanEnd: string | undefined,
): SchedulePeriod[] {
  if (schedule && schedule.length > 0) return schedule;
  return [
    {
      id: shortId(),
      label: "All day",
      days: "daily",
      spanStart: spanStart ?? "06:00",
      spanEnd: spanEnd ?? "23:00",
      frequencyMinutes: frequencyMinutes ?? 10,
    },
  ];
}

/**
 * The expanded alternative to the Inspector's quick "Peak headway"/"Span of
 * service" chips — a real per-period schedule (Peak/Off-Peak/Weekend, or
 * whatever split fits) instead of one flat headway. Deliberately its own
 * dialog rather than inline in the (narrow) Inspector panel — see the user
 * feedback this was built from: a full schedule editor doesn't belong
 * stuffed into a 280px side panel.
 *
 * Owns its own draft array locally and commits the WHOLE array back via
 * onSave on every change (store.ts's setServiceSchedule is a one-shot
 * replace) — there's no separate Save step, matching how every other field
 * in this app's Inspector already commits live rather than on submit.
 */
export function ScheduleDialog({ serviceName, schedule, frequencyMinutes, spanStart, spanEnd, readOnly, onSave, onClose }: ScheduleDialogProps) {
  const [periods, setPeriods] = useState<SchedulePeriod[]>(() => seedPeriods(schedule, frequencyMinutes, spanStart, spanEnd));

  const commit = (next: SchedulePeriod[]) => {
    setPeriods(next);
    onSave(next);
  };

  const updatePeriod = (pid: string, patch: Partial<SchedulePeriod>) => commit(periods.map((p) => (p.id === pid ? { ...p, ...patch } : p)));

  const addPeriod = () => {
    const last = periods[periods.length - 1];
    commit([
      ...periods,
      {
        id: shortId(),
        label: `Period ${periods.length + 1}`,
        days: "daily",
        spanStart: last?.spanStart ?? "06:00",
        spanEnd: last?.spanEnd ?? "23:00",
        frequencyMinutes: 15,
      },
    ]);
  };

  // Deleting down to zero is allowed on purpose — it's the way back out of
  // a full schedule: setServiceSchedule treats an empty array the same as
  // undefined, so the Inspector falls back to its simple headway/span chips
  // the moment this dialog closes (see hasFullSchedule there).
  const removePeriod = (pid: string) => commit(periods.filter((p) => p.id !== pid));

  return (
    <Modal
      title={`${serviceName} — full schedule`}
      description="Edit named headway periods for this service, e.g. Peak, Off-Peak, Weekend, each with its own days, time span, and frequency."
      onClose={onClose}
      className="schedule-modal"
    >
      <p className="panel-hint">
        Each period is its own days + time window + headway. Vehicle animation on the map uses whichever period runs most frequently.
      </p>

      {periods.length === 0 ? (
        <p className="panel-hint">No periods yet — this line is using its plain peak headway instead. Add one below to split it out.</p>
      ) : (
        <ul className="schedule-list">
          {periods.map((p) => (
            <li key={p.id} className="schedule-editor-row">
              <div className="schedule-editor-row-head">
                <input
                  className="schedule-label-input"
                  aria-label="Period name"
                  value={p.label}
                  disabled={readOnly}
                  placeholder="Period name"
                  onChange={(e) => updatePeriod(p.id, { label: e.target.value })}
                  onKeyDown={blurOnEnter}
                />
                {!readOnly && <IconButton icon="trash" size={15} label={`Delete ${p.label || "this period"}`} onClick={() => removePeriod(p.id)} />}
              </div>

              <div className="chip-row" role="group" aria-label={`${p.label || "Period"} days`}>
                {DAY_SCOPE_OPTIONS.map(([d, label]) => (
                  <button
                    key={d}
                    type="button"
                    className={`chip ${p.days === d ? "active" : ""}`}
                    aria-pressed={p.days === d}
                    disabled={readOnly}
                    onClick={() => updatePeriod(p.id, { days: d })}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="freq-row">
                <input
                  type="time"
                  className="freq-input freq-time"
                  aria-label={`${p.label || "Period"} first departure`}
                  value={p.spanStart}
                  disabled={readOnly}
                  onChange={(e) => updatePeriod(p.id, { spanStart: e.target.value })}
                />
                <span className="freq-suffix">to</span>
                <input
                  type="time"
                  className="freq-input freq-time"
                  aria-label={`${p.label || "Period"} last departure`}
                  value={p.spanEnd}
                  disabled={readOnly}
                  onChange={(e) => updatePeriod(p.id, { spanEnd: e.target.value })}
                />
                <input
                  type="number"
                  min={1}
                  className="freq-input"
                  aria-label={`${p.label || "Period"} headway in minutes`}
                  value={p.frequencyMinutes}
                  disabled={readOnly}
                  onChange={(e) => updatePeriod(p.id, { frequencyMinutes: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                />
                <span className="freq-suffix">min headway</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <button type="button" className="ghost-btn" style={{ width: "100%", justifyContent: "center" }} onClick={addPeriod}>
          <Icon name="plus" size={17} /> Add period
        </button>
      )}
    </Modal>
  );
}
