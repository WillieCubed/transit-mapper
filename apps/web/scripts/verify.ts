// Deterministic verification of the editor/model logic without a browser.
// Run with: node scripts/verify.ts  (or: npm run verify)
import { createEditorStore } from "../src/editor/store";
import { parseSystem, forkSystem, createEmptySystem } from "@transitmapper/core/model/serialize";
import { FACILITY_TYPE_ORDER, FACILITY_TYPES, MODE_ORDER, MODES, modesForWayType, wayType } from "@transitmapper/core/model/catalog";
import {
  roundedCorners,
  squareFootprint,
  systemBounds,
  wayLengthMeters,
  INTERCHANGE_METERS,
  metersFromOrigin,
  nearestOnPath,
  nearestOpenEndpoint,
  patternPath,
  pointAtT,
  resolveWayPath,
  servedWayIds,
  serviceWayIds,
  snap,
} from "@transitmapper/core/model/geo";
import { computeDiagramSystem } from "@transitmapper/core/model/diagramLayout";
import { isDoubleClickFinish } from "../src/map/interactions";
import { KEY_BINDINGS, matchesKey, resolveBinding, type KeyContext } from "../src/editor/keymap";
import { buildFeatures, HANDLE_ICON, LAYER_SPECS } from "../src/map/layers";
import { buildOverpassQuery, classifyOsmWay, osmElementsToWays } from "@transitmapper/core/model/import";
import { legendEntriesFor } from "../src/share/exportLegend";
import { validateSystem } from "@transitmapper/core/model/validate";
import { estimateWayCapitalCost, formatUsdCompact } from "@transitmapper/core/model/cost";
import { LANE_KINDS, PROFILE_PRESETS, profilePresetsForWayType, WAY_FAMILIES, WAY_TYPES } from "@transitmapper/core/model/catalog";
import {
  buildProfile,
  combineProfiles,
  defaultProfileFor,
  flipProfile,
  isOneWay,
  laneCapacity,
  makeOneWay,
  makeTwoWay,
  profileWidthM,
  separateProfiles,
  travelLanes,
  directionalLanes,
  wayCapacity,
  withLaneCount,
} from "@transitmapper/core/model/profile";
import { offsetPolyline } from "@transitmapper/core/model/geo";
import { trimPath, wayLaneGeometry } from "@transitmapper/core/geometry/streets";
import {
  classifyTurn,
  collectWayTrims,
  connectorCurves,
  defaultConnectors,
  effectiveConnectors,
  incomingLanes,
  junctionGeometry,
  outgoingLanes,
} from "@transitmapper/core/geometry/junctions";
import { wayCrossings } from "@transitmapper/core/model/validate";
import { anchorOnWay, routeBetween, routePath } from "@transitmapper/core/model/routeGraph";
import { haversineMeters, snap, squareFootprint } from "@transitmapper/core/model/geo";
import type { CrossSection, LngLat, Node, Service, Way } from "@transitmapper/core/model/system";
import { armRefKey, getComponent, laneRefKey, withComponent, withoutComponent } from "@transitmapper/core/model/components";
import { buildTimetable, dwellStopsForPattern, metersAtElapsed, VEHICLE_SPEED_MPS } from "../src/map/vehicles";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(cond ? `  ok  ${name}` : `FAIL  ${name}`);
  if (!cond) failures++;
}

const store = createEditorStore();
const ed = store.getState();
const fresh = () => ed.setSystem(createEmptySystem());
const servicesOnWay = (wid: string) => store.getState().system.services.filter((s) => serviceWayIds(s).includes(wid));

// --- drawing a way creates a way + one service ---
fresh();
const a = store.getState().beginWay("lightRail", "straight");
store.getState().addWayPoint(a, [-115.24, 36.1]);
store.getState().addWayPoint(a, [-115.17, 36.16]);
store.getState().addWayPoint(a, [-115.1, 36.1]);
store.getState().finishWay();
let sys = store.getState().system;
check("way defined by 3 control points", sys.ways.find((w) => w.id === a)!.points.length === 3);
check("drawing a way creates exactly one service", sys.services.length === 1);
check("the service runs over that way", sys.services[0].patterns[0].wayIds[0] === a);

// --- multiple services share one way (the service/infra split) ---
const svc2 = store.getState().addServiceToWay(a);
check("a way can carry multiple services", servicesOnWay(a).length === 2);
check("added service is distinct", svc2 !== store.getState().system.services[0].id);

// --- bare infrastructure: bike ways carry no service (catalog-driven, no default mode) ---
fresh();
check("bike way type has no compatible service modes", modesForWayType("bike").length === 0);
const bikeWay = store.getState().beginWay("bike", "straight");
store.getState().addWayPoint(bikeWay, [-115.2, 36.1]);
store.getState().addWayPoint(bikeWay, [-115.1, 36.1]);
store.getState().finishWay();
check("drawing a bike way creates no service", store.getState().system.services.length === 0);
check("addServiceToWay on a bike way returns null", store.getState().addServiceToWay(bikeWay) === null);

// --- roads draw exactly like every other way (this is the fix: roads used to not drag) ---
fresh();
const road = store.getState().beginWay("road", "straight");
store.getState().addWayPoint(road, [-115.2, 36.1]);
store.getState().addWayPoint(road, [-115.1, 36.2]);
store.getState().finishWay();
check("road way created with 2 points via the same beginWay/addWayPoint path", store.getState().system.ways[0].points.length === 2);
// With the draft's service toggle on (the default, and always the case in
// Network view's mode-first drawing) a road still gets its line; the
// Infrastructure view's Way tool turns the toggle OFF for roads so streets
// draw as bare context — see the "bare infrastructure toggle" block below.
check("drawing a road with service enabled creates a default service (bus/BRT)", servicesOnWay(road).length === 1);
check("road defaults to the arterial class", store.getState().system.ways[0].classId === "arterial");

// --- heavy rail and light rail are physically incompatible track standards ---
{
  const heavy = modesForWayType("heavyRail").map((m) => m.id);
  const light = modesForWayType("lightRail").map((m) => m.id);
  check("subway/commuter rail ride heavy rail only", heavy.includes("subway") && heavy.includes("commuterRail"));
  check("heavy rail never carries light-rail-standard modes", !heavy.includes("lightRail") && !heavy.includes("tram"));
  check("light rail/tram never rides heavy rail", !light.includes("subway") && !light.includes("commuterRail"));
  check("monorail is a third, separate standard", modesForWayType("monorail").every((m) => m.id === "monorail"));
}

// --- a tram can street-run on a road way or use dedicated light-rail track ---
{
  const tramWayTypes = new Set(MODES.tram.wayTypeIds);
  check("tram is compatible with both dedicated light rail and street-running road", tramWayTypes.has("lightRail") && tramWayTypes.has("road"));
}

// --- a station snaps onto a way and follows it when reshaped ---
fresh();
const h = store.getState().beginWay("road", "straight");
store.getState().addWayPoint(h, [-115.24, 36.1]);
store.getState().addWayPoint(h, [-115.1, 36.1]);
store.getState().finishWay();
const s1 = snap(store.getState().system.ways, [-115.17, 36.104], 5000);
check("snap finds the nearby way", !!s1 && s1.wayId === h);
const stId = store.getState().addStation(s1!.coord, { wayId: h, t: s1!.t });
const beforeLat = store.getState().system.stations.find((s) => s.id === stId)!.coord[1];
store.getState().moveWayPoint(h, 0, [-115.24, 36.16]);
store.getState().moveWayPoint(h, 1, [-115.1, 36.16]);
const afterLat = store.getState().system.stations.find((s) => s.id === stId)!.coord[1];
check("station follows its way when reshaped", afterLat > beforeLat + 0.02);

// --- snap picks the NEAREST of several candidate ways ---
{
  fresh();
  const near = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(near, [-115.101, 36.1]);
  store.getState().addWayPoint(near, [-115.101, 36.2]);
  store.getState().finishWay();
  const far = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(far, [-115.15, 36.1]);
  store.getState().addWayPoint(far, [-115.15, 36.2]);
  store.getState().finishWay();
  const best = snap(store.getState().system.ways, [-115.1, 36.15], 50000);
  check("snap picks the nearer of two candidate ways", best?.wayId === near);
}

// --- resuming a way from its open endpoint (turnkey continuation) ---
{
  fresh();
  const rw = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(rw, [-115.2, 36.1]);
  store.getState().addWayPoint(rw, [-115.1, 36.1]);
  store.getState().finishWay();

  const endHit = nearestOpenEndpoint(store.getState().system.ways, [-115.1002, 36.1001], 500, "road");
  check("nearestOpenEndpoint finds the way's end", endHit?.wayId === rw && endHit.end === "end");
  const startHit = nearestOpenEndpoint(store.getState().system.ways, [-115.2001, 36.0999], 500, "road");
  check("nearestOpenEndpoint finds the way's start", startHit?.wayId === rw && startHit.end === "start");
  const wrongType = nearestOpenEndpoint(store.getState().system.ways, [-115.1002, 36.1001], 500, "bike");
  check("nearestOpenEndpoint respects the type filter", wrongType === null);
  const farAway = nearestOpenEndpoint(store.getState().system.ways, [-114.5, 36.1], 500, "road");
  check("nearestOpenEndpoint returns null outside the radius", farAway === null);

  // Resuming appends at the end and prepends at the start — same way, no new service.
  store.getState().resumeWay(rw);
  check("resumeWay makes it the active way without creating a new one", store.getState().activeWayId === rw && store.getState().system.ways.length === 1);
  store.getState().addWayPoint(rw, [-115.0, 36.1]);
  store.getState().insertWayPoint(rw, 0, [-115.3, 36.1]);
  const extended = store.getState().system.ways.find((w) => w.id === rw)!;
  check("extending at the end appends", extended.points[extended.points.length - 1][0] === -115.0);
  check("extending at the start prepends", extended.points[0][0] === -115.3);
  check("resuming a way never creates a second service", servicesOnWay(rw).length === 1);
}

// --- interchange emerges where a station sits on two ways' services ---
fresh();
const la = store.getState().beginWay("lightRail", "straight");
store.getState().addWayPoint(la, [-115.2, 36.1]);
store.getState().addWayPoint(la, [-115.0, 36.1]);
store.getState().finishWay();
const lb = store.getState().beginWay("road", "straight");
store.getState().addWayPoint(lb, [-115.1, 36.0]);
store.getState().addWayPoint(lb, [-115.1, 36.2]);
store.getState().finishWay();
{
  const near = new Set(servedWayIds([-115.1, 36.1], store.getState().system.ways, INTERCHANGE_METERS));
  const services = store.getState().system.services.filter((s) => serviceWayIds(s).some((w) => near.has(w)));
  check("a station at a crossing is served by two services", services.length === 2);
}

// --- deleting a way removes its services and stations ---
fresh();
const dc = store.getState().beginWay("road", "straight");
store.getState().addWayPoint(dc, [-115.2, 36.1]);
store.getState().addWayPoint(dc, [-115.0, 36.1]);
store.getState().finishWay();
store.getState().addStation([-115.1, 36.1], { wayId: dc, t: 0.5 });
store.getState().deleteWay(dc);
check("deleting a way removes its service", store.getState().system.services.length === 0);
check("deleting a way removes its stations", store.getState().system.stations.length === 0);

// --- deleting one service leaves the way and other services ---
fresh();
const kc = store.getState().beginWay("lightRail", "straight");
store.getState().addWayPoint(kc, [-115.2, 36.1]);
store.getState().addWayPoint(kc, [-115.0, 36.1]);
store.getState().finishWay();
const extra = store.getState().addServiceToWay(kc);
store.getState().deleteService(extra!);
check("deleting a service keeps the way", store.getState().system.ways.some((w) => w.id === kc));
check("deleting a service keeps the other services", servicesOnWay(kc).length === 1);

// --- removing part of a way (the eraser deletes control points) ---
{
  fresh();
  const ec = store.getState().beginWay("road", "straight");
  ([[-115.3, 36.1], [-115.2, 36.1], [-115.1, 36.1], [-115.0, 36.1]] as LngLat[]).forEach((p) => store.getState().addWayPoint(ec, p));
  store.getState().finishWay();
  const before = store.getState().system.ways.find((w) => w.id === ec)!.points.length;
  store.getState().deleteWayPoint(ec, 1);
  const w = store.getState().system.ways.find((ww) => ww.id === ec)!;
  check("deleteWayPoint removes one control point", before === 4 && w.points.length === 3);
  check("the right control point was removed", w.points[1][0] === -115.1);
}

// --- geometry: straight vs curved on a way ---
{
  fresh();
  const g = store.getState().beginWay("lightRail", "curved");
  store.getState().addWayPoint(g, [-115.2, 36.1]);
  store.getState().addWayPoint(g, [-115.16, 36.16]);
  store.getState().addWayPoint(g, [-115.1, 36.1]);
  store.getState().finishWay();
  const way = store.getState().system.ways.find((w) => w.id === g)!;
  const straight = resolveWayPath({ ...way, geometry: "straight" });
  const curved = resolveWayPath({ ...way, geometry: "curved" });
  check("curved way path is densified", curved.length > straight.length);
  check("way length > 0", wayLengthMeters(way) > 1000);
}

// --- rounded-corner curve: local support, no overshoot, exact endpoints ---
{
  const zig: LngLat[] = [[0, 0], [1, 1], [2, 0], [3, 1], [4, 0]];
  const curve = roundedCorners(zig, 0.25, 24);
  const ys = curve.map((p) => p[1]);
  const overshoot = Math.max(Math.max(...ys) - 1, 0 - Math.min(...ys));
  check("curve starts and ends exactly at the first/last control point", curve[0][0] === zig[0][0] && curve[0][1] === zig[0][1] && curve[curve.length - 1][0] === zig[4][0]);
  check(`curve barely overshoots (${overshoot.toFixed(3)})`, overshoot < 0.15);
  const near = nearestOnPath([[0, 0], [10, 0]] as LngLat[], [5, 1] as LngLat);
  check("nearestOnPath finds midpoint t≈0.5", !!near && Math.abs(near.t - 0.5) < 0.05);
}

// --- rounded-corner curve has strictly LOCAL support: moving a far-away
// control point must not reshape a corner it isn't adjacent to (this is
// exactly what a tangent-continuous spline like Catmull-Rom gets wrong — it
// leaks influence two segments out instead of one). ---
{
  const base: LngLat[] = [[0, 0], [1, 0.4], [2, 0], [3, 0.4], [4, 0], [5, 0.4], [6, 0]];
  const moved: LngLat[] = base.map((p, i) => (i === 5 ? [p[0], p[1] + 2] : p)); // move point 5 far away
  const curveBase = roundedCorners(base, 0.25, 12);
  const curveMoved = roundedCorners(moved, 0.25, 12);
  // The fillet around point 1 (index 1) depends only on points 0,1,2 — none of
  // which changed — so the first ~1/3 of the curve must be byte-identical.
  const untouchedCount = Math.floor(curveBase.length / 3);
  let identical = true;
  for (let i = 0; i < untouchedCount; i++) {
    if (curveBase[i][0] !== curveMoved[i][0] || curveBase[i][1] !== curveMoved[i][1]) identical = false;
  }
  check("moving a far control point leaves distant corners exactly unchanged", identical);
}

// --- a service's pattern can span ways of different, compatible types
// (tram: dedicated track + street-running road) ---
{
  const dedicated: Way = { id: "w1", typeId: "lightRail", points: [[-115.2, 36.1], [-115.15, 36.1]], geometry: "straight", grade: "atGrade", profile: defaultProfileFor("lightRail") };
  const streetRunning: Way = { id: "w2", typeId: "road", points: [[-115.15, 36.1], [-115.1, 36.1]], geometry: "straight", grade: "atGrade", profile: defaultProfileFor("road"), classId: "transitway" };
  const spanningService: Service = { id: "svc", name: "Tram", modeId: "tram", color: "#16a085", patterns: [{ id: "p1", wayIds: ["w1", "w2"] }] };
  const totalLength = wayLengthMeters(dedicated) + wayLengthMeters(streetRunning);
  check("a service's pattern can span a dedicated way and a street-running road", serviceWayIds(spanningService).length === 2);
  check("length sums correctly across mixed way types", totalLength > 0);
}

// --- fork ---
fresh();
{
  const fa = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(fa, [-115.2, 36.1]);
  store.getState().addWayPoint(fa, [-115.0, 36.1]);
  store.getState().finishWay();
}
sys = store.getState().system;
const forked = forkSystem(sys);
check("fork has new id + copy name", forked.id !== sys.id && forked.name.includes("(copy)"));

// --- parse: v3 round-trips ways/services/station anchor ---
{
  fresh();
  const pc = store.getState().beginWay("lightRail", "curved");
  store.getState().addWayPoint(pc, [-115.2, 36.1]);
  store.getState().addWayPoint(pc, [-115.1, 36.15]);
  store.getState().finishWay();
  store.getState().addServiceToWay(pc);
  store.getState().addStation([-115.15, 36.12], { wayId: pc, t: 0.4 });
  const before = store.getState().system;
  const round = parseSystem(JSON.parse(JSON.stringify(before)));
  check("parse round-trips ways", round.ways.length === before.ways.length);
  check("parse round-trips services", round.services.length === 2);
  check("parse round-trips station anchor (wayId)", round.stations[0].anchor?.wayId === pc);
}

// --- migration: v2 corridors infer heavyRail/lightRail/monorail/road from the service mode ---
{
  const v2 = {
    version: 2,
    id: "old2",
    name: "V2 system",
    viewport: { center: [-115.17, 36.13], zoom: 10 },
    createdAt: 1,
    updatedAt: 1,
    stations: [],
    corridors: [
      { id: "c-subway", points: [[-115.2, 36.1], [-115.1, 36.1]], geometry: "straight", grade: "atGrade" },
      { id: "c-tram", points: [[-115.2, 36.2], [-115.1, 36.2]], geometry: "straight", grade: "atGrade" },
      { id: "c-mono", points: [[-115.2, 36.3], [-115.1, 36.3]], geometry: "straight", grade: "elevated" },
    ],
    services: [
      { id: "sv1", name: "Red", mode: "subway", color: "#c0392b", corridorIds: ["c-subway"] },
      { id: "sv2", name: "Green", mode: "tram", color: "#16a085", corridorIds: ["c-tram"] },
      { id: "sv3", name: "Mono", mode: "monorail", color: "#8b5cf6", corridorIds: ["c-mono"] },
    ],
    roads: [{ id: "r1", coords: [[-115.3, 36.1], [-115.25, 36.1]], class: "collector" }],
  };
  const migrated = parseSystem(v2);
  const typeOf = (id: string) => migrated.ways.find((w) => w.id === id)?.typeId;
  check("v2 subway corridor migrates to heavyRail", typeOf("c-subway") === "heavyRail");
  check("v2 tram corridor migrates to lightRail", typeOf("c-tram") === "lightRail");
  check("v2 monorail corridor migrates to monorail", typeOf("c-mono") === "monorail");
  check("v2 road migrates to a road way with its class preserved", typeOf("r1") === "road" && migrated.ways.find((w) => w.id === "r1")?.classId === "collector");
  check("migrated services carry modeId (not mode)", migrated.services.every((s) => typeof s.modeId === "string"));
}

// --- parse: legacy v1 (lines) migrates to a typed way + service ---
{
  const legacy = {
    version: 1,
    id: "old",
    name: "Legacy",
    viewport: { center: [-115.17, 36.13], zoom: 10 },
    createdAt: 1,
    updatedAt: 1,
    stations: [{ id: "s1", coord: [-115.15, 36.12], anchor: { lineId: "l1", t: 0.5 } }],
    lines: [{ id: "l1", name: "Old Line", mode: "lightRail", color: "#e4572e", points: [[-115.2, 36.1], [-115.1, 36.15]], geometry: "curved" }],
    roads: [],
  };
  const m = parseSystem(legacy);
  check("legacy line → one way", m.ways.length === 1 && m.ways[0].id === "l1");
  check("legacy lightRail line → lightRail way type", m.ways[0].typeId === "lightRail");
  check("legacy line → one service on that way", m.services.length === 1 && m.services[0].patterns[0].wayIds[0] === "l1");
  check("legacy service keeps color/name", m.services[0].color === "#e4572e" && m.services[0].name === "Old Line");
  check("legacy station anchor migrated lineId → wayId", m.stations[0].anchor?.wayId === "l1");
}

// --- modes + grade (infrastructure vertical alignment) ---
{
  fresh();
  const gc = store.getState().beginWay("heavyRail", "straight");
  store.getState().addWayPoint(gc, [-115.2, 36.1]);
  store.getState().addWayPoint(gc, [-115.0, 36.1]);
  store.getState().finishWay();
  const svc = store.getState().system.services.find((s) => serviceWayIds(s).includes(gc))!;
  check("subway is a valid mode", svc.modeId === "subway" || modesForWayType("heavyRail").some((m) => m.id === svc.modeId));
  const way = () => store.getState().system.ways.find((w) => w.id === gc)!;
  check("way defaults to at grade", way().grade === "atGrade");
  store.getState().setWayGrade(gc, "underground");
  check("setWayGrade sets the grade", way().grade === "underground");
  const round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
  check("parse round-trips way grade", round.ways[0].grade === "underground");
  const noGrade = parseSystem({
    version: 3, id: "x", name: "x", viewport: { center: [-115, 36], zoom: 10 }, createdAt: 1, updatedAt: 1,
    ways: [{ id: "w", typeId: "lightRail", points: [[-115.2, 36.1], [-115.1, 36.1]], geometry: "straight" }],
    services: [], stations: [], facilities: [], groups: [],
  });
  check("parse defaults missing grade to at grade", noGrade.ways[0].grade === "atGrade");
  check("parse defaults missing capacity from the way type's catalog default", wayCapacity(noGrade.ways[0]) === wayType("lightRail").defaultCapacity);
}

// --- P2: physical cross-sections — capacity fans a way into that many
// parallel lane/track features, Infrastructure-view only ---
{
  fresh();
  const road = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(road, [-115.2, 36.1]);
  store.getState().addWayPoint(road, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().setWayCapacity(road, 4);
  check("setWayCapacity updates the way", wayCapacity(store.getState().system.ways.find((w) => w.id === road)!) === 4);
  store.getState().setWayCapacity(road, 0);
  check("setWayCapacity clamps to a minimum of 1", wayCapacity(store.getState().system.ways.find((w) => w.id === road)!) === 1);
  store.getState().setWayCapacity(road, 4);

  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(["road"]) };
  const infra = buildFeatures(store.getState().system, null, [], { viewMode: "infrastructure", ...filters });
  const roadFeatures = infra.ways.features.filter((f) => f.properties?.id === road);
  check("infrastructure view fans a 4-lane road into 4 offset features", roadFeatures.length === 4);
  const offsets = new Set(roadFeatures.map((f) => f.properties?.offset));
  check("each lane gets a distinct offset", offsets.size === 4);

  // Network view is service-focused — a bare road's infra line (unserved) is
  // hidden entirely, and a road's own infra line stays hidden even once
  // served (only the colored service line shows) — capacity never fans out.
  const net = buildFeatures(store.getState().system, null, [], { viewMode: "network", ...filters });
  check("network view hides a bare way's infra line regardless of capacity", net.ways.features.filter((f) => f.properties?.id === road).length === 0);
  const svc = store.getState().addServiceToWay(road)!;
  const netServed = buildFeatures(store.getState().system, null, [], { viewMode: "network", ...filters });
  check("network view keeps a served way's infra line hidden too", netServed.ways.features.filter((f) => f.properties?.id === road).length === 0);
  check("network view renders the service itself regardless of capacity", netServed.services.features.some((f) => f.properties?.serviceId === svc));
}

// --- P3: station footprints & platforms ---
{
  fresh();
  const stId = store.getState().addStation([-115.15, 36.1]);
  check("station starts with no footprint", store.getState().system.stations[0].footprint === undefined);
  store.getState().addStationFootprint(stId);
  const withFootprint = () => store.getState().system.stations.find((s) => s.id === stId)!;
  check("addStationFootprint gives it a 4-corner default square", withFootprint().footprint?.length === 4);
  const square = squareFootprint([-115.15, 36.1], 30);
  check("squareFootprint is centered on its input coord", Math.abs((square[0][0] + square[2][0]) / 2 - -115.15) < 1e-9);

  store.getState().moveFootprintPoint(stId, 0, [-115.1501, 36.1001]);
  check("moveFootprintPoint edits one corner", withFootprint().footprint![0][0] === -115.1501);

  const platformId = store.getState().addPlatform(stId);
  check("addPlatform adds a platform to the station", withFootprint().platforms?.length === 1 && withFootprint().platforms![0].id === platformId);
  store.getState().movePlatformPoint(stId, platformId, 1, [-115.14, 36.09]);
  check("movePlatformPoint edits one platform corner", withFootprint().platforms![0].points[1][0] === -115.14);
  store.getState().deletePlatform(stId, platformId);
  check("deletePlatform removes it", withFootprint().platforms?.length === 0);

  store.getState().deleteStationFootprint(stId);
  check("deleteStationFootprint clears the footprint (and any platforms)", withFootprint().footprint === undefined);
}

// --- P3: catalog-typed facilities ---
{
  fresh();
  const facId = store.getState().addFacility("bikeDock", [-115.16, 36.12]);
  check("addFacility creates it and selects it", store.getState().system.facilities.length === 1 && store.getState().selection?.kind === "facility");
  check("facility keeps its catalog type", store.getState().system.facilities[0].typeId === "bikeDock");
  store.getState().moveFacility(facId, [-115.161, 36.121]);
  check("moveFacility updates its geometry", (store.getState().system.facilities[0].geometry as LngLat)[0] === -115.161);
  store.getState().setFacilityName(facId, "Main entrance dock");
  check("setFacilityName renames it", store.getState().system.facilities[0].name === "Main entrance dock");
  store.getState().deleteFacility(facId);
  check("deleteFacility removes it and clears the selection", store.getState().system.facilities.length === 0 && store.getState().selection === null);
}

// --- P3: grouping (station complexes / line families) ---
{
  fresh();
  const a = store.getState().addStation([-115.2, 36.1]);
  const b = store.getState().addStation([-115.2001, 36.1001]);
  const c = store.getState().addStation([-115.2002, 36.1002]);
  const groupId = store.getState().createGroup([a, b], "Downtown complex");
  check("createGroup bundles the given members", store.getState().system.groups[0].memberIds.length === 2);
  store.getState().addGroupMember(groupId, c);
  check("addGroupMember adds a third member", store.getState().system.groups[0].memberIds.includes(c));
  store.getState().addGroupMember(groupId, c);
  check("addGroupMember is idempotent (no duplicate)", store.getState().system.groups[0].memberIds.filter((m) => m === c).length === 1);
  store.getState().removeGroupMember(groupId, b);
  check("removeGroupMember removes just that member", !store.getState().system.groups[0].memberIds.includes(b) && store.getState().system.groups[0].memberIds.includes(a));
  store.getState().renameGroup(groupId, "Renamed complex");
  check("renameGroup renames it", store.getState().system.groups[0].name === "Renamed complex");
  store.getState().deleteGroup(groupId);
  check("deleteGroup removes it", store.getState().system.groups.length === 0);
}

// --- Facility complexes: draw-a-boundary-first editor (task 22) ---
{
  fresh();
  const drawnRing: LngLat[] = [[-115.19, 36.12], [-115.17, 36.12], [-115.17, 36.14], [-115.19, 36.14]];
  const groupId = store.getState().createFacilityComplex(drawnRing);
  check("createFacilityComplex creates a footprint-having group and selects it", store.getState().system.groups.length === 1 && store.getState().selection?.kind === "group" && store.getState().selection?.id === groupId);
  check("the new complex's footprint is exactly the boundary that was drawn", store.getState().system.groups[0].footprint?.length === 4);
  check("the new complex starts with no members", store.getState().system.groups[0].memberIds.length === 0);
  check("createFacilityComplex assigns a color from the palette", !!store.getState().system.groups[0].color);

  store.getState().moveGroupFootprintPoint(groupId, 0, [-115.1801, 36.1301]);
  check("moveGroupFootprintPoint edits one corner", store.getState().system.groups[0].footprint![0][0] === -115.1801);

  store.getState().startPlacingFacility(groupId);
  check("startPlacingFacility arms placement and switches to the facility tool", store.getState().placingFacilityForGroupId === groupId && store.getState().tool === "facility");
  const facId = store.getState().placeFacilityInGroup(groupId, "busBay", [-115.179, 36.129]);
  check("placeFacilityInGroup creates the facility", store.getState().system.facilities.some((f) => f.id === facId && f.typeId === "busBay"));
  check("placeFacilityInGroup joins it to the complex", store.getState().system.groups[0].memberIds.includes(facId));
  check("placeFacilityInGroup disarms placement and returns to select", store.getState().placingFacilityForGroupId === null && store.getState().tool === "select");
  check("placeFacilityInGroup keeps the complex selected (not the new facility)", store.getState().selection?.kind === "group" && store.getState().selection?.id === groupId);

  const looseStation = store.getState().addStation([-115.181, 36.131]);
  store.getState().startPickingMember(groupId);
  check("startPickingMember arms picking", store.getState().pickingMemberForGroupId === groupId);
  store.getState().addGroupMember(groupId, looseStation);
  store.getState().cancelPickingMember();
  check("picking flow (addGroupMember + cancel) adds the existing station and disarms", store.getState().system.groups[0].memberIds.includes(looseStation) && store.getState().pickingMemberForGroupId === null);

  store.getState().deleteGroupFootprint(groupId);
  check("deleteGroupFootprint clears the footprint but keeps members", store.getState().system.groups[0].footprint === undefined && store.getState().system.groups[0].memberIds.length === 2);

  store.getState().addGroupFootprint(groupId);
  check("addGroupFootprint re-adds a default footprint", store.getState().system.groups[0].footprint?.length === 4);
}

// --- Plain (footprint-less) groups still work — a facility complex is an
// opt-in specialization, not a required shape for every group ---
{
  fresh();
  const a = store.getState().addStation([-115.2, 36.1]);
  const b = store.getState().addStation([-115.2001, 36.1001]);
  const groupId = store.getState().createGroup([a, b], "Transfer complex");
  check("a plain group has no footprint", store.getState().system.groups[0].footprint === undefined);
}

// --- On-map labels: name flows into station/facility feature properties ---
{
  fresh();
  const namedId = store.getState().addStation([-115.16, 36.12]);
  store.getState().setStationName(namedId, "Downtown");
  const unnamedId = store.getState().addStation([-115.17, 36.13]);
  const facId = store.getState().addFacility("depot", [-115.18, 36.14]);
  store.getState().setFacilityName(facId, "Maintenance Yard");
  const unnamedFacId = store.getState().addFacility("entrance", [-115.19, 36.15]);

  const view = { viewMode: "network" as const, visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set<string>() };
  const net = buildFeatures(store.getState().system, null, [], view);
  const namedStationFeature = net.stations.features.find((f) => f.properties?.id === namedId);
  const unnamedStationFeature = net.stations.features.find((f) => f.properties?.id === unnamedId);
  check("a named station's feature carries its name (network view too)", namedStationFeature?.properties?.name === "Downtown");
  check("an unnamed station's feature has an empty-string name, not undefined", unnamedStationFeature?.properties?.name === "");

  const infra = buildFeatures(store.getState().system, null, [], { ...view, viewMode: "infrastructure" });
  const namedFacFeature = infra.facilities.features.find((f) => f.properties?.id === facId);
  const unnamedFacFeature = infra.facilities.features.find((f) => f.properties?.id === unnamedFacId);
  check("a named facility's feature carries its name", namedFacFeature?.properties?.name === "Maintenance Yard");
  check("an unnamed facility's feature has an empty-string name, not undefined", unnamedFacFeature?.properties?.name === "");
}

// --- P3: footprints/platforms/facilities render in Infrastructure view only ---
{
  fresh();
  const stId = store.getState().addStation([-115.15, 36.1]);
  store.getState().addStationFootprint(stId);
  store.getState().addPlatform(stId);
  store.getState().addFacility("entrance", [-115.151, 36.101]);
  // Empty way-type filter on purpose — footprints/platforms/facilities render
  // independent of way-type visibility, only gated by view mode.
  const emptyView = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set<string>() };
  const infra = buildFeatures(store.getState().system, null, [], { viewMode: "infrastructure", ...emptyView }, stId);
  check("infrastructure view renders the footprint polygon", infra.footprints.features.length === 1);
  check("infrastructure view renders the platform polygon", infra.platforms.features.length === 1);
  check("infrastructure view renders the facility point", infra.facilities.features.length === 1);
  check("physicalHandleStationId renders that station's footprint+platform vertices", infra.physicalHandles.features.length === 4 + 4);

  const net = buildFeatures(store.getState().system, null, [], { viewMode: "network", ...emptyView }, stId);
  check("network view hides footprints", net.footprints.features.length === 0);
  check("network view hides platforms", net.platforms.features.length === 0);
  check("network view hides facilities", net.facilities.features.length === 0);
  check("network view hides physical handles too", net.physicalHandles.features.length === 0);

  const groupId = store.getState().createFacilityComplex([[-115.2, 36.13], [-115.18, 36.13], [-115.18, 36.15], [-115.2, 36.15]]);
  const infraWithGroup = buildFeatures(store.getState().system, null, [], { viewMode: "infrastructure", ...emptyView }, null, groupId);
  check("infrastructure view renders a group's footprint polygon too", infraWithGroup.footprints.features.length === 2); // station's + group's
  check("physicalHandleGroupId renders that group's footprint vertices", infraWithGroup.physicalHandles.features.length === 4);
  const infraGroupUnselected = buildFeatures(store.getState().system, null, [], { viewMode: "infrastructure", ...emptyView }, null, null);
  check("a group's footprint still renders when it isn't the active handle owner", infraGroupUnselected.footprints.features.length === 2);
  check("but its handles don't, without physicalHandleGroupId", infraGroupUnselected.physicalHandles.features.length === 0);
}

// --- P3: v3 serialize round-trips footprints, platforms, facilities, groups ---
{
  fresh();
  const stId = store.getState().addStation([-115.15, 36.1]);
  store.getState().addStationFootprint(stId);
  store.getState().addPlatform(stId);
  store.getState().addFacility("depot", [-115.16, 36.11]);
  const other = store.getState().addStation([-115.17, 36.12]);
  store.getState().createGroup([stId, other], "Complex");
  const round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
  check("parse round-trips a station footprint", round.stations.find((s) => s.id === stId)?.footprint?.length === 4);
  check("parse round-trips platforms", round.stations.find((s) => s.id === stId)?.platforms?.length === 1);
  check("parse round-trips facilities", round.facilities.length === 1 && round.facilities[0].typeId === "depot");
  check("parse round-trips groups", round.groups.length === 1 && round.groups[0].memberIds.length === 2);

  // A facility complex's footprint + color used to be silently dropped by
  // parseSystem (never read at all) — real data loss on save/reload.
  const complexId = store.getState().createFacilityComplex([[-115.2, 36.13], [-115.18, 36.13], [-115.18, 36.15], [-115.2, 36.15]]);
  const roundComplex = parseSystem(JSON.parse(JSON.stringify(store.getState().system))).groups.find((g) => g.id === complexId);
  check("parse round-trips a facility complex's footprint", roundComplex?.footprint?.length === 4);
  check("parse round-trips a facility complex's color", roundComplex?.color === store.getState().system.groups.find((g) => g.id === complexId)!.color);
}

// --- Junction primitive: joinWayPointToWay forms a real shared-coordinate
// node, and every way-editing action keeps its refs in sync ---
{
  fresh();
  // Way A: a straight line the junction will land on mid-segment.
  const wA = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(wA, [-115.2, 36.1]);
  store.getState().addWayPoint(wA, [-115.1, 36.1]);
  store.getState().finishWay();
  // Way B ends exactly where A's midpoint is — join them.
  const wB = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(wB, [-115.15, 36.2]);
  store.getState().addWayPoint(wB, [-115.15, 36.1]);
  store.getState().finishWay();
  store.getState().joinWayPointToWay(wB, 1, wA, [-115.15, 36.1]);

  let s = store.getState().system;
  check("joinWayPointToWay inserts a real control point into the target way", s.ways.find((w) => w.id === wA)!.points.length === 3);
  check("the inserted point lands at the join coordinate", s.ways.find((w) => w.id === wA)!.points[1][0] === -115.15);
  check("exactly one node was created", s.nodes.length === 1);
  const node = s.nodes[0];
  check("the node links both ways' points", node.refs.length === 2 && node.refs.some((r) => r.wayId === wA) && node.refs.some((r) => r.wayId === wB));

  // Moving the junction (on EITHER way) must cascade to the other — the exact
  // bug the plan doc calls out ("junctions silently desync when you edit them").
  store.getState().moveWayPoint(wB, 1, [-115.16, 36.05]);
  s = store.getState().system;
  check(
    "moving the shared point on one way also moves it on the other (no desync)",
    s.ways.find((w) => w.id === wA)!.points[1][0] === -115.16 && s.ways.find((w) => w.id === wB)!.points[1][0] === -115.16,
  );
  check("the node's own coord tracks the cascaded move too", s.nodes[0].coord[0] === -115.16);

  // Inserting a point earlier in way A must shift the node's ref index, not
  // leave it pointing at the wrong (now-shifted) point.
  store.getState().insertWayPoint(wA, 0, [-115.22, 36.09]);
  s = store.getState().system;
  const wARef = s.nodes[0].refs.find((r) => r.wayId === wA)!;
  check("insertWayPoint shifts the node's ref index on that way", wARef.pointIndex === 2);
  check("the ref still points at the actual junction point after the shift", s.ways.find((w) => w.id === wA)!.points[wARef.pointIndex][0] === -115.16);

  // Deleting the OTHER end of way A (not the junction point) must not disturb
  // the node's ref into way A, only reindex it.
  store.getState().deleteWayPoint(wA, 0);
  s = store.getState().system;
  const wARef2 = s.nodes[0].refs.find((r) => r.wayId === wA)!;
  check("deleteWayPoint before the node's index shifts it back down", wARef2.pointIndex === 1);
  check("node survives an unrelated point deletion", s.nodes.length === 1);

  // Deleting the junction's OWN point on one way should drop that way's ref
  // and, since only one ref remains, the node stops being a junction at all.
  const wBRefIndex = s.nodes[0].refs.find((r) => r.wayId === wB)!.pointIndex;
  store.getState().deleteWayPoint(wB, wBRefIndex);
  s = store.getState().system;
  check("deleting the shared point on one way drops the node (no longer a real junction)", s.nodes.length === 0);

  // deleteWay must strip any surviving refs to the removed way.
  fresh();
  const wC = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(wC, [-115.2, 36.1]);
  store.getState().addWayPoint(wC, [-115.1, 36.1]);
  store.getState().finishWay();
  const wD = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(wD, [-115.15, 36.2]);
  store.getState().addWayPoint(wD, [-115.15, 36.1]);
  store.getState().finishWay();
  store.getState().joinWayPointToWay(wD, 1, wC, [-115.15, 36.1]);
  check("setup: node exists before delete", store.getState().system.nodes.length === 1);
  store.getState().deleteWay(wC);
  check("deleteWay removes the node once its junction partner is gone", store.getState().system.nodes.length === 0);

  // v3→v4 migration derives nodes from raw coordinate coincidence when a
  // loaded system has no explicit nodes field.
  const legacyRound = parseSystem({
    version: 3,
    id: "x",
    name: "x",
    viewport: { center: [-115, 36], zoom: 10 },
    createdAt: 1,
    updatedAt: 1,
    ways: [
      { id: "p", typeId: "lightRail", points: [[-115.2, 36.1], [-115.1, 36.1]], geometry: "straight" },
      { id: "q", typeId: "lightRail", points: [[-115.1, 36.1], [-115.1, 36.2]], geometry: "straight" },
    ],
    services: [],
    stations: [],
    facilities: [],
    groups: [],
  });
  check("migrated v3 data derives a node from coincident way endpoints", legacyRound.nodes.length === 1 && legacyRound.nodes[0].refs.length === 2);

  // A system round-tripped through JSON keeps its explicit v4 nodes intact.
  fresh();
  const wE = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(wE, [-115.2, 36.1]);
  store.getState().addWayPoint(wE, [-115.1, 36.1]);
  store.getState().finishWay();
  const wF = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(wF, [-115.15, 36.2]);
  store.getState().addWayPoint(wF, [-115.15, 36.1]);
  store.getState().finishWay();
  store.getState().joinWayPointToWay(wF, 1, wE, [-115.15, 36.1]);
  const v4Round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
  check("v4 round-trip preserves the explicit node", v4Round.nodes.length === 1 && v4Round.nodes[0].refs.length === 2);
}

// --- multi-select: toggle, bulk move (nudge), bulk delete ---
{
  fresh();
  const wayA = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(wayA, [-115.2, 36.1]);
  store.getState().addWayPoint(wayA, [-115.1, 36.1]);
  store.getState().finishWay();
  const stId = store.getState().addStation([-115.25, 36.05]); // free-floating, not anchored to wayA
  const facId = store.getState().addFacility("entrance", [-115.15, 36.2]);

  store.getState().toggleMultiSelect({ kind: "way", id: wayA });
  store.getState().toggleMultiSelect({ kind: "station", id: stId });
  check("toggleMultiSelect builds up the group", store.getState().multiSelection.length === 2);
  check("multi-select clears the single Inspector selection", store.getState().selection === null);

  store.getState().toggleMultiSelect({ kind: "station", id: stId });
  check("toggling an already-selected item removes it", store.getState().multiSelection.length === 1);
  store.getState().toggleMultiSelect({ kind: "station", id: stId });
  store.getState().toggleMultiSelect({ kind: "facility", id: facId });
  check("group now has all 3 kinds", store.getState().multiSelection.length === 3);

  const before = store.getState().system;
  store.getState().nudgeMultiSelection(0.01, 0.02);
  let s = store.getState().system;
  check("nudge moves every point of a selected way", s.ways.find((w) => w.id === wayA)!.points[0][0] === before.ways.find((w) => w.id === wayA)!.points[0][0] + 0.01);
  check("nudge moves a selected free-floating station", s.stations.find((st) => st.id === stId)!.coord[0] === before.stations.find((st) => st.id === stId)!.coord[0] + 0.01);
  check("nudge moves a selected facility's point geometry", (s.facilities.find((f) => f.id === facId)!.geometry as [number, number])[1] === (before.facilities.find((f) => f.id === facId)!.geometry as [number, number])[1] + 0.02);

  // A station anchored to a way that's ALSO in the group must not be
  // double-moved — it already follows via the way's own reanchor.
  const anchoredSt = store.getState().addStation([-115.15, 36.1], { wayId: wayA, t: 0.5 });
  store.getState().toggleMultiSelect({ kind: "station", id: anchoredSt });
  const wayPointBefore = store.getState().system.ways.find((w) => w.id === wayA)!.points[0];
  store.getState().nudgeMultiSelection(0.005, 0.005);
  s = store.getState().system;
  const expectedCoord = pointAtT(resolveWayPath(s.ways.find((w) => w.id === wayA)!), 0.5);
  const actualCoord = s.stations.find((st) => st.id === anchoredSt)!.coord;
  check(
    "a station anchored to a co-selected way follows the way's own reanchor, not a second direct nudge",
    Math.abs(actualCoord[0] - expectedCoord[0]) < 1e-9 && Math.abs(actualCoord[1] - expectedCoord[1]) < 1e-9,
  );
  check("the way itself did move", s.ways.find((w) => w.id === wayA)!.points[0][0] !== wayPointBefore[0]);

  check("group still has 4 members before bulk delete", store.getState().multiSelection.length === 4);
  store.getState().deleteMultiSelection();
  s = store.getState().system;
  check("bulk delete removes the way", !s.ways.some((w) => w.id === wayA));
  check("bulk delete removes both stations", !s.stations.some((st) => st.id === stId || st.id === anchoredSt));
  check("bulk delete removes the facility", !s.facilities.some((f) => f.id === facId));
  check("bulk delete clears the group", store.getState().multiSelection.length === 0);
}

// --- splitWayAt: splits infrastructure, keeps riding services whole,
// re-snaps stations, and links the split point as a real junction ---
{
  fresh();
  const trunk = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(trunk, [-115.3, 36.1]);
  store.getState().addWayPoint(trunk, [-115.2, 36.1]);
  store.getState().addWayPoint(trunk, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().setWayGrade(trunk, "underground");
  const svc = store.getState().system.services.find((sv) => serviceWayIds(sv).includes(trunk))!.id;
  // A station riding each half, so the re-snap can be checked on both sides.
  const westStop = store.getState().addStation([-115.25, 36.1], { wayId: trunk, t: 0.25 });
  const eastStop = store.getState().addStation([-115.15, 36.1], { wayId: trunk, t: 0.75 });

  store.getState().splitWayAt(trunk, 1); // split at the middle control point
  let s = store.getState().system;
  check("splitWayAt produces exactly one new way", s.ways.length === 2);
  const wayA = s.ways.find((w) => w.id === trunk)!;
  const wayB = s.ways.find((w) => w.id !== trunk)!;
  check("the first half keeps the original id and its first 2 points", wayA.points.length === 2);
  check("the second half gets a new id with the remaining 2 points", wayB.points.length === 2);
  check("the second half inherits grade/type from the original", wayB.grade === "underground" && wayB.typeId === "lightRail");

  const service = s.services.find((sv) => sv.id === svc)!;
  const svcWayIds = service.patterns[0].wayIds;
  check("the riding service's pattern now runs over both halves, in order", svcWayIds.length === 2 && svcWayIds[0] === trunk && svcWayIds[1] === wayB.id);

  check("the split point becomes a real junction node", s.nodes.some((n) => n.refs.length === 2 && n.refs.some((r) => r.wayId === trunk) && n.refs.some((r) => r.wayId === wayB.id)));

  const west = s.stations.find((st) => st.id === westStop)!;
  const east = s.stations.find((st) => st.id === eastStop)!;
  check("a station west of the split re-snaps onto the first half", west.anchor?.wayId === trunk);
  check("a station east of the split re-snaps onto the second half", east.anchor?.wayId === wayB.id);

  // Moving the shared split point still cascades to both halves (it's a
  // real Node now, not just two ways that happen to touch).
  store.getState().moveWayPoint(trunk, 1, [-115.2, 36.05]);
  s = store.getState().system;
  check(
    "the split point still cascades on move, like any other junction",
    s.ways.find((w) => w.id === trunk)!.points[1][1] === 36.05 && s.ways.find((w) => w.id === wayB.id)!.points[0][1] === 36.05,
  );

  // Splitting at an endpoint (nothing to split off) is a documented no-op.
  fresh();
  const short = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(short, [-115.2, 36.1]);
  store.getState().addWayPoint(short, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().splitWayAt(short, 0);
  check("splitting at an endpoint is a no-op", store.getState().system.ways.length === 1);
}

// --- Service frequency + span: additive fields, round-trip through parse ---
{
  fresh();
  const wayId = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(wayId, [-115.2, 36.1]);
  store.getState().addWayPoint(wayId, [-115.1, 36.1]);
  store.getState().finishWay();
  const svcId = store.getState().system.services[0].id;
  // A fresh line now seeds a sensible default headway (see store.ts's
  // DEFAULT_FREQUENCY_MINUTES) instead of starting unset.
  check("frequency starts at the default headway", store.getState().system.services[0].frequencyMinutes === 10);
  store.getState().setServiceFrequency(svcId, 8);
  store.getState().setServiceSpan(svcId, "05:00", "01:00");
  let svc = store.getState().system.services.find((s) => s.id === svcId)!;
  check("setServiceFrequency sets the peak headway", svc.frequencyMinutes === 8);
  check("setServiceSpan sets start/end", svc.spanStart === "05:00" && svc.spanEnd === "01:00");
  const round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
  svc = round.services.find((s) => s.id === svcId)!;
  check("frequency/span round-trip through parse", svc.frequencyMinutes === 8 && svc.spanStart === "05:00" && svc.spanEnd === "01:00");
  store.getState().setServiceFrequency(svcId, undefined);
  check("frequency can be cleared back to unset", store.getState().system.services.find((s) => s.id === svcId)!.frequencyMinutes === undefined);
}

// --- service patterns/branches: a service can have 2+ paths sharing one
// identity, drawn via startAddingPattern/finishWay, rendered as one shared
// line on a common trunk and separate lines past the branch point ---
{
  fresh();
  const trunk = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(trunk, [-115.3, 36.1]);
  store.getState().addWayPoint(trunk, [-115.1, 36.1]);
  store.getState().finishWay();
  const svcId = store.getState().system.services.find((sv) => serviceWayIds(sv).includes(trunk))!.id;
  check("service starts with exactly one pattern", store.getState().system.services.find((s) => s.id === svcId)!.patterns.length === 1);

  store.getState().startAddingPattern(svcId);
  check("startAddingPattern arms the flag and switches to the way tool", store.getState().addingPatternForServiceId === svcId && store.getState().tool === "way");

  // Draw a fresh way for the branch — it should NOT spawn its own service.
  const branchWay = store.getState().beginWay("lightRail", "straight");
  check("drawing while armed creates no second service", store.getState().system.services.length === 1);
  store.getState().addWayPoint(branchWay, [-115.2, 36.1]);
  store.getState().addWayPoint(branchWay, [-115.15, 36.2]);
  store.getState().finishWay();

  let svc = store.getState().system.services.find((s) => s.id === svcId)!;
  check("finishing the draw attaches a second pattern on the same service", svc.patterns.length === 2);
  check("the new pattern rides the branch way", svc.patterns[1].wayIds.includes(branchWay));
  check("finishWay disarms addingPatternForServiceId", store.getState().addingPatternForServiceId === null);
  check("still exactly one service (a branch, not a new line)", store.getState().system.services.length === 1);

  // Rendering: the shared trunk way carries this ONE service once, not twice,
  // even though both patterns technically "include" it via serviceWayIds.
  const view = { viewMode: "network" as const, visibleModes: new Set(MODE_ORDER), visibleWayTypes: new Set(["lightRail"]) };
  const fc = buildFeatures(store.getState().system, null, [], view);
  const trunkFeatures = fc.services.features.filter((f) => (f.properties as { wayId: string }).wayId === trunk);
  check("the shared trunk renders as exactly one service line, not doubled by the branch", trunkFeatures.length === 1);
  const branchFeatures = fc.services.features.filter((f) => (f.properties as { wayId: string }).wayId === branchWay);
  check("the branch-only way renders its own service line too", branchFeatures.length === 1);

  // Cancel: no-op on the model, just clears the flag.
  store.getState().startAddingPattern(svcId);
  store.getState().cancelAddingPattern();
  check("cancelAddingPattern clears the flag without adding a pattern", store.getState().addingPatternForServiceId === null && store.getState().system.services.find((s) => s.id === svcId)!.patterns.length === 2);

  // deletePattern: no-op with only 1 pattern left, real otherwise.
  const onlyPatternId = store.getState().system.services.find((s) => s.id === svcId)!.patterns[0].id;
  store.getState().deletePattern(svcId, store.getState().system.services.find((s) => s.id === svcId)!.patterns[1].id);
  svc = store.getState().system.services.find((s) => s.id === svcId)!;
  check("deletePattern removes a branch when 2+ patterns exist", svc.patterns.length === 1 && svc.patterns[0].id === onlyPatternId);
  store.getState().deletePattern(svcId, onlyPatternId);
  check("deletePattern refuses to remove a service's last pattern", store.getState().system.services.find((s) => s.id === svcId)!.patterns.length === 1);

  // v4-shape (flat wayIds, no patterns) migrates into one pattern.
  const legacyV4 = parseSystem({
    version: 4,
    id: "x",
    name: "x",
    viewport: { center: [-115, 36], zoom: 10 },
    createdAt: 1,
    updatedAt: 1,
    ways: [{ id: "w", typeId: "lightRail", points: [[-115.2, 36.1], [-115.1, 36.1]], geometry: "straight" }],
    services: [{ id: "s1", name: "Old", modeId: "lightRail", color: "#e4572e", wayIds: ["w"] }],
    stations: [],
    facilities: [],
    groups: [],
    nodes: [],
  });
  check("a v4 flat-wayIds service migrates into a single pattern", legacyV4.services[0].patterns.length === 1 && legacyV4.services[0].patterns[0].wayIds[0] === "w");

  // A service with zero patterns is a ghost, same as the old empty-wayIds case.
  fresh();
  const ghostWay = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(ghostWay, [-115.2, 36.1]);
  store.getState().addWayPoint(ghostWay, [-115.1, 36.1]);
  store.getState().finishWay();
  const ghostSvcId = store.getState().system.services[0].id;
  store.getState().deleteWay(ghostWay); // drops the way, and with it the service's only pattern
  check("removeWay drops a now-patternless service entirely", !store.getState().system.services.some((s) => s.id === ghostSvcId));
}

// --- validateSystem: ghost records + crossing-without-joining ---
{
  fresh();
  check("a clean fresh system has no issues", validateSystem(store.getState().system).length === 0);

  // A way with fewer than 2 points is a ghost: accepted, invisible. finishWay
  // already discards a way that's still sub-2-point at draw time (see
  // store.ts), so the only way one exists is a finished way later shrunk by
  // deleteWayPoint (e.g. Alt-click erasing down to one point).
  fresh();
  const ghostWay = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(ghostWay, [-115.2, 36.1]);
  store.getState().addWayPoint(ghostWay, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().deleteWayPoint(ghostWay, 0);
  let issues = validateSystem(store.getState().system);
  check("flags a sub-2-point way", issues.some((i) => i.id === `ghost-way-${ghostWay}`));

  // An orphaned station: anchor points at a way id that doesn't exist.
  fresh();
  const stId = store.getState().addStation([-115.15, 36.1], { wayId: "nonexistent", t: 0.5 });
  issues = validateSystem(store.getState().system);
  check("flags a station anchored to a missing way", issues.some((i) => i.id === `orphan-station-${stId}`));

  // Two ways that genuinely cross without joining should be flagged; the
  // same two, once joined via a Node, should not be. Built via importWays —
  // drawing them would auto-form the junction at finishWay now, leaving no
  // unjoined crossing to flag.
  fresh();
  const wX = "vx";
  const wY = "vy";
  store.getState().importWays([
    { id: wX, typeId: "lightRail", points: [[-115.2, 36.1], [-115.1, 36.1]], geometry: "straight", grade: "atGrade", profile: defaultProfileFor("lightRail") },
    { id: wY, typeId: "lightRail", points: [[-115.15, 36.05], [-115.15, 36.15]], geometry: "straight", grade: "atGrade", profile: defaultProfileFor("lightRail") },
  ]);
  issues = validateSystem(store.getState().system);
  check("flags two ways that cross without joining", issues.some((i) => i.id.startsWith("crossing-")));

  store.getState().joinWayPointToWay(wY, 1, wX, [-115.15, 36.1]);
  issues = validateSystem(store.getState().system);
  check("does not flag a crossing once the two ways share a real junction", !issues.some((i) => i.id.startsWith("crossing-")));

  // Parallel ways that never cross at all: no false positive.
  fresh();
  const wP = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(wP, [-115.2, 36.1]);
  store.getState().addWayPoint(wP, [-115.1, 36.1]);
  store.getState().finishWay();
  const wQ = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(wQ, [-115.2, 36.11]);
  store.getState().addWayPoint(wQ, [-115.1, 36.11]);
  store.getState().finishWay();
  check("parallel, non-crossing ways raise no crossing issue", !validateSystem(store.getState().system).some((i) => i.id.startsWith("crossing-")));
}

// --- Capital cost-per-mile: a labeled range, not a fake-precise figure ---
{
  fresh();
  check("formatUsdCompact renders billions", formatUsdCompact(1_250_000_000) === "$1.3B");
  check("formatUsdCompact renders millions", formatUsdCompact(45_000_000) === "$45M");
  check("formatUsdCompact renders sub-10M millions with one decimal", formatUsdCompact(4_500_000) === "$4.5M");
  check("formatUsdCompact renders thousands", formatUsdCompact(2_500) === "$3K");

  const heavy = store.getState().beginWay("heavyRail", "straight");
  store.getState().addWayPoint(heavy, [-115.2, 36.1]);
  store.getState().addWayPoint(heavy, [-115.1, 36.1]); // ~9.2km ≈ 5.7mi at this latitude
  store.getState().finishWay();
  store.getState().setWayGrade(heavy, "underground");
  const heavyWay = store.getState().system.ways.find((w) => w.id === heavy)!;
  const heavyCost = estimateWayCapitalCost(heavyWay);
  check("underground heavy rail gets a cost estimate", heavyCost !== null);
  check("cost total scales with length (low < high)", heavyCost !== null && heavyCost.totalLowUsd < heavyCost.totalHighUsd);
  check(
    "total roughly equals per-mile rate × way length",
    heavyCost !== null && Math.abs(heavyCost.totalLowUsd - heavyCost.perMileLowUsd * (wayLengthMeters(heavyWay) / 1609.344)) < 1,
  );

  const ferry = store.getState().beginWay("water", "straight");
  store.getState().addWayPoint(ferry, [-115.2, 36.1]);
  store.getState().addWayPoint(ferry, [-115.1, 36.1]);
  store.getState().finishWay();
  check(
    "a ferry route (no linear right-of-way cost concept) gets no estimate, not a misleading number",
    estimateWayCapitalCost(store.getState().system.ways.find((w) => w.id === ferry)!) === null,
  );
}

// --- Export: systemBounds + legend entries (the "full-system export" fix) ---
{
  fresh();
  check("systemBounds is null for an empty system", systemBounds(store.getState().system) === null);

  const wayId = store.getState().beginWay("heavyRail", "straight");
  store.getState().addWayPoint(wayId, [-115.2, 36.1]);
  store.getState().addWayPoint(wayId, [-115.1, 36.2]);
  store.getState().finishWay();
  const stId = store.getState().addStation([-115.25, 36.05]);
  store.getState().addStationFootprint(stId); // extends the bbox further southwest
  const facId = store.getState().addFacility("depot", [-115.05, 36.25]); // extends northeast

  const bounds = systemBounds(store.getState().system);
  check("systemBounds returns [sw, ne]", bounds !== null);
  if (bounds) {
    const [[minLng, minLat], [maxLng, maxLat]] = bounds;
    check("systemBounds' west/south edge is west/south of every point", minLng < -115.25 && minLat < 36.05);
    check("systemBounds' east/north edge is east/north of every point", maxLng >= -115.05 && maxLat >= 36.25);
  }
  store.getState().deleteFacility(facId);

  const view = { viewMode: "network" as const, visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(["heavyRail"]) };
  const expectedName = store.getState().system.services[0]?.name;
  const legend = legendEntriesFor(store.getState().system, view);
  check("legendEntriesFor lists one entry per visible service", legend.length === 1 && legend[0].label === expectedName);
  const hiddenModeView = { ...view, visibleModes: new Set<string>() };
  check("legendEntriesFor respects the mode filter", legendEntriesFor(store.getState().system, hiddenModeView).length === 0);
}

// --- P4: OSM import — pure, network-free transforms ---
{
  check("classifyOsmWay maps railway=rail to heavyRail", classifyOsmWay({ railway: "rail" })?.typeId === "heavyRail");
  check("classifyOsmWay maps railway=subway to heavyRail too (same track standard)", classifyOsmWay({ railway: "subway" })?.typeId === "heavyRail");
  check("classifyOsmWay maps railway=tram to lightRail", classifyOsmWay({ railway: "tram" })?.typeId === "lightRail");
  const primaryRoad = classifyOsmWay({ highway: "primary" });
  check("classifyOsmWay maps highway=primary to a road with arterial class", primaryRoad?.typeId === "road" && primaryRoad.classId === "arterial");
  check("classifyOsmWay maps highway=cycleway to bike", classifyOsmWay({ highway: "cycleway" })?.typeId === "bike");
  check("classifyOsmWay returns null for an uninteresting tag set", classifyOsmWay({ building: "yes" }) === null);
  check("classifyOsmWay returns null with no tags at all", classifyOsmWay(undefined) === null);

  const query = buildOverpassQuery({ west: -115.3, south: 36.0, east: -115.0, north: 36.2 }, ["road", "lightRail"]);
  check("buildOverpassQuery embeds the bounding box", query.includes("36,-115.3,36.2,-115"));
  check("buildOverpassQuery only includes requested categories", query.includes("highway") && query.includes("light_rail") && !query.includes('"railway"~"^(rail|subway)$"'));

  const elements = [
    { type: "way", id: 1, tags: { highway: "residential" }, geometry: [{ lat: 36.1, lon: -115.2 }, { lat: 36.11, lon: -115.19 }] },
    { type: "way", id: 2, tags: { railway: "tram" }, geometry: [{ lat: 36.1, lon: -115.2 }, { lat: 36.12, lon: -115.18 }] },
    { type: "way", id: 3, tags: { building: "yes" }, geometry: [{ lat: 36.1, lon: -115.2 }, { lat: 36.11, lon: -115.19 }] }, // filtered out
    { type: "way", id: 4, tags: { highway: "residential" }, geometry: [{ lat: 36.1, lon: -115.2 }] }, // filtered out: single point
    { type: "node", id: 5, tags: { highway: "residential" } }, // filtered out: not a way
  ];
  const ways = osmElementsToWays(elements);
  check("osmElementsToWays keeps only recognized, ≥2-point ways", ways.length === 2);
  check("osmElementsToWays tags each way with its OSM source", ways.every((w) => w.source?.startsWith("osm:")));
  check("osmElementsToWays preserves [lon,lat] → LngLat point order", ways[0].points[0][0] === -115.2 && ways[0].points[0][1] === 36.1);
  check("osmElementsToWays assigns the residential road its local class", ways[0].typeId === "road" && ways[0].classId === "local");
  check("osmElementsToWays defaults capacity from the way type's catalog default", wayCapacity(ways[1]) === wayType("lightRail").defaultCapacity);
}

// --- P4: importWays store action appends bare infrastructure, no auto-service ---
{
  fresh();
  const imported: Way[] = [
    { id: "osm-a", typeId: "road", points: [[-115.2, 36.1], [-115.1, 36.1]], geometry: "straight", grade: "atGrade", profile: defaultProfileFor("road"), classId: "local", source: "osm:123" },
  ];
  store.getState().importWays(imported);
  check("importWays appends the way", store.getState().system.ways.some((w) => w.id === "osm-a"));
  check("importWays creates no service for it (bare infrastructure)", store.getState().system.services.length === 0);
  check("imported way keeps its OSM source marker", store.getState().system.ways.find((w) => w.id === "osm-a")?.source === "osm:123");
}

// --- keyboard: matcher, resolver, command execution, gating ---
{
  const evt = (o: Partial<KeyboardEvent>) => o as KeyboardEvent;
  check("matchesKey is case-insensitive & reserves Ctrl", matchesKey(evt({ key: "V" }), "v") && !matchesKey(evt({ key: "c", ctrlKey: true }), "c"));

  const ctx = { map: { panBy() {}, zoomTo() {}, getZoom: () => 10 }, editor: store, setPanKeyHeld() {}, openShortcuts() {}, toggleUi() {} } as unknown as KeyContext;
  fresh();
  store.getState().setTool("way");
  const kc2 = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(kc2, [-115.2, 36.1]);
  store.getState().addWayPoint(kc2, [-115.1, 36.1]);
  resolveBinding(KEY_BINDINGS, evt({ key: "Escape" }), ctx)?.run(ctx);
  check("Escape command stops the current way draw", !store.getState().activeWayId);
  resolveBinding(KEY_BINDINGS, evt({ key: "l" }), ctx)?.run(ctx);
  check("'l' selects the way tool", store.getState().tool === "way");
  store.getState().setSystem(store.getState().system, { readOnly: true });
  check("way-tool binding gated in read-only", resolveBinding(KEY_BINDINGS, evt({ key: "l" }), ctx) === null);
}

// --- undo/redo: basic push/pop, redo invalidation, readOnly/empty guards ---
{
  fresh();
  check("fresh system starts with nothing to undo/redo", !store.getState().canUndo && !store.getState().canRedo);

  const stationId = store.getState().addStation([-115.2, 36.1]);
  check("adding a station is undoable", store.getState().canUndo);
  store.getState().undo();
  check("undo removes the station", !store.getState().system.stations.some((s) => s.id === stationId));
  check("undo clears selection (avoids pointing at a gone/stale object)", store.getState().selection === null);
  check("undoing the only step leaves nothing left to undo", !store.getState().canUndo);
  check("undo makes a redo available", store.getState().canRedo);

  store.getState().redo();
  check("redo restores the station", store.getState().system.stations.some((s) => s.id === stationId));
  check("redoing the only step leaves nothing left to redo", !store.getState().canRedo);

  store.getState().undo();
  store.getState().addStation([-115.3, 36.2]); // a fresh action after undo invalidates redo
  check("a new action after undo clears the redo stack", !store.getState().canRedo);

  check("undo on an empty stack is a no-op, not a crash", (() => {
    fresh();
    store.getState().undo();
    return !store.getState().canUndo;
  })());

  fresh();
  store.getState().addStation([-115.2, 36.1]);
  store.getState().setSystem(store.getState().system, { readOnly: true });
  check("loading a system (even the same one) resets history", !store.getState().canUndo && !store.getState().canRedo);

  // Regression: setViewport (camera pan/zoom, persisted on the system for
  // sharing) must NOT create an undo step — otherwise every pan buries real
  // edits under viewport noise, and pressing Ctrl+Z mostly just un-pans.
  fresh();
  check("panning alone starts with nothing to undo", !store.getState().canUndo);
  store.getState().setViewport({ center: [-115.5, 36.5], zoom: 12 });
  check("setViewport does not create an undo step", !store.getState().canUndo);
  store.getState().addStation([-115.2, 36.1]);
  check("a real edit after panning is still undoable", store.getState().canUndo);
  store.getState().setViewport({ center: [-115.6, 36.6], zoom: 13 });
  check("panning after a real edit doesn't add a second (viewport) undo step", (() => {
    let steps = 0;
    while (store.getState().canUndo) {
      store.getState().undo();
      steps++;
    }
    return steps === 1;
  })());
}

// --- undo/redo: gesture checkpoints coalesce into one step, discard no-ops ---
{
  fresh();
  const wayId = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(wayId, [-115.2, 36.1]);
  store.getState().addWayPoint(wayId, [-115.1, 36.1]);
  const stepsBeforeDrag = countUndoSteps();

  store.getState().beginHistoryCheckpoint();
  store.getState().moveWayPoint(wayId, 1, [-115.05, 36.1]);
  store.getState().moveWayPoint(wayId, 1, [-115.02, 36.15]);
  store.getState().moveWayPoint(wayId, 1, [-115.0, 36.2]);
  store.getState().commitHistoryCheckpoint();
  check("a whole drag (many moves) coalesces into exactly one undo step", countUndoSteps() === stepsBeforeDrag + 1);

  const movedPoint = store.getState().system.ways.find((w) => w.id === wayId)!.points[1];
  store.getState().undo();
  const revertedPoint = store.getState().system.ways.find((w) => w.id === wayId)!.points[1];
  check("undoing the coalesced drag reverts to before the whole drag, not one move step", revertedPoint[0] === -115.1 && revertedPoint[1] === 36.1 && movedPoint[0] === -115.0);

  // A cancelled drag that reverts to the exact original value shouldn't
  // create a phantom undo step — this is what an Escape-cancelled gesture
  // looks like from the store's side (see interactions.ts).
  store.getState().redo();
  const stepsBeforeNoOpDrag = countUndoSteps();
  const original = store.getState().system.ways.find((w) => w.id === wayId)!.points[1];
  store.getState().beginHistoryCheckpoint();
  store.getState().moveWayPoint(wayId, 1, [-114.9, 36.3]);
  store.getState().moveWayPoint(wayId, 1, original); // the gesture's own cancel-revert
  store.getState().commitHistoryCheckpoint();
  check("a checkpoint that nets no change (cancel-revert) pushes no undo step", countUndoSteps() === stepsBeforeNoOpDrag);

  function countUndoSteps(): number {
    let n = 0;
    while (store.getState().canUndo) {
      store.getState().undo();
      n++;
    }
    for (let i = 0; i < n; i++) store.getState().redo();
    return n;
  }
}

// --- keyboard: mod (Ctrl/Cmd) bindings for undo/redo don't collide with plain ones ---
{
  const evt = (o: Partial<KeyboardEvent>) => o as KeyboardEvent;
  check("plain 'z' still matches the non-mod zoom-in binding", matchesKey(evt({ key: "z" }), "z"));
  check("Ctrl+Z does not match a plain (mod-less) binding", !matchesKey(evt({ key: "z", ctrlKey: true }), "z"));
  check("Ctrl+Z matches a mod:true binding", matchesKey(evt({ key: "z", ctrlKey: true }), "z", true));
  check("plain Z (no Ctrl) does not match a mod:true binding", !matchesKey(evt({ key: "z" }), "z", true));
  check("Ctrl+Shift+Z does not match the mod:true/shift:false Undo binding", !matchesKey(evt({ key: "z", ctrlKey: true, shiftKey: true }), "z", true, false));
  check("Ctrl+Shift+Z matches the mod:true/shift:true Redo binding", matchesKey(evt({ key: "z", ctrlKey: true, shiftKey: true }), "z", true, true));

  const ctx = { map: { panBy() {}, zoomTo() {}, getZoom: () => 10 }, editor: store, setPanKeyHeld() {}, openShortcuts() {}, toggleUi() {} } as unknown as KeyContext;
  fresh();
  check("Undo binding is gated by canUndo", resolveBinding(KEY_BINDINGS, evt({ key: "z", ctrlKey: true }), ctx) === null);
  store.getState().addStation([-115.2, 36.1]);
  const undone = resolveBinding(KEY_BINDINGS, evt({ key: "z", ctrlKey: true }), ctx);
  check("Ctrl+Z resolves to the Undo binding once there's something to undo", undone?.description === "Undo");
  undone?.run(ctx);
  check("running the resolved Undo binding actually undoes", store.getState().system.stations.length === 0);
  const redone = resolveBinding(KEY_BINDINGS, evt({ key: "z", ctrlKey: true, shiftKey: true }), ctx);
  check("Ctrl+Shift+Z resolves to the Redo binding", redone?.description === "Redo");
  redone?.run(ctx);
  check("running the resolved Redo binding actually redoes", store.getState().system.stations.length === 1);
}

// --- keyboard: UI-hide toggle ---
{
  const evt = (o: Partial<KeyboardEvent>) => o as KeyboardEvent;
  let toggled = 0;
  const ctx = {
    map: { panBy() {}, zoomTo() {}, getZoom: () => 10 },
    editor: store,
    setPanKeyHeld() {},
    openShortcuts() {},
    toggleUi() { toggled++; },
  } as unknown as KeyContext;
  const binding = resolveBinding(KEY_BINDINGS, evt({ key: "\\" }), ctx);
  check("backslash resolves to the Show/hide UI binding", binding?.description === "Show/hide UI");
  binding?.run(ctx);
  check("running it calls toggleUi", toggled === 1);
}

// --- marker differentiation: handles and every facility type each get a
// distinct icon, so nothing on the map collapses to an interchangeable dot ---
{
  fresh();
  const road = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(road, [-115.2, 36.1]);
  store.getState().addWayPoint(road, [-115.1, 36.1]);
  store.getState().finishWay();
  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(["road"]) };
  const withHandles = buildFeatures(store.getState().system, null, [road], { viewMode: "infrastructure", ...filters });
  check("way interior handles use the shared square control-point icon", withHandles.handles.features.every((f) => f.properties?.icon === HANDLE_ICON));

  const iconsSeen = new Set<string>();
  for (const typeId of FACILITY_TYPE_ORDER) {
    store.getState().addFacility(typeId, [-115.15, 36.1]);
  }
  const infra = buildFeatures(store.getState().system, null, [], { viewMode: "infrastructure", ...filters });
  for (const f of infra.facilities.features) {
    const icon = f.properties?.icon as string;
    check(`facility "${f.properties?.typeId}" has an icon`, typeof icon === "string" && icon.length > 0);
    iconsSeen.add(icon);
  }
  check("every facility type gets its own distinct icon (none share one)", iconsSeen.size === FACILITY_TYPE_ORDER.length);
}

// --- performance: resolveWayPath memoizes per way object (drag perf) ---
{
  const way: Way = { id: "w", typeId: "lightRail", points: [[-115.2, 36.1], [-115.15, 36.13], [-115.1, 36.1]], geometry: "curved", grade: "atGrade", profile: defaultProfileFor("lightRail") };
  const first = resolveWayPath(way);
  const second = resolveWayPath(way);
  check("resolveWayPath returns the identical cached array for the same way object", first === second);
  const changed: Way = { ...way, points: [...way.points, [-115.05, 36.15]] };
  const third = resolveWayPath(changed);
  check("resolveWayPath recomputes for a genuinely different way object", third !== first && third.length > first.length);
}

// --- Diagram view: computeDiagramSystem snaps the graph to a schematic
// octolinear layout without losing topology or crashing on edge cases ---
{
  const angleSnapErrorRad = (p1: [number, number] | number[], p2: [number, number] | number[]): number => {
    const [dx, dy] = metersFromOrigin(p1 as [number, number], p2 as [number, number]);
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 4;
    return Math.abs(angle - Math.round(angle / step) * step);
  };

  fresh();
  const dwA = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(dwA, [-115.2, 36.1]);
  store.getState().addWayPoint(dwA, [-115.1, 36.1]);
  store.getState().finishWay();
  const dwB = store.getState().beginWay("lightRail", "straight");
  store.getState().addWayPoint(dwB, [-115.15, 36.2]);
  store.getState().addWayPoint(dwB, [-115.15, 36.1]);
  store.getState().finishWay();
  // Joins B onto A's midpoint — A gets a genuine interior node, not just an
  // endpoint junction, exercising the harder case (see joinWayPointToWay).
  store.getState().joinWayPointToWay(dwB, 1, dwA, [-115.15, 36.1]);
  const dwStationId = store.getState().addStation([-115.15, 36.15], { wayId: dwB, t: 0.5 });

  const real = store.getState().system;
  const diagram = computeDiagramSystem(real);

  check("diagram preserves the way count", diagram.ways.length === real.ways.length);
  check("diagram preserves the station count", diagram.stations.length === real.stations.length);
  check("every diagram way is straight geometry", diagram.ways.every((w) => w.geometry === "straight"));

  const diagA = diagram.ways.find((w) => w.id === dwA)!;
  const diagB = diagram.ways.find((w) => w.id === dwB)!;
  const bJunctionCoord = diagB.points[diagB.points.length - 1];
  check(
    "the shared junction lands on the exact same schematic coordinate on both ways (no desync)",
    diagA.points.some((p) => p[0] === bJunctionCoord[0] && p[1] === bJunctionCoord[1]),
  );
  check("a node-bearing way keeps an interior vertex (start, junction, end)", diagA.points.length === 3);

  const diagStation = diagram.stations.find((s) => s.id === dwStationId)!;
  const onPath = nearestOnPath(diagB.points, diagStation.coord);
  check("an anchored station still sits on its way's new schematic path", onPath !== null && onPath.distMeters < 1);

  let maxAngleError = 0;
  for (const w of diagram.ways) {
    for (let i = 1; i < w.points.length; i++) {
      maxAngleError = Math.max(maxAngleError, angleSnapErrorRad(w.points[i - 1], w.points[i]));
    }
  }
  check("every schematic edge lands close to a 45° multiple", maxAngleError < 0.05);

  check("computeDiagramSystem is memoized by system reference", computeDiagramSystem(real) === diagram);

  const empty = createEmptySystem();
  check("computeDiagramSystem on an empty system doesn't crash and stays empty", computeDiagramSystem(empty).ways.length === 0);

  fresh();
  const soloWay = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(soloWay, [-115.2, 36.1]);
  store.getState().addWayPoint(soloWay, [-115.19, 36.1003]);
  store.getState().finishWay();
  const soloDiagram = computeDiagramSystem(store.getState().system);
  check("a single unjoined way still gets a valid 2-point straightened path", soloDiagram.ways[0].points.length === 2);
}

// --- Way tool double-click-to-finish must not place a duplicate point —
// see isDoubleClickFinish's own comment for the exact bug this guards
// against (a native double-click's second mousedown independently placing
// another point at ~the same spot the first one just did) ---
{
  check("a plain single click (detail 1) still starts a draw press", !isDoubleClickFinish(1));
  check("the double-click's second press (detail 2) is skipped", isDoubleClickFinish(2));
  check("even a rapid triple-click's third press stays skipped", isDoubleClickFinish(3));
}

// ===========================================================================
// R1: lane-level cross-sections, junction semantics, shared identity
// ===========================================================================

// --- catalog: every way type carries lane data; no hardcoded kinds ---
{
  for (const type of Object.values(WAY_TYPES)) {
    check(`way type "${type.id}" has a default profile`, type.defaultProfile.length > 0);
    check(
      `way type "${type.id}"'s default profile only uses its allowed lane kinds`,
      type.defaultProfile.every((l) => type.laneKindIds.includes(l.kindId)),
    );
    check(`way type "${type.id}"'s primary lane kind is allowed`, type.laneKindIds.includes(type.primaryLaneKindId));
    check(
      `way type "${type.id}"'s default profile capacity matches its defaultCapacity`,
      laneCapacity(buildProfile(type.defaultProfile)) === type.defaultCapacity,
    );
    check(`way family "${type.family}" has an identity noun`, WAY_FAMILIES[type.family].identityNoun.length > 0);
  }
  for (const preset of Object.values(PROFILE_PRESETS)) {
    const type = WAY_TYPES[preset.wayTypeId];
    check(`preset "${preset.id}" targets a real way type`, !!type);
    check(`preset "${preset.id}" only uses lane kinds its way type allows`, preset.lanes.every((l) => type.laneKindIds.includes(l.kindId)));
  }
  check("road offers profile presets", profilePresetsForWayType("road").length >= 5);
  check("pedestrian way type exists (pedestrian-only paths are a catalog entry)", !!WAY_TYPES.pedestrian);
  check("pedestrian default profile is a walking lane, not a special case", WAY_TYPES.pedestrian.defaultProfile[0].kindId === "sidewalk");
}

// --- profile ops ---
{
  const road = defaultProfileFor("road", 4);
  check("defaultProfileFor(road, 4) carries 4 counted lanes", laneCapacity(road) === 4);
  check("default 4-lane road splits 2 backward / 2 forward", travelLanes(road).filter((l) => l.direction === "forward" && l.kindId === "drive").length === 2);
  check("lane ids are unique within a profile", new Set(road.lanes.map((l) => l.id)).size === road.lanes.length);
  check("profile width sums lane widths", Math.abs(profileWidthM(road) - road.lanes.reduce((s, l) => s + l.widthM, 0)) < 1e-9);

  const odd = defaultProfileFor("road", 5);
  check("odd capacity puts the extra lane forward", odd.lanes.filter((l) => l.kindId === "drive" && l.direction === "forward").length === 3);
  const single = defaultProfileFor("road", 1);
  check("capacity 1 becomes one bidirectional lane", travelLanes(single).filter((l) => l.kindId === "drive").every((l) => l.direction === "both"));

  const flipped = flipProfile(road);
  check("flipProfile reverses lane order", flipped.lanes[0].id === road.lanes[road.lanes.length - 1].id);
  check("flipProfile swaps directions", flipped.lanes.every((l) => {
    const orig = road.lanes.find((o) => o.id === l.id)!;
    return orig.direction === "forward" ? l.direction === "backward" : orig.direction === "backward" ? l.direction === "forward" : l.direction === orig.direction;
  }));
  check("flipProfile twice is identity", JSON.stringify(flipProfile(flipped)) === JSON.stringify(road));

  const oneWay = makeOneWay(road, "forward");
  check("makeOneWay makes every travel lane forward", isOneWay(oneWay));
  check("makeOneWay leaves separators/edges alone", oneWay.lanes.filter((l) => l.kindId === "sidewalk").every((l) => l.direction === "both"));
  const twoWay = makeTwoWay(oneWay);
  check("makeTwoWay restores a directional split", !isOneWay(twoWay) && travelLanes(twoWay).some((l) => l.direction === "backward"));

  const widened = withLaneCount(road, "road", 6);
  check("withLaneCount grows to the target", laneCapacity(widened) === 6);
  const fwd6 = widened.lanes.filter((l) => l.kindId === "drive" && l.direction === "forward").length;
  check("withLaneCount keeps the directional split balanced", fwd6 === 3);
  const narrowed = withLaneCount(widened, "road", 2);
  check("withLaneCount shrinks to the target", laneCapacity(narrowed) === 2);
  check("withLaneCount(1) floors at one lane", laneCapacity(withLaneCount(road, "road", 0)) === 1);
  const oneWayWidened = withLaneCount(makeOneWay(defaultProfileFor("road", 2), "forward"), "road", 3);
  check("widening a one-way road stays one-way", isOneWay(oneWayWidened) && laneCapacity(oneWayWidened) === 3);
}

// --- carriageway separation / combination (profile level) ---
{
  const boulevard = buildProfile(PROFILE_PRESETS.roadBoulevard.lanes);
  const sep = separateProfiles(boulevard)!;
  check("separateProfiles splits a divided boulevard", !!sep);
  check("forward carriageway is one-way forward", isOneWay(sep.forward) && directionalLanes(sep.forward).every((l) => l.direction === "forward"));
  check("backward carriageway is one-way backward", directionalLanes(sep.backward).every((l) => l.direction === "backward"));
  check("the median itself is dropped (the physical gap replaces it)", [...sep.forward.lanes, ...sep.backward.lanes].every((l) => l.kindId !== "median"));
  check("each carriageway keeps its own side's bike lane", sep.forward.lanes.some((l) => l.kindId === "bike") && sep.backward.lanes.some((l) => l.kindId === "bike"));
  check("separateProfiles refuses a one-way profile", separateProfiles(makeOneWay(boulevard, "forward")) === null);

  const recombined = combineProfiles(sep.backward, sep.forward);
  check("combineProfiles restores two-way travel", !isOneWay(recombined) && travelLanes(recombined).some((l) => l.direction === "forward") && travelLanes(recombined).some((l) => l.direction === "backward"));
  check("combineProfiles inserts a median between the halves", recombined.lanes.some((l) => l.kindId === "median"));
  const recombinedKind = combineProfiles(sep.backward, sep.forward, 5, "railReservation");
  check("combineProfiles accepts a captured width/kind instead of the catalog default", recombinedKind.lanes.some((l) => l.kindId === "railReservation" && l.widthM === 5));
}

// --- ECS-shaped component registry (model/components.ts) ---
{
  const empty: Record<string, { n: number }> = {};
  const withA = withComponent(empty, "a", { n: 1 });
  check("withComponent adds without mutating the original map", empty.a === undefined && withA.a?.n === 1);
  check("getComponent reads a present key", getComponent(withA, "a")?.n === 1);
  check("getComponent reads an absent key as undefined", getComponent(withA, "b") === undefined);
  const withB = withComponent(withA, "b", { n: 2 });
  const withoutA = withoutComponent(withB, "a");
  check("withoutComponent removes only the given key", withoutA.a === undefined && withoutA.b?.n === 2);
  check("withoutComponent on an absent key is a no-op (same reference)", withoutComponent(withB, "z") === withB);
  check("laneRefKey/armRefKey format lane and arm references", laneRefKey("w1", "l1") === "w1:l1" && armRefKey("w1", "start") === "w1:start");
}

// --- driving side (model/profile.ts) — target-way/kind identity, never an
// angle bucket, is what makes turn restrictions robust; drivingSide is the
// one place actual left/right geometry matters, and it's isolated to these
// three functions. ---
{
  // separateProfiles: which array-half becomes which carriageway flips.
  const customProfile: CrossSection = {
    lanes: [
      { id: "s1", kindId: "shoulder", widthM: 2, direction: "none" },
      { id: "d1", kindId: "drive", widthM: 3.3, direction: "backward" },
      { id: "d2", kindId: "drive", widthM: 3.3, direction: "forward" },
      { id: "p1", kindId: "parking", widthM: 2, direction: "none" },
    ],
  };
  const rightSep = separateProfiles(customProfile, "right")!;
  const leftSep = separateProfiles(customProfile, "left")!;
  check(
    "separateProfiles(right): backward carriageway keeps the array-left half",
    rightSep.backward.lanes.some((l) => l.kindId === "shoulder") && rightSep.forward.lanes.some((l) => l.kindId === "parking"),
  );
  check(
    "separateProfiles(left): mirrored — forward carriageway keeps the array-left half",
    leftSep.forward.lanes.some((l) => l.kindId === "shoulder") && leftSep.backward.lanes.some((l) => l.kindId === "parking"),
  );

  // makeTwoWay: which half gets which direction flips.
  const oneWay4 = makeOneWay(defaultProfileFor("road", 4), "forward");
  const rightTwoWay = makeTwoWay(oneWay4, "right");
  const leftTwoWay = makeTwoWay(oneWay4, "left");
  const rightDirs = directionalLanes(rightTwoWay).map((l) => l.direction);
  const leftDirs = directionalLanes(leftTwoWay).map((l) => l.direction);
  check("makeTwoWay(right) puts backward lanes first (array-left)", rightDirs[0] === "backward" && rightDirs[rightDirs.length - 1] === "forward");
  check("makeTwoWay(left) mirrors: forward lanes first", leftDirs[0] === "forward" && leftDirs[leftDirs.length - 1] === "backward");
  check("makeTwoWay driving side changes direction assignment only, not lane count", rightTwoWay.lanes.length === leftTwoWay.lanes.length);
  check("makeTwoWay defaults to right-hand traffic (matches pre-existing behavior)", JSON.stringify(makeTwoWay(oneWay4).lanes) === JSON.stringify(rightTwoWay.lanes));

  // withLaneCount: which side a new lane inserts on flips.
  const twoLane: CrossSection = {
    lanes: [
      { id: "b1", kindId: "drive", widthM: 3.3, direction: "backward" },
      { id: "f1", kindId: "drive", widthM: 3.3, direction: "forward" },
    ],
  };
  const grownRight = withLaneCount(twoLane, "road", 3, "right");
  const grownLeft = withLaneCount(twoLane, "road", 3, "left");
  check(
    "withLaneCount(right) inserts the new forward lane at the end",
    grownRight.lanes[0].id === "b1" && grownRight.lanes[grownRight.lanes.length - 1].direction === "forward" && grownRight.lanes[grownRight.lanes.length - 1].id !== "f1",
  );
  check(
    "withLaneCount(left) mirrors: inserts the new forward lane at the front",
    grownLeft.lanes[0].direction === "forward" && grownLeft.lanes[0].id !== "f1" && grownLeft.lanes.some((l) => l.id === "b1"),
  );
}

// --- offsetPolyline (the carriageway/lane offset primitive) ---
{
  const line: LngLat[] = [[-115.2, 36.1], [-115.1, 36.1]]; // due east
  const right = offsetPolyline(line, 10);
  const [, dyMeters] = [0, (right[0][1] - line[0][1]) * 111320];
  check("offsetPolyline(+) shifts right of travel (south when heading east)", dyMeters < -9 && dyMeters > -11);
  const left = offsetPolyline(line, -10);
  check("offsetPolyline(−) shifts left of travel", (left[0][1] - line[0][1]) * 111320 > 9);
  const bent: LngLat[] = [[-115.2, 36.1], [-115.15, 36.1], [-115.15, 36.15]];
  const bentOff = offsetPolyline(bent, 5);
  check("offsetPolyline keeps the vertex count", bentOff.length === bent.length);
}

// --- v6 migration: capacity+class → profile; round-trips ---
{
  const v5ish = parseSystem({
    version: 5, id: "m", name: "m", viewport: { center: [-115, 36], zoom: 10 }, createdAt: 1, updatedAt: 1,
    ways: [
      { id: "r", typeId: "road", points: [[-115.2, 36.1], [-115.1, 36.1]], geometry: "straight", grade: "atGrade", capacity: 6, classId: "arterial" },
      { id: "t", typeId: "heavyRail", points: [[-115.2, 36.2], [-115.1, 36.2]], geometry: "straight", grade: "atGrade", capacity: 2 },
    ],
    services: [], stations: [], facilities: [], groups: [],
  });
  check("v5 road capacity 6 migrates to a 6-lane profile", wayCapacity(v5ish.ways[0]) === 6);
  check("migrated road keeps sidewalks from the type's default profile", v5ish.ways[0].profile.lanes.some((l) => l.kindId === "sidewalk"));
  check("v5 rail capacity 2 migrates to a 2-track profile", wayCapacity(v5ish.ways[1]) === 2 && v5ish.ways[1].profile.lanes.every((l) => l.kindId === "track"));
  check("migrated system lands on the current schema version", v5ish.version === createEmptySystem().version);
  check("migrated system has an empty namedWays list", Array.isArray(v5ish.namedWays) && v5ish.namedWays.length === 0);

  const round = parseSystem(JSON.parse(JSON.stringify(v5ish)));
  check("v6 profile round-trips exactly", JSON.stringify(round.ways[0].profile) === JSON.stringify(v5ish.ways[0].profile));

  // Node control/connectors round-trip, with bad connectors dropped.
  const laneA = v5ish.ways[0].profile.lanes[1].id;
  const laneB = v5ish.ways[1].profile.lanes[0].id;
  const withNode = {
    ...JSON.parse(JSON.stringify(v5ish)),
    ways: JSON.parse(JSON.stringify(v5ish.ways)).map((w: Way) => ({ ...w, points: [[-115.2, 36.1], [-115.1, 36.1]] })),
    nodes: [
      {
        id: "n1",
        coord: [-115.2, 36.1],
        refs: [{ wayId: "r", pointIndex: 0 }, { wayId: "t", pointIndex: 0 }],
        control: "signal",
        connectors: [
          { from: { wayId: "r", laneId: laneA }, to: { wayId: "t", laneId: laneB } },
          { from: { wayId: "r", laneId: "nope" }, to: { wayId: "t", laneId: laneB } },
        ],
      },
    ],
  };
  const parsedNode = parseSystem(withNode).nodes[0];
  check("node control round-trips", parsedNode?.control === "signal");
  check("valid lane connectors round-trip", parsedNode?.connectors?.length === 1);
  check("connectors naming unknown lanes are dropped", !parsedNode?.connectors?.some((c) => c.from.laneId === "nope"));
}

// --- store: profile editing, presets ---
{
  fresh();
  const r = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(r, [-115.2, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().applyProfilePreset(r, "roadBoulevard");
  const way = store.getState().system.ways.find((w) => w.id === r)!;
  check("applyProfilePreset installs the preset's lanes", way.profile.lanes.some((l) => l.kindId === "median") && way.profile.lanes.some((l) => l.kindId === "bike"));
  check("applyProfilePreset takes the preset's class", way.classId === "arterial");
  const custom = { lanes: way.profile.lanes.map((l) => (l.kindId === "drive" ? { ...l, widthM: 3.05 } : l)) };
  store.getState().setWayProfile(r, custom);
  check("setWayProfile replaces the cross-section", store.getState().system.ways.find((w) => w.id === r)!.profile.lanes.every((l) => l.kindId !== "drive" || l.widthM === 3.05));
}

// --- store: shared identity (NamedWay) ---
{
  fresh();
  const a = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(a, [-115.2, 36.1]);
  store.getState().addWayPoint(a, [-115.1, 36.1]);
  store.getState().finishWay();
  const b = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(b, [-115.2, 36.11]);
  store.getState().addWayPoint(b, [-115.1, 36.11]);
  store.getState().finishWay();

  store.getState().nameWay(a, "Decatur Avenue");
  check("naming a way creates a shared identity", store.getState().system.namedWays.some((n) => n.name === "Decatur Avenue" && n.wayIds.includes(a)));
  store.getState().nameWay(b, "Decatur Avenue");
  check("naming a second way with the same name joins the identity", store.getState().system.namedWays.filter((n) => n.name === "Decatur Avenue").length === 1 && store.getState().system.namedWays[0].wayIds.length === 2);
  store.getState().nameWay(a, "Decatur Ave");
  check("renaming through one member renames the shared identity", store.getState().system.namedWays[0].name === "Decatur Ave" && store.getState().system.namedWays[0].wayIds.length === 2);
  store.getState().nameWay(b, "");
  check("an empty name removes the way from its identity", !store.getState().system.namedWays[0]?.wayIds.includes(b));
  store.getState().deleteWay(a);
  check("deleting the last member deletes the identity", store.getState().system.namedWays.length === 0);
}

// --- store: identity survives splitting (a street cut by an intersection) ---
{
  fresh();
  const a = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(a, [-115.2, 36.1]);
  store.getState().addWayPoint(a, [-115.15, 36.1]);
  store.getState().addWayPoint(a, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().nameWay(a, "Charleston Blvd");
  store.getState().splitWayAt(a, 1);
  const nw = store.getState().system.namedWays[0];
  check("both split halves stay under the one identity", nw.wayIds.length === 2 && store.getState().system.ways.every((w) => nw.wayIds.includes(w.id)));
}

// --- store: mergeWays (inverse of split) ---
{
  fresh();
  const a = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(a, [-115.2, 36.1]);
  store.getState().addWayPoint(a, [-115.15, 36.1]);
  store.getState().addWayPoint(a, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().splitWayAt(a, 1);
  const halves = store.getState().system.ways.map((w) => w.id);
  check("split made two ways", halves.length === 2);
  store.getState().mergeWays(halves[0], halves[1]);
  const merged = store.getState().system;
  check("mergeWays restores one way", merged.ways.length === 1 && merged.ways[0].id === halves[0]);
  check("merged way has the full point run", merged.ways[0].points.length === 3);
  check("the seam node dissolves (no third way met there)", merged.nodes.length === 0);
  check("the riding service runs over just the merged way", merged.services.every((sv) => sv.patterns.every((p) => p.wayIds.length === 1 && p.wayIds[0] === halves[0])));
  // Merging two ways that don't touch is refused.
  fresh();
  const x = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(x, [-115.2, 36.1]);
  store.getState().addWayPoint(x, [-115.18, 36.1]);
  store.getState().finishWay();
  const y = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(y, [-115.1, 36.2]);
  store.getState().addWayPoint(y, [-115.08, 36.2]);
  store.getState().finishWay();
  store.getState().mergeWays(x, y);
  check("mergeWays refuses ways that don't share an endpoint", store.getState().system.ways.length === 2);
}

// --- store: separate/combine carriageways ---
{
  fresh();
  const r = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(r, [-115.2, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().applyProfilePreset(r, "roadArterial4");
  const newId = store.getState().separateCarriageways(r)!;
  check("separateCarriageways returns the new carriageway", !!newId && store.getState().system.ways.length === 2);
  const fwd = store.getState().system.ways.find((w) => w.id === r)!;
  const back = store.getState().system.ways.find((w) => w.id === newId)!;
  check("original way becomes the one-way forward carriageway", isOneWay(fwd.profile) && directionalLanes(fwd.profile).every((l) => l.direction === "forward"));
  check("new way is the one-way backward carriageway", directionalLanes(back.profile).every((l) => l.direction === "backward"));
  check("the carriageways are physically offset", Math.abs(back.points[0][1] - fwd.points[0][1]) > 1e-6);
  const nw = store.getState().system.namedWays.find((n) => n.wayIds.includes(r));
  check("both carriageways share one identity", !!nw && nw.wayIds.includes(newId));
  check("a one-way way refuses to separate", store.getState().separateCarriageways(r) === null);

  const median = getComponent(store.getState().system.medians, nw!.id);
  check("separateCarriageways captures a Median component keyed by the NamedWay", !!median && median.widthM > 0);

  store.getState().setMedianWidth(nw!.id, 6);
  check("setMedianWidth overrides the captured width", getComponent(store.getState().system.medians, nw!.id)?.widthM === 6);

  store.getState().combineCarriageways(nw!.id);
  const combined = store.getState().system;
  check("combineCarriageways restores a single way", combined.ways.length === 1 && combined.ways[0].id === r);
  check("combined way is two-way again", !isOneWay(combined.ways[0].profile));
  check("combined profile gained a median between carriageways", combined.ways[0].profile.lanes.some((l) => l.kindId === "median"));
  check("combining restores the edited median width, not a generic default", combined.ways[0].profile.lanes.find((l) => l.kindId === "median")?.widthM === 6);
}

// --- store: auto-junctions where ways cross (the SimCity moment) ---
{
  fresh();
  const ew = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(ew, [-115.2, 36.1]);
  store.getState().addWayPoint(ew, [-115.1, 36.1]);
  store.getState().finishWay();
  const ns = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(ns, [-115.15, 36.05]);
  store.getState().addWayPoint(ns, [-115.15, 36.15]);
  store.getState().finishWay();

  // finishWay auto-formed the junction already; an explicit re-run is a no-op.
  store.getState().formCrossingJunctions(ns);
  const after = store.getState().system;
  check("crossing forms exactly one junction node", after.nodes.length === 1);
  check("the junction has four arms (both ways split)", after.ways.length === 4);
  check("all four arms meet at the junction", after.nodes[0].refs.length === 4);
  check("no unresolved crossings remain", after.ways.every((a2, i) => after.ways.every((b2, j) => i >= j || wayCrossings(a2, b2).length === 0)));
  check("services still ride their (now split) ways", after.services.every((sv) => sv.patterns.every((p) => p.wayIds.length === 2)));

  // Grade separation: an ELEVATED way crossing a surface street is an
  // overpass, never an intersection.
  fresh();
  const surface = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(surface, [-115.2, 36.1]);
  store.getState().addWayPoint(surface, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().setDraftGrade("elevated");
  const freeway = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(freeway, [-115.15, 36.05]);
  store.getState().addWayPoint(freeway, [-115.15, 36.15]);
  store.getState().finishWay();
  store.getState().setDraftGrade("atGrade");
  store.getState().formCrossingJunctions(freeway);
  check("different grades never auto-join (overpass, not intersection)", store.getState().system.nodes.length === 0 && store.getState().system.ways.length === 2);
}

// --- store: junction semantics (control, connectors) ---
{
  fresh();
  const ew = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(ew, [-115.2, 36.1]);
  store.getState().addWayPoint(ew, [-115.1, 36.1]);
  store.getState().finishWay();
  const ns = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(ns, [-115.15, 36.05]);
  store.getState().addWayPoint(ns, [-115.15, 36.15]);
  store.getState().finishWay();
  store.getState().formCrossingJunctions(ns);
  const node = store.getState().system.nodes[0];
  store.getState().setNodeControl(node.id, "signal");
  check("setNodeControl stores the control", store.getState().system.nodes[0].control === "signal");

  const sys = store.getState().system;
  const armA = sys.ways.find((w) => sys.nodes[0].refs.some((r2) => r2.wayId === w.id))!;
  const armB = sys.ways.find((w) => w.id !== armA.id && sys.nodes[0].refs.some((r2) => r2.wayId === w.id))!;
  const conn = [{ from: { wayId: armA.id, laneId: armA.profile.lanes[1].id }, to: { wayId: armB.id, laneId: armB.profile.lanes[1].id } }];
  store.getState().setNodeConnectors(node.id, conn);
  check("setNodeConnectors stores the lane graph", store.getState().system.nodes[0].connectors?.length === 1);
  // Deleting a referenced lane prunes its connectors.
  store.getState().setWayProfile(armA.id, { lanes: armA.profile.lanes.filter((l) => l.id !== armA.profile.lanes[1].id) });
  check("removing a lane prunes connectors that referenced it", !store.getState().system.nodes[0].connectors);
  store.getState().setNodeConnectors(node.id, undefined);
  check("setNodeConnectors(undefined) reverts to heuristic", store.getState().system.nodes[0].connectors === undefined);
}

// --- store: deleting a way cleans identity + connectors ---
{
  fresh();
  const a = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(a, [-115.2, 36.1]);
  store.getState().addWayPoint(a, [-115.1, 36.1]);
  store.getState().finishWay();
  const b = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(b, [-115.15, 36.05]);
  store.getState().addWayPoint(b, [-115.15, 36.15]);
  store.getState().finishWay();
  store.getState().formCrossingJunctions(b);
  const arms = store.getState().system.ways;
  const nodeId = store.getState().system.nodes[0].id;
  store.getState().setNodeConnectors(nodeId, [
    { from: { wayId: arms[0].id, laneId: arms[0].profile.lanes[1].id }, to: { wayId: arms[1].id, laneId: arms[1].profile.lanes[1].id } },
  ]);
  store.getState().nameWay(arms[0].id, "Sahara Ave");
  store.getState().deleteWay(arms[0].id);
  const sys = store.getState().system;
  check("deleting a way drops its identity membership", !sys.namedWays.some((n) => n.wayIds.includes(arms[0].id)));
  check("deleting a way drops connectors that referenced it", sys.nodes.every((n) => !n.connectors?.some((c) => c.from.wayId === arms[0].id || c.to.wayId === arms[0].id)));
}

// --- R2: per-lane street geometry (geometry/streets.ts) ---
{
  const road: Way = {
    id: "lg",
    typeId: "road",
    points: [[-115.2, 36.1], [-115.1, 36.1]], // due east
    geometry: "straight",
    grade: "atGrade",
    profile: buildProfile(PROFILE_PRESETS.roadArterial5.lanes),
  };
  const g = wayLaneGeometry(road);
  check("wayLaneGeometry derives one path per lane", g.lanes.length === road.profile.lanes.length);
  check("wayLaneGeometry memoizes per way object", wayLaneGeometry(road) === g);
  check("total width matches the profile", Math.abs(g.totalWidthM - profileWidthM(road.profile)) < 1e-9);
  const offsets = g.lanes.map((l) => l.offsetM);
  check("lane offsets ascend left-to-right", offsets.every((o, i) => i === 0 || o > offsets[i - 1]));
  check("lane offsets are centered on the way", Math.abs(offsets[0] + offsets[offsets.length - 1]) < 0.5);
  // Heading east: leftmost lane (negative offset = left of travel) is NORTH.
  const leftLane = g.lanes[0];
  check("leftmost lane sits left of travel (north when heading east)", leftLane.path[0][1] > road.points[0][1]);
  // 5-lane w/ center turn: 2 back | turn | 2 fwd → one center line between
  // backward drive and the bidirectional turn lane? No — center transitions
  // are backward→both→forward, so the double-yellow appears where directions
  // OPPOSE directly; here the turn pocket separates them, so we expect
  // laneLines between same-direction pairs and edge lines at the sidewalks.
  check("dividers include edge lines where roadway meets sidewalk", g.dividers.filter((d) => d.kind === "edgeLine").length === 2);
  check("dividers include dashed lane lines between same-direction lanes", g.dividers.some((d) => d.kind === "laneLine"));
  const plain = buildProfile(PROFILE_PRESETS.roadArterial4.lanes);
  const g4 = wayLaneGeometry({ ...road, id: "lg4", profile: plain });
  check("opposing directions get a center line (4-lane, no median)", g4.dividers.some((d) => d.kind === "centerLine"));
  const backArrows = g.arrows.filter((a) => a.direction === "backward");
  check("backward lanes' arrow paths are reversed to travel direction", backArrows.every((a) => a.path[0][0] > a.path[a.path.length - 1][0]));
  check("bidirectional lanes emit no arrows", g.arrows.every((a) => a.direction !== "both"));
}

// --- R2: lane-detail rendering emission (LOD + viewport scoping) ---
{
  fresh();
  const r = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(r, [-115.2, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(["road"]) };

  const infraFar = buildFeatures(store.getState().system, null, [], { viewMode: "infrastructure", ...filters });
  check("without laneDetail the fan renders and lanes stay empty", infraFar.lanes.features.length === 0 && infraFar.ways.features.length > 0);

  const infraNear = buildFeatures(store.getState().system, null, [], { viewMode: "infrastructure", ...filters, laneDetail: true });
  const wayObj = store.getState().system.ways[0];
  check("laneDetail emits one surface per surface lane", infraNear.lanes.features.length === wayObj.profile.lanes.length);
  check("laneDetail replaces the fan for that way", infraNear.ways.features.filter((f) => f.properties?.id === r && !f.properties?.haloOnly).length === 0);
  check("laneDetail emits markings", infraNear.laneMarkings.features.length > 0);
  check("laneDetail emits direction arrows", infraNear.laneArrows.features.length > 0);
  check("lane features carry a metric z14 pixel width", infraNear.lanes.features.every((f) => typeof f.properties?.w14 === "number" && f.properties.w14 > 0));

  const offscreen = buildFeatures(store.getState().system, null, [], {
    viewMode: "infrastructure", ...filters, laneDetail: true, bounds: [[-114.5, 36.5], [-114.4, 36.6]],
  });
  check("viewport scoping: offscreen ways keep the cheap fan", offscreen.lanes.features.length === 0 && offscreen.ways.features.length > 0);

  const net = buildFeatures(store.getState().system, null, [], { viewMode: "network", ...filters, laneDetail: true });
  check("network view never lane-renders", net.lanes.features.length === 0);

  store.getState().setWayGrade(r, "underground");
  const tunnel = buildFeatures(store.getState().system, null, [], { viewMode: "infrastructure", ...filters, laneDetail: true });
  check("underground ways keep the dashed fan (no asphalt in a tunnel)", tunnel.lanes.features.length === 0);
}

// --- R2: draft preset shapes newly drawn ways ---
{
  fresh();
  store.getState().setDraftWayType("road");
  store.getState().setDraftPreset("roadBoulevard");
  const r = store.getState().beginWay();
  store.getState().addWayPoint(r, [-115.2, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  const way = store.getState().system.ways[0];
  check("armed draft preset shapes the new way's profile", way.profile.lanes.some((l) => l.kindId === "median"));
  check("armed draft preset sets the class too", way.classId === "arterial");
  store.getState().setDraftWayType("heavyRail");
  check("changing way type clears the armed preset", store.getState().draftPresetId === null);
}

// --- R3: junction footprints, trims, connectors (geometry/junctions.ts) ---
{
  // A real 4-way crossing built through the store (auto-junction on finish).
  fresh();
  const ew = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(ew, [-115.2, 36.1]);
  store.getState().addWayPoint(ew, [-115.1, 36.1]);
  store.getState().finishWay();
  const ns = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(ns, [-115.15, 36.05]);
  store.getState().addWayPoint(ns, [-115.15, 36.15]);
  store.getState().finishWay();
  const sys = store.getState().system;
  check("finishing a crossing way auto-forms the junction (no manual call)", sys.nodes.length === 1 && sys.ways.length === 4);

  const waysById = new Map(sys.ways.map((w) => [w.id, w]));
  const g = junctionGeometry(sys.nodes[0], waysById)!;
  check("junctionGeometry finds all four arms", g.arms.length === 4);
  check("every arm of a 4-way crossing trims back", g.arms.every((a) => a.trimM > 1));
  // Perpendicular same-width arms: trim ≈ the other road's half-width.
  const half = g.arms[0].halfWidthM;
  check("perpendicular trim ≈ the crossing road's half-width", g.arms.every((a) => Math.abs(a.trimM - half) < 1.5));
  check("footprint polygon has two corners per arm", g.polygon.length === 8);

  const trims = collectWayTrims([g]);
  check("collectWayTrims records a trim for every arm's way", trims.size === 4);

  // Default lane connectivity: every approach can go somewhere; through
  // lanes map straight, edges turn.
  const conns = defaultConnectors(sys.nodes[0], waysById);
  check("default connectors exist for every approach", g.arms.every((arm) => conns.some((c) => c.from.wayId === arm.wayId)));
  check("default connectors include left, straight, and right turns", (() => {
    const classes = new Set<string>();
    for (const c of conns) {
      const inArm = g.arms.find((a) => a.wayId === c.from.wayId)!;
      const outArm = g.arms.find((a) => a.wayId === c.to.wayId)!;
      const hx = -inArm.dir[0], hy = -inArm.dir[1];
      classes.add(classifyTurn(Math.atan2(hx * outArm.dir[1] - hy * outArm.dir[0], hx * outArm.dir[0] + hy * outArm.dir[1])));
    }
    return classes.has("left") && classes.has("straight") && classes.has("right");
  })());
  check("no default u-turns", conns.every((c) => c.from.wayId !== c.to.wayId));

  const curves = connectorCurves(sys.nodes[0], waysById, trims);
  check("every connector renders a curve", curves.length === conns.length && curves.every((c) => c.path.length >= 2));

  // Stored connectors override the defaults.
  const custom = [conns[0]];
  store.getState().setNodeConnectors(sys.nodes[0].id, custom);
  const sys2 = store.getState().system;
  check("stored connectors override the heuristic", effectiveConnectors(sys2.nodes[0], new Map(sys2.ways.map((w) => [w.id, w]))).length === 1);

  // Directional lane bookkeeping: an "end" arm's incoming lanes are its
  // forward lanes; a "start" arm's are its backward lanes.
  const anyWay = sys.ways[0];
  const fwd = anyWay.profile.lanes.filter((l) => l.direction === "forward" && LANE_KINDS[l.kindId].directional).length;
  const back = anyWay.profile.lanes.filter((l) => l.direction === "backward" && LANE_KINDS[l.kindId].directional).length;
  check("incoming/outgoing lane counts match the profile's split", incomingLanes(anyWay, "end").length === fwd && outgoingLanes(anyWay, "end").length === back);
}

// --- turn restrictions: target-way identity, never an angle bucket
// (geometry/junctions.ts + editor/store.ts) ---
{
  fresh();
  const ew = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(ew, [-115.2, 36.1]);
  store.getState().addWayPoint(ew, [-115.1, 36.1]);
  store.getState().finishWay();
  const ns = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(ns, [-115.15, 36.05]);
  store.getState().addWayPoint(ns, [-115.15, 36.15]);
  store.getState().finishWay();
  let sys = store.getState().system;
  let waysById = new Map(sys.ways.map((w) => [w.id, w]));
  const node = sys.nodes[0];
  const g = junctionGeometry(node, waysById)!;
  const inArm = g.arms[0];
  const inLane = incomingLanes(waysById.get(inArm.wayId)!, inArm.end)[0];

  const unrestricted = defaultConnectors(node, waysById).filter((c) => c.from.wayId === inArm.wayId && c.from.laneId === inLane.id);
  check("this lane has more than one candidate target before any restriction", unrestricted.length > 0);
  const oneTarget = unrestricted[0].to.wayId;

  store.getState().setTurnRestriction(inArm.wayId, inLane.id, [oneTarget]);
  sys = store.getState().system;
  waysById = new Map(sys.ways.map((w) => [w.id, w]));
  const restricted = defaultConnectors(node, waysById, sys.turnRestrictions).filter((c) => c.from.wayId === inArm.wayId && c.from.laneId === inLane.id);
  check("a target-way restriction narrows default connectors to just that target", restricted.length > 0 && restricted.every((c) => c.to.wayId === oneTarget));

  store.getState().setTurnRestriction(inArm.wayId, inLane.id, []);
  sys = store.getState().system;
  waysById = new Map(sys.ways.map((w) => [w.id, w]));
  const blockedDefaults = defaultConnectors(node, waysById, sys.turnRestrictions);
  check(
    "an empty allow-list produces no default connector for that lane at all (the modal-filter case)",
    !blockedDefaults.some((c) => c.from.wayId === inArm.wayId && c.from.laneId === inLane.id),
  );

  // A restriction also holds against an explicit user-set connector added
  // before the restriction existed — it's never silently bypassed.
  store.getState().setNodeConnectors(node.id, unrestricted);
  sys = store.getState().system;
  waysById = new Map(sys.ways.map((w) => [w.id, w]));
  const effectiveWithStoredOverride = effectiveConnectors(node, waysById, sys.turnRestrictions);
  check(
    "effectiveConnectors filters even explicit stored connectors by an active restriction",
    !effectiveWithStoredOverride.some((c) => c.from.wayId === inArm.wayId && c.from.laneId === inLane.id),
  );

  store.getState().setTurnRestriction(inArm.wayId, inLane.id, undefined);
  sys = store.getState().system;
  check("clearing a restriction (undefined) removes it from the component map", getComponent(sys.turnRestrictions, laneRefKey(inArm.wayId, inLane.id)) === undefined);
}

// --- kind-aware straight-through pairing (geometry/junctions.ts) — a lane
// that changes position across a profile change (e.g. a bus lane moving
// from center-running to curbside) should still default-connect to the
// same-kind lane on the far side, not whatever shares its numeric index. ---
{
  const wA: Way = {
    id: "wA",
    typeId: "road",
    points: [[-115.2, 36.1], [-115.15, 36.1]],
    geometry: "straight",
    grade: "atGrade",
    profile: {
      lanes: [
        { id: "a-bus", kindId: "bus", widthM: 3.6, direction: "forward" },
        { id: "a-drive", kindId: "drive", widthM: 3.3, direction: "forward" },
      ],
    },
  };
  const wB: Way = {
    id: "wB",
    typeId: "road",
    points: [[-115.15, 36.1], [-115.1, 36.1]],
    geometry: "straight",
    grade: "atGrade",
    profile: {
      lanes: [
        { id: "b-drive", kindId: "drive", widthM: 3.3, direction: "forward" },
        { id: "b-bus", kindId: "bus", widthM: 3.6, direction: "forward" },
      ],
    },
  };
  const swapNode: Node = { id: "nX", coord: [-115.15, 36.1], refs: [{ wayId: "wA", pointIndex: 1 }, { wayId: "wB", pointIndex: 0 }] };
  const swapWaysById = new Map([["wA", wA], ["wB", wB]]);
  const swapConns = defaultConnectors(swapNode, swapWaysById);
  const busConn = swapConns.find((c) => c.from.wayId === "wA" && c.from.laneId === "a-bus");
  const driveConn = swapConns.find((c) => c.from.wayId === "wA" && c.from.laneId === "a-drive");
  check("kind-aware pairing connects bus-to-bus despite differing array position", !!busConn && busConn.to.laneId === "b-bus");
  check("kind-aware pairing connects drive-to-drive too", !!driveConn && driveConn.to.laneId === "b-drive");
}

// --- per-approach traffic control override (editor/store.ts) ---
{
  fresh();
  const ew2 = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(ew2, [-115.2, 36.1]);
  store.getState().addWayPoint(ew2, [-115.1, 36.1]);
  store.getState().finishWay();
  const ns2 = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(ns2, [-115.15, 36.05]);
  store.getState().addWayPoint(ns2, [-115.15, 36.15]);
  store.getState().finishWay();
  const node2 = store.getState().system.nodes[0];
  store.getState().setNodeControl(node2.id, "signal");
  const waysById4 = new Map(store.getState().system.ways.map((w) => [w.id, w]));
  const arm = junctionGeometry(node2, waysById4)!.arms[0];

  check("an approach has no override by default", getComponent(store.getState().system.approachControls, armRefKey(arm.wayId, arm.end)) === undefined);
  store.getState().setApproachControl(arm.wayId, arm.end, "stop");
  check("setApproachControl stores an explicit per-approach override", getComponent(store.getState().system.approachControls, armRefKey(arm.wayId, arm.end))?.control === "stop");
  check("the whole-node control is untouched by a per-approach override", store.getState().system.nodes.find((n) => n.id === node2.id)?.control === "signal");
  store.getState().setApproachControl(arm.wayId, arm.end, "uncontrolled");
  check(
    "an explicit 'uncontrolled' override is distinct from having no override at all",
    getComponent(store.getState().system.approachControls, armRefKey(arm.wayId, arm.end))?.control === "uncontrolled",
  );
  store.getState().setApproachControl(arm.wayId, arm.end, undefined);
  check("clearing the override (undefined) removes it, reverting to the junction default", getComponent(store.getState().system.approachControls, armRefKey(arm.wayId, arm.end)) === undefined);
}

// --- R3: trims flow into stage-1 lane geometry; trimPath behaves ---
{
  const line: LngLat[] = [[-115.2, 36.1], [-115.1, 36.1]]; // ~9km east
  const trimmed = trimPath(line, 100, 200);
  check("trimPath crops both ends", trimmed.length === 2 && trimmed[0][0] > line[0][0] && trimmed[1][0] < line[1][0]);
  check("trimPath with zero trims returns the path unchanged", trimPath(line, 0, 0) === line);
  check("trimPath consuming the whole path returns empty", trimPath([[-115.2, 36.1], [-115.1999, 36.1]], 50, 50).length === 0);

  const road: Way = { id: "tw", typeId: "road", points: line, geometry: "straight", grade: "atGrade", profile: defaultProfileFor("road", 4) };
  const full = wayLaneGeometry(road);
  const cut = wayLaneGeometry(road, 15, 0);
  check("trimmed lane geometry is cached separately from untrimmed", full !== cut);
  check("trimmed lanes start ~15m in", (() => {
    const dx = (cut.lanes[0].path[0][0] - full.lanes[0].path[0][0]) * 111320 * Math.cos((36.1 * Math.PI) / 180);
    return dx > 13 && dx < 17;
  })());
}

// --- R3: two-arm straight-through joints stay seamless ---
{
  fresh();
  const a = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(a, [-115.2, 36.1]);
  store.getState().addWayPoint(a, [-115.15, 36.1]);
  store.getState().addWayPoint(a, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().splitWayAt(a, 1);
  const sys = store.getState().system;
  const waysById = new Map(sys.ways.map((w) => [w.id, w]));
  const g = junctionGeometry(sys.nodes[0], waysById)!;
  check("a straight-through split joint draws no junction polygon", g.polygon.length === 0);
  check("a straight-through joint trims nothing", g.arms.every((arm) => arm.trimM < 0.01));
}

// --- R3: lane-detail rendering emits junction footprints + connector guides ---
{
  fresh();
  const ew = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(ew, [-115.2, 36.1]);
  store.getState().addWayPoint(ew, [-115.1, 36.1]);
  store.getState().finishWay();
  const ns = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(ns, [-115.15, 36.05]);
  store.getState().addWayPoint(ns, [-115.15, 36.15]);
  store.getState().finishWay();
  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(["road"]) };
  const fc = buildFeatures(store.getState().system, null, [], { viewMode: "infrastructure", ...filters, laneDetail: true });
  check("lane detail emits the junction footprint", fc.junctions.features.length === 1);
  check("lane detail emits connector guides", fc.connectors.features.length > 0);
  const far = buildFeatures(store.getState().system, null, [], { viewMode: "infrastructure", ...filters });
  check("no junction polygons below lane-detail zoom", far.junctions.features.length === 0);
  const nodeId = store.getState().system.nodes[0].id;
  const sel = buildFeatures(store.getState().system, { kind: "node", id: nodeId }, [], { viewMode: "infrastructure", ...filters, laneDetail: true });
  check("a selected junction's footprint is flagged", sel.junctions.features.some((f) => f.properties?.selected === true));
}

// --- R4: street name labels + lane keyboard shortcuts ---
{
  fresh();
  const r = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(r, [-115.2, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().nameWay(r, "Decatur Avenue");
  store.getState().separateCarriageways(r);
  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(["road"]) };
  const infra = buildFeatures(store.getState().system, null, [], { viewMode: "infrastructure", ...filters });
  const labels = infra.wayLabels.features.filter((f) => f.properties?.name === "Decatur Avenue");
  check("both carriageways label as the one named street", labels.length === 2);
  const net = buildFeatures(store.getState().system, null, [], { viewMode: "network", ...filters });
  check("street labels are infrastructure-view detail", net.wayLabels.features.length === 0);

  const laneBindings = KEY_BINDINGS.filter((b) => b.group === "Lanes");
  check("lane shortcuts exist ([ ] D O + 9 presets)", laneBindings.length === 4 + 9);
  check("preset shortcut keys are 1–9", laneBindings.filter((b) => /^[1-9]$/.test(b.keys[0])).length === 9);
}

// --- bare infrastructure toggle: draw roads WITHOUT auto-creating a line ---
{
  fresh();
  store.getState().setDraftWayType("road");
  store.getState().setDraftServiceEnabled(false);
  const r = store.getState().beginWay();
  store.getState().addWayPoint(r, [-115.2, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  check("service toggle off: drawing a road creates NO service", store.getState().system.services.length === 0);
  check("the bare road itself exists and is selected-style bare infra", store.getState().system.ways.length === 1);

  // Picking a mode is an explicit "draw a line" — it re-enables services.
  store.getState().setDraftMode("bus");
  check("choosing a mode re-enables service creation", store.getState().draftServiceEnabled === true);
  const r2 = store.getState().beginWay();
  store.getState().addWayPoint(r2, [-115.2, 36.2]);
  store.getState().addWayPoint(r2, [-115.1, 36.2]);
  store.getState().finishWay();
  check("after re-enabling, drawing creates the service again", store.getState().system.services.length === 1);
}

// ===========================================================================
// Routing over existing infrastructure (model/routeGraph.ts + store actions)
// ===========================================================================

// Builds a small street grid: two east-west roads crossed by one north-south
// road → auto-junctions split everything into arms.
function buildGrid() {
  fresh();
  const draw = (pts: LngLat[]) => {
    const w = store.getState().beginWay("road", "straight");
    for (const p of pts) store.getState().addWayPoint(w, p);
    store.getState().finishWay();
    return w;
  };
  store.getState().setDraftServiceEnabled(false); // bare streets
  draw([[-115.3, 36.2], [-115.1, 36.2]]); // top EW
  draw([[-115.3, 36.1], [-115.1, 36.1]]); // bottom EW
  draw([[-115.2, 36.05], [-115.2, 36.25]]); // NS, crossing both
  store.getState().setDraftServiceEnabled(true);
}

// --- routeBetween: shortest path through junctions, mid-way anchors ---
{
  buildGrid();
  const sys = store.getState().system;
  check("grid built bare (no services) with junction-split arms", sys.services.length === 0 && sys.ways.length === 7 && sys.nodes.length === 2);

  const wayAtCoord = (c: LngLat) => {
    const s = snap(sys.ways, c, 50);
    return s ? sys.ways.find((w) => w.id === s.wayId)! : null;
  };
  const wTop = wayAtCoord([-115.28, 36.2])!;
  const wBottom = wayAtCoord([-115.12, 36.1])!;
  const from = anchorOnWay(wTop, [-115.28, 36.2])!;
  const to = anchorOnWay(wBottom, [-115.12, 36.1])!;
  const res = routeBetween(sys, from, to, { allowedTypeIds: new Set(["road"]) });
  check("routeBetween finds a path across two junctions", !!res && res.spans.length === 3);
  check("route length ≈ manhattan distance (~29km)", !!res && res.lengthM > 25000 && res.lengthM < 33000);
  const path = routePath(sys, res!.spans);
  check("routePath starts and ends at the anchors", haversineMeters(path[0], from.coord) < 5 && haversineMeters(path[path.length - 1], to.coord) < 5);
  check("route path is continuous (no jumps between spans)", path.every((p, i) => i === 0 || haversineMeters(path[i - 1], p) < 15000));

  const none = routeBetween(sys, from, to, { allowedTypeIds: new Set(["heavyRail"]) });
  check("routeBetween respects mode compatibility (no rail path over roads)", none === null);
}

// --- createRoutedService: materializes splits, service rides existing ways ---
{
  buildGrid();
  const sys = store.getState().system;
  const s1 = snap(sys.ways, [-115.28, 36.2], 50)!;
  const s2 = snap(sys.ways, [-115.12, 36.1], 50)!;
  const from = anchorOnWay(sys.ways.find((w) => w.id === s1.wayId)!, s1.coord)!;
  const to = anchorOnWay(sys.ways.find((w) => w.id === s2.wayId)!, s2.coord)!;
  const res = routeBetween(sys, from, to, { allowedTypeIds: new Set(["road"]) })!;
  const waysBefore = sys.ways.length;
  const svcId = store.getState().createRoutedService(res.spans, "bus");
  const after = store.getState().system;
  check("createRoutedService creates the service", !!svcId && after.services.length === 1);
  const svc = after.services[0];
  check("the routed service rides one pattern of existing ways", svc.patterns.length === 1 && svc.patterns[0].wayIds.length === res.spans.length);
  check("mid-way anchors split their ways (two new arms)", after.ways.length === waysBefore + 2);
  check("no new parallel geometry was drawn (every ridden way pre-existed or is a split arm)", svc.patterns[0].wayIds.every((wid) => after.ways.some((w) => w.id === wid && w.typeId === "road")));
  const ridden = after.ways.filter((w) => svc.patterns[0].wayIds.includes(w.id));
  const total = ridden.reduce((m, w) => m + wayLengthMeters(w), 0);
  check("ridden ways cover the route length", Math.abs(total - res.lengthM) < 500);
}

// --- route draft state machine (the drawing gesture's backend) ---
{
  buildGrid();
  const sys = store.getState().system;
  const s1 = snap(sys.ways, [-115.28, 36.2], 50)!;
  const s2 = snap(sys.ways, [-115.12, 36.1], 50)!;
  const from = anchorOnWay(sys.ways.find((w) => w.id === s1.wayId)!, s1.coord)!;
  const to = anchorOnWay(sys.ways.find((w) => w.id === s2.wayId)!, s2.coord)!;
  store.getState().startRouteDraft(from);
  check("startRouteDraft opens an empty draft", store.getState().routeDraft?.spans.length === 0);
  check("extendRouteDraft appends routed spans", store.getState().extendRouteDraft(to) === true && store.getState().routeDraft!.spans.length === 3);
  const svcId = store.getState().commitRouteDraft();
  check("commitRouteDraft creates the service and clears the draft", !!svcId && store.getState().routeDraft === null && store.getState().system.services.length === 1);

  store.getState().startRouteDraft(from);
  store.getState().cancelRouteDraft();
  check("cancelRouteDraft clears without creating anything", store.getState().routeDraft === null && store.getState().system.services.length === 1);
}

// --- routing along a SINGLE way (the first-gesture case that hit the
// degenerate same-segment path in the browser) ---
{
  fresh();
  store.getState().setDraftServiceEnabled(false);
  const r = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(r, [-115.3, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().setDraftServiceEnabled(true);
  const way = store.getState().system.ways[0];

  const from = anchorOnWay(way, [-115.27, 36.1])!;
  const to = anchorOnWay(way, [-115.14, 36.1])!;
  const res = routeBetween(store.getState().system, from, to, { allowedTypeIds: new Set(["road"]) });
  check("same-way route resolves (same-segment direct span)", !!res && res.spans.length === 1 && res.spans[0].noInterior === true);
  check("same-way route length matches the click distance (~11.7km)", !!res && res.lengthM > 11000 && res.lengthM < 12500);
  const path = routePath(store.getState().system, res!.spans);
  check("same-way route path runs between the two clicks", path.length === 2 && Math.abs(path[0][0] - -115.27) < 1e-6 && Math.abs(path[1][0] - -115.14) < 1e-6);

  store.getState().startRouteDraft(from);
  check("extend along the same way succeeds", store.getState().extendRouteDraft(to) === true);
  const svcId = store.getState().commitRouteDraft();
  const sys = store.getState().system;
  check("committing a same-way route creates the service", !!svcId && sys.services.length === 1);
  const ridden = sys.services[0].patterns[0].wayIds;
  check("the road was split into three arms; the line rides the middle one", sys.ways.length === 3 && ridden.length === 1);
  const mid = sys.ways.find((w) => w.id === ridden[0])!;
  check("the ridden arm spans exactly the clicked stretch", Math.abs(mid.points[0][0] - -115.27) < 1e-6 && Math.abs(mid.points[mid.points.length - 1][0] - -115.14) < 1e-6);
}

// --- adoptExistingInfrastructure: sketched line re-binds onto the grid ---
{
  buildGrid();
  // Sketch a bus line roughly along the top road, offset ~200m north — the
  // Network-view sketch flow (service enabled) creating parallel geometry.
  const sketch = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(sketch, [-115.28, 36.202]);
  store.getState().addWayPoint(sketch, [-115.12, 36.202]);
  store.getState().finishWay();
  const before = store.getState().system;
  const svc = before.services[0];
  check("sketch created its own service + parallel geometry", !!svc && before.ways.length > 7);
  // A station riding the sketch, to prove it follows the adoption.
  const st1 = store.getState().addStation([-115.25, 36.202], { wayId: svc.patterns[0].wayIds[0], t: 0.2 });

  const rebound = store.getState().adoptExistingInfrastructure(svc.id);
  const after = store.getState().system;
  const adopted = after.services.find((sv) => sv.id === svc.id)!;
  check("adoptExistingInfrastructure rebinds the pattern", rebound === 1);
  check("the adopted pattern rides real grid ways (top road arms)", adopted.patterns[0].wayIds.length >= 1 && adopted.patterns[0].wayIds.every((wid) => after.ways.some((w) => w.id === wid)));
  check("adopted ways lie on the grid, not the sketch offset", adopted.patterns[0].wayIds.every((wid) => {
    const w = after.ways.find((x) => x.id === wid)!;
    return w.points.every((p) => Math.abs(p[1] - 36.2) < 0.0005);
  }));
  const sketchWayIds = new Set(svc.patterns[0].wayIds);
  check("orphaned sketch geometry was removed", after.ways.every((w) => !sketchWayIds.has(w.id)));
  const station = after.stations.find((s2) => s2.id === st1)!;
  check("the station followed onto an adopted way", !!station.anchor && adopted.patterns[0].wayIds.includes(station.anchor.wayId));
}

// --- facility tool: place-on-click semantics (complex is a variant, not a
// hidden default) ---
{
  fresh();
  check("facility tool starts in PLACE mode, not complex mode", store.getState().draftFacilityComplexMode === false);
  store.getState().setDraftFacilityComplexMode(true);
  check("complex mode is opt-in", store.getState().draftFacilityComplexMode === true);
  store.getState().setDraftFacilityType("depot");
  check("picking a facility type leaves complex mode", store.getState().draftFacilityComplexMode === false);
  // Area facilities can be placed as polygons directly.
  const fid = store.getState().addFacility("depot", squareFootprint([-115.15, 36.1], 15));
  const fac = store.getState().system.facilities.find((f) => f.id === fid)!;
  check("an area facility placed by click gets a real polygon", Array.isArray(fac.geometry[0]) && (fac.geometry as LngLat[]).length === 4);
}

// --- one-way affordances: draft toggle, endpoint branch, network chevrons ---
{
  // Direction toggle: newly drawn ways come out one-way, travel = draw direction.
  fresh();
  store.getState().setDraftServiceEnabled(false);
  store.getState().setDraftOneWay(true);
  const r = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(r, [-115.3, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  const way = store.getState().system.ways[0];
  check("draft one-way: drawn road is one-way", isOneWay(way.profile));
  check("draft one-way: travel runs the draw direction (forward)", directionalLanes(way.profile).every((l) => l.direction === "forward"));
  store.getState().setDraftOneWay(false);

  // Right-click endpoint branch: continues the street as a one-way segment.
  store.getState().nameWay(r, "Main Street");
  const branchId = store.getState().beginOneWayBranch(r, "end")!;
  const sys = store.getState().system;
  const branch = sys.ways.find((w) => w.id === branchId)!;
  check("branch starts AT the source way's endpoint", branch.points.length >= 1 && branch.points[0][0] === -115.1);
  check("branch is one-way with fresh lane ids", isOneWay(branch.profile) && branch.profile.lanes.every((l) => !way.profile.lanes.some((o) => o.id === l.id)));
  check("branch inherits type and class", branch.typeId === way.typeId && branch.classId === way.classId);
  check("branch is joined to the source at a real junction", sys.nodes.some((n) => n.refs.some((x) => x.wayId === branchId) && n.refs.some((x) => x.wayId === r)));
  check("branch continues the street identity", sys.namedWays.some((n) => n.name === "Main Street" && n.wayIds.includes(branchId)));
  check("branch becomes the active draw with one-way armed", store.getState().activeWayId === branchId && store.getState().draftOneWay === true);
  store.getState().cancelRouteDraft();
  store.getState().finishWay();
  store.getState().setDraftOneWay(false);

  // Network view shows one-way chevrons on SERVED one-way ways.
  fresh();
  store.getState().setDraftOneWay(true);
  const ow = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(ow, [-115.3, 36.1]);
  store.getState().addWayPoint(ow, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().setDraftOneWay(false);
  store.getState().addServiceToWay(ow);
  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(["road"]) };
  const net = buildFeatures(store.getState().system, null, [], { viewMode: "network", ...filters });
  check("network view emits chevrons for a served one-way way", net.laneArrows.features.length === 1);
  // Flip it and the chevron path reverses.
  const wref = store.getState().system.ways.find((w) => w.id === ow)!;
  store.getState().setWayProfile(ow, flipProfile(wref.profile));
  const net2 = buildFeatures(store.getState().system, null, [], { viewMode: "network", ...filters });
  const c1 = net.laneArrows.features[0].geometry.coordinates[0][0];
  const c2 = net2.laneArrows.features[0].geometry.coordinates[0][0];
  check("flipping the way reverses the chevron direction", c1 !== c2);
  // Two-way ways show no chevrons.
  store.getState().setWayProfile(ow, makeTwoWay(store.getState().system.ways[0].profile));
  const net3 = buildFeatures(store.getState().system, null, [], { viewMode: "network", ...filters });
  check("two-way ways get no chevrons in network view", net3.laneArrows.features.length === 0);
}

// --- station DRAWING: a dragged footprint is a real station ---
{
  fresh();
  store.getState().setDraftServiceEnabled(false);
  const r = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(r, [-115.2, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().setDraftServiceEnabled(true);

  // A footprint straddling the road: station anchors onto it.
  const fp = squareFootprint([-115.15, 36.1], 25);
  const sid = store.getState().addDrawnStation(fp);
  const st1 = store.getState().system.stations.find((x) => x.id === sid)!;
  check("drawn station carries its footprint", st1.footprint === fp);
  check("drawn station anchors onto the way it straddles", st1.anchor?.wayId === r);
  check("drawn station's coord sits on the way", Math.abs(st1.coord[1] - 36.1) < 1e-6);
  check("drawn station is selected for immediate platform work", store.getState().selection?.kind === "station" && store.getState().selection.id === sid);

  // A footprint in empty desert: still a station, just free-standing.
  const fp2 = squareFootprint([-115.4, 36.3], 25);
  const sid2 = store.getState().addDrawnStation(fp2);
  const st2 = store.getState().system.stations.find((x) => x.id === sid2)!;
  check("a footprint away from any way makes a free station", st2.anchor === undefined && st2.footprint === fp2);
}

// --- station land + structures: the border IS the station; structures on
// its land belong to it and are real shapes ---
{
  fresh();
  // Define a station's land.
  const land = squareFootprint([-115.15, 36.1], 60);
  const sid = store.getState().addDrawnStation(land);
  store.getState().setStationName(sid, "Bonneville Transit Center");

  // A building drawn ON the land: real polygon, auto-joins the station.
  const bldg = store.getState().addFacility("building", squareFootprint([-115.1502, 36.1002], 12));
  let sys = store.getState().system;
  const bf = sys.facilities.find((f) => f.id === bldg)!;
  check("a building is a drawn shape, not a point", Array.isArray(bf.geometry[0]));
  const complex = sys.groups.find((g) => g.memberIds.includes(sid));
  check("a structure on station land joins the station's complex", !!complex && complex.memberIds.includes(bldg));
  check("the complex is named after the station", complex!.name === "Bonneville Transit Center complex");

  // A second structure joins the SAME complex (no duplicates).
  const bay = store.getState().addFacility("busBay", squareFootprint([-115.1498, 36.0998], 8));
  sys = store.getState().system;
  check("further structures join the same complex", sys.groups.length === 1 && sys.groups[0].memberIds.includes(bay));

  // An entrance point on the land joins too; one far away stays independent.
  const door = store.getState().addFacility("entrance", [-115.1501, 36.1001]);
  const remote = store.getState().addFacility("entrance", [-115.4, 36.4]);
  sys = store.getState().system;
  check("a point access on the land joins the station", sys.groups[0].memberIds.includes(door));
  check("a facility off the land stays independent", !sys.groups[0].memberIds.includes(remote) && sys.groups.length === 1);

  // Catalog: building exists as an AREA type.
  check("Building is a real area facility type", FACILITY_TYPES.building?.geometryKind === "area");
}

// --- paint-order invariants: the street surface is the GROUND ---
// Station/complex footprints must paint ABOVE lane asphalt and junction
// fills, or a footprint straddling a lane-rendered street is invisible
// (the "station boundaries only show while dragging corners" bug).
{
  const order = LAYER_SPECS.map((l) => l.id);
  const above = (upper: string, lower: string) => order.indexOf(upper) > order.indexOf(lower) && order.indexOf(lower) >= 0;
  check("footprint fill paints above lane surfaces", above("tm-footprints-fill", "tm-lane-surfaces"));
  check("footprint fill paints above junction fills", above("tm-footprints-fill", "tm-junctions"));
  check("platform fill paints above lane surfaces", above("tm-platforms-fill", "tm-lane-surfaces"));
  check("station markers paint above footprints", above("tm-stations", "tm-footprints-fill"));
}

// --- dwell-time timetable math (vehicles.ts) — the vehicle animation walks
// this instead of a plain distance/speed triangle wave once a pattern has
// stops, so a vehicle actually pauses at each station instead of gliding
// through it. ---
{
  const totalMeters = 1100;
  // No stops: pure constant-velocity travel, same as the old triangle wave.
  const noStops = buildTimetable(totalMeters, []);
  check("no-stop timetable is pure travel time", noStops.oneWayMs === (totalMeters / VEHICLE_SPEED_MPS) * 1000);
  check("no-stop position is linear in elapsed time", metersAtElapsed(totalMeters, noStops, 50000) === 550);

  // One stop halfway (550m in), dwelling 20s.
  const halfwayMs = (550 / VEHICLE_SPEED_MPS) * 1000; // 50000ms to reach it
  const oneStop = buildTimetable(totalMeters, [{ distMeters: 550, dwellMs: 20000 }]);
  check("timetable adds the dwell on top of travel time", oneStop.oneWayMs === (totalMeters / VEHICLE_SPEED_MPS) * 1000 + 20000);
  check("still approaching the stop reads as mid-travel", metersAtElapsed(totalMeters, oneStop, halfwayMs - 10000) === 440);
  check("mid-dwell holds position at the stop", metersAtElapsed(totalMeters, oneStop, halfwayMs + 10000) === 550);
  check("travel resumes after the dwell ends", metersAtElapsed(totalMeters, oneStop, halfwayMs + 20000 + 10000) === 660);
  check("the full one-way time reaches the path's end", metersAtElapsed(totalMeters, oneStop, oneStop.oneWayMs) === totalMeters);

  // dwellStopsForPattern: only stations anchored to the pattern's OWN ways
  // count, ordered by arc-length along the resolved path (not by way index
  // or station-array order).
  const path: LngLat[] = [
    [-115.24, 36.1],
    [-115.17, 36.1],
  ];
  const sys = createEmptySystem();
  sys.stations = [
    { id: "near-end", coord: [-115.19, 36.1], anchor: { wayId: "w1", t: 0.7 } },
    { id: "near-start", coord: [-115.22, 36.1], anchor: { wayId: "w1", t: 0.2 } },
    { id: "custom-dwell", coord: [-115.2, 36.1], anchor: { wayId: "w1", t: 0.5 }, dwellSeconds: 5 },
    { id: "other-way", coord: [-115.2, 36.1005], anchor: { wayId: "w2", t: 0.5 } },
    { id: "unanchored", coord: [-115.2, 36.1] },
  ];
  const pathMeters = haversineMeters(path[0], path[1]);
  const pattern = { id: "p1", wayIds: ["w1"] };
  const stops = dwellStopsForPattern(sys, pattern, path, pathMeters);
  check("only stations anchored to the pattern's ways become stops", stops.length === 3);
  check("stops are ordered by distance along the path, not input order", stops[0].distMeters < stops[1].distMeters && stops[1].distMeters < stops[2].distMeters);
  check("an unset dwell falls back to the default", stops[0].dwellMs === 20000 && stops[2].dwellMs === 20000);
  check("a station's own dwellSeconds overrides the default", stops[1].dwellMs === 5000);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
