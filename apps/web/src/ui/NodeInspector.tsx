// Junction inspector: traffic control plus the per-lane turn editor. Each
// approach (an arm with lanes traveling INTO the junction) lists its
// incoming lanes left-to-right in travel order; the ← ↑ → toggles edit the
// REAL lane-connectivity graph (Node.connectors) — the map's connector
// guides redraw live, and future routing reads the same edges. "Automatic"
// junctions (no stored connectors) show the derived defaults; the first
// toggle materializes them as an explicit, stored graph.
import { useEditor } from "../editor/EditorProvider";
import {
  classifyTurn,
  effectiveConnectors,
  incomingLanes,
  junctionGeometry,
  outgoingLanes,
  type JunctionArm,
  type TurnClass,
} from "@transitmapper/core/geometry/junctions";
import { useState } from "react";
import { WAY_FAMILIES, laneKind, wayType } from "@transitmapper/core/model/catalog";
import { armRefKey, getComponent, laneRefKey } from "@transitmapper/core/model/components";
import type { LaneConnector, LaneSpec, NodeControl, Way } from "@transitmapper/core/model/system";
import { Icon } from "./Icon";
import { InspectorTabs, type InspectorTab } from "./InspectorTabs";

const CONTROL_OPTIONS: [NodeControl, string][] = [
  ["uncontrolled", "None"],
  ["signal", "Signal"],
  ["stop", "Stop"],
  ["roundabout", "Roundabout"],
];

const TURN_GLYPH: Record<Exclude<TurnClass, "uturn">, string> = { left: "←", straight: "↑", right: "→" };
const TURN_ORDER: Exclude<TurnClass, "uturn">[] = ["left", "straight", "right"];

interface NodeInspectorProps {
  id: string;
}

/** Signed turn angle from an incoming arm's heading to an outgoing arm. */
function turnBetween(inArm: JunctionArm, outArm: JunctionArm): number {
  const hx = -inArm.dir[0];
  const hy = -inArm.dir[1];
  return Math.atan2(hx * outArm.dir[1] - hy * outArm.dir[0], hx * outArm.dir[0] + hy * outArm.dir[1]);
}

/** The outgoing lane a toggled turn should land in: left turns take the
 *  leftmost target lane, right turns the rightmost, straight aligns from
 *  the right (matching the default heuristic). */
function targetLane(turn: TurnClass, outbound: LaneSpec[], inboundIndex: number, inboundCount: number): LaneSpec {
  if (turn === "left") return outbound[0];
  if (turn === "right") return outbound[outbound.length - 1];
  const fromRight = inboundCount - 1 - inboundIndex;
  return outbound[Math.max(0, outbound.length - 1 - fromRight)];
}

export function NodeInspector({ id }: NodeInspectorProps) {
  const node = useEditor((s) => s.system.nodes.find((n) => n.id === id));
  const ways = useEditor((s) => s.system.ways);
  const namedWays = useEditor((s) => s.system.namedWays);
  const readOnly = useEditor((s) => s.readOnly);
  const setNodeControl = useEditor((s) => s.setNodeControl);
  const setNodeConnectors = useEditor((s) => s.setNodeConnectors);
  const turnRestrictions = useEditor((s) => s.system.turnRestrictions);
  const setTurnRestriction = useEditor((s) => s.setTurnRestriction);
  const approachControls = useEditor((s) => s.system.approachControls);
  const setApproachControl = useEditor((s) => s.setApproachControl);
  const [tab, setTab] = useState<string>("turns");

  if (!node) return null;
  const waysById = new Map<string, Way>(ways.map((w) => [w.id, w]));
  const g = junctionGeometry(node, waysById);
  const connectors = effectiveConnectors(node, waysById, turnRestrictions);
  const control = node.control ?? "uncontrolled";

  const wayLabel = (way: Way): string => {
    const named = namedWays.find((n) => n.wayIds.includes(way.id));
    if (named?.name) return named.name;
    const type = wayType(way.typeId);
    return `${WAY_FAMILIES[type.family].identityNoun} · ${type.label}`;
  };

  const isActive = (lane: LaneSpec, fromWayId: string, targetWayIds: Set<string>): boolean =>
    connectors.some((c) => c.from.wayId === fromWayId && c.from.laneId === lane.id && targetWayIds.has(c.to.wayId));

  // Candidate target arms for one lane's turn-class, narrowed by any active
  // TurnRestriction (see model/system.ts) — a lane restricted to specific
  // target ways can never offer a turn outside that list, regardless of
  // what angle bucket it geometrically falls into.
  const turnTargets = (inArm: JunctionArm, lane: LaneSpec, turn: Exclude<TurnClass, "uturn">): JunctionArm[] => {
    if (!g) return [];
    const byAngle = g.arms.filter((a) => a !== inArm && classifyTurn(turnBetween(inArm, a)) === turn);
    const restriction = getComponent(turnRestrictions, laneRefKey(inArm.wayId, lane.id));
    return restriction ? byAngle.filter((a) => restriction.allowedTargets.includes(a.wayId)) : byAngle;
  };

  const toggleTurn = (inArm: JunctionArm, lane: LaneSpec, laneIndex: number, inboundCount: number, turn: Exclude<TurnClass, "uturn">) => {
    const targets = turnTargets(inArm, lane, turn);
    if (targets.length === 0) return;
    const targetWayIds = new Set(targets.map((a) => a.wayId));
    const active = isActive(lane, inArm.wayId, targetWayIds);
    let next: LaneConnector[];
    if (active) {
      next = connectors.filter((c) => !(c.from.wayId === inArm.wayId && c.from.laneId === lane.id && targetWayIds.has(c.to.wayId)));
    } else {
      const additions: LaneConnector[] = [];
      for (const t of targets) {
        const outbound = outgoingLanes(waysById.get(t.wayId)!, t.end);
        if (outbound.length === 0) continue;
        additions.push({
          from: { wayId: inArm.wayId, laneId: lane.id },
          to: { wayId: t.wayId, laneId: targetLane(turn, outbound, laneIndex, inboundCount).id },
        });
      }
      next = [...connectors, ...additions];
    }
    setNodeConnectors(node.id, next);
  };

  const approaches = (g?.arms ?? [])
    .map((arm) => {
      const way = waysById.get(arm.wayId);
      if (!way) return null;
      const inbound = incomingLanes(way, arm.end);
      return inbound.length > 0 ? { arm, way, inbound } : null;
    })
    .filter((a): a is { arm: JunctionArm; way: Way; inbound: LaneSpec[] } => a !== null);

  const tabs: InspectorTab[] = [
    { id: "turns", label: "Turn lanes" },
    { id: "control", label: "Control" },
  ];

  return (
    <aside className="panel panel-right" aria-label="Selection details">
      <div className="insp-head">
        <span className="dot ring" />
        <span className="insp-name static">Junction</span>
      </div>
      <div className="insp-kind">
        {g ? `${g.arms.length} arms` : "junction"} · {node.connectors ? "custom turn lanes" : "automatic turn lanes"}
      </div>

      <InspectorTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "turns" && (
        <div className="insp-section" role="tabpanel">
          {!readOnly && <p className="insp-sub">Lanes are listed left-to-right as a driver on that approach sees them — toggle where each may go</p>}
          {approaches.map(({ arm, way, inbound }) => (
            <div key={`${arm.wayId}:${arm.end}`} className="node-approach">
              <div className="node-approach-name">{wayLabel(way)}</div>
              {inbound.map((lane, i) => {
                const restrictionKey = laneRefKey(arm.wayId, lane.id);
                const restriction = getComponent(turnRestrictions, restrictionKey);
                return (
                  <div key={lane.id} className="node-lane-row">
                    <span className="node-lane-label">
                      {laneKind(lane.kindId).label} {i + 1}
                    </span>
                    <span className="node-lane-turns">
                      {TURN_ORDER.map((turn) => {
                        const targets = turnTargets(arm, lane, turn);
                        const active = targets.length > 0 && isActive(lane, arm.wayId, new Set(targets.map((a) => a.wayId)));
                        return (
                          <button
                            key={turn}
                            className={`chip ${active ? "active" : ""}`}
                            aria-pressed={active}
                            disabled={readOnly || targets.length === 0}
                            title={restriction && targets.length === 0 ? `${turn} turn restricted` : `${turn} turn`}
                            onClick={() => toggleTurn(arm, lane, i, inbound.length, turn)}
                          >
                            {TURN_GLYPH[turn]}
                          </button>
                        );
                      })}
                      {!readOnly && (
                        <button
                          type="button"
                          className={`ghost-btn icon-btn ${restriction ? "active" : ""}`}
                          aria-pressed={!!restriction}
                          title={
                            restriction
                              ? "Turn-restricted — click to unrestrict"
                              : "Lock this lane to only its currently-toggled turns"
                          }
                          onClick={() => {
                            if (restriction) {
                              setTurnRestriction(arm.wayId, lane.id, undefined);
                            } else {
                              const allowed = [
                                ...new Set(
                                  connectors
                                    .filter((c) => c.from.wayId === arm.wayId && c.from.laneId === lane.id)
                                    .map((c) => c.to.wayId),
                                ),
                              ];
                              setTurnRestriction(arm.wayId, lane.id, allowed);
                            }
                          }}
                        >
                          <Icon name="lock" size={12} />
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {!readOnly && node.connectors && (
            <div className="insp-actions">
              <button type="button" className="ghost-btn" onClick={() => setNodeConnectors(node.id, undefined)}>
                Reset to automatic
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "control" && (
        <div className="insp-section" role="tabpanel">
          <label className="field-label" id="node-control-label">Whole junction</label>
          <div className="chip-row" role="group" aria-labelledby="node-control-label">
            {CONTROL_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                className={`chip ${control === value ? "active" : ""}`}
                aria-pressed={control === value}
                disabled={readOnly}
                onClick={() => setNodeControl(node.id, value === "uncontrolled" ? undefined : value)}
              >
                {label}
              </button>
            ))}
          </div>

          {approaches.length > 0 && (
            <>
              <label className="field-label">Per-approach override</label>
              <p className="insp-sub">E.g. a stop sign on the minor street only, leaving the main street free-flowing.</p>
              {approaches.map(({ arm, way }) => {
                const key = armRefKey(arm.wayId, arm.end);
                const override = getComponent(approachControls, key)?.control;
                const effective = override ?? control;
                return (
                  <div key={key} className="node-approach">
                    <div className="node-approach-name">{wayLabel(way)}</div>
                    <div className="chip-row" role="group" aria-label={`${wayLabel(way)} traffic control`}>
                      {CONTROL_OPTIONS.map(([value, label]) => (
                        <button
                          key={value}
                          className={`chip ${effective === value ? "active" : ""}`}
                          aria-pressed={effective === value}
                          disabled={readOnly}
                          onClick={() => setApproachControl(arm.wayId, arm.end, value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {!readOnly && override !== undefined && (
                      <button type="button" className="ghost-btn" onClick={() => setApproachControl(arm.wayId, arm.end, undefined)}>
                        Use junction default
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
