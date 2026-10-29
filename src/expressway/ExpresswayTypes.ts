import type { XKind } from './ExpresswayPlan';

/** Data shapes of the expressway network (pure data: no three.js). */

export type XRampType = 'exit' | 'entrance' | 'direct' | 'flyover' | 'terminal';

export interface XRampInfo {
  type: XRampType;
  /** Route the ramp leaves (exit) / joins (entrance) and its station there (the nose), and the side of that route (+1 left, -1 right) it is on. */
  onRoute: number;
  noseS: number;
  side: number;
  /** Lanes of the ramp (1 or 2) and the design speed (km/h). */
  lanes: number;
  speed: number;
  /** The aux lane on the main deck: taper length, parallel length (decel / accel), from `auxS0` to `auxS1` (stations on the parent route). */
  taper: number;
  parallel: number;
  auxS0: number;
  auxS1: number;
  /** Where the ramp meets an ordinary road: point, road surface height, road id, heading of the road lane there. null = joins another expressway route. */
  landing: { x: number; z: number; y: number; roadId: number; heading: number } | null;
  /** The ramp joins this other expressway route (system ramps), at this station. */
  toRoute?: number;
  toS?: number;
  /** Length of the final merge taper on the ordinary road (m). */
  mergeLen: number;
  /** True when the ramp's traffic flows from the road to the expressway (entrance), false from the expressway down (exit). */
  fromRoad: boolean;
  /** System ramp between two expressway routes; `flyover` = it crosses over the other main deck. */
  system?: boolean;
  flyover?: boolean;
  /** The other end of a system ramp: the route and the station (or the deck end). */
  stemRoute?: number;
}

export interface XRoute {
  id: number;
  name: string;
  kind: XKind;
  closed: boolean;
  /** Two carriageways + median (the main deck) or a single one-way ramp deck. */
  main: boolean;
  /** Lanes per carriageway (main: 4) or lanes of the ramp. */
  lanes: number;
  /** Half width of the deck (m) without any widening. */
  halfWidth: number;
  step: number;
  xs: Float64Array;
  zs: Float64Array;
  /** Finished road surface height at the centre line (the pivot, at the median edge on the main deck). */
  ys: Float64Array;
  /** Highest natural ground across the deck / the ground at the centre line (m). */
  ground: Float64Array;
  gc: Float64Array;
  cum: Float64Array;
  length: number;
  heading: Float64Array;
  /** Signed curvature (1 / m, + = turning left). */
  kappa: Float64Array;
  /** Signed superelevation (+ = banked to the left). */
  e: Float64Array;
  /**
   * Cross slope (fall per metre moving away from the centre line) of the left / right carriageway. Main deck: both 2 % on a tangent (crown at the median);
   * a ramp is one plane: cl = bank, cr = -bank.
   */
  cl: Float64Array;
  cr: Float64Array;
  /** Girder depth (m) under the station: 0 = embankment / retained fill / at grade (no girder, no piers). */
  girder: Float64Array;
  /** 1 = the station is on a viaduct, 0 = on fill. */
  viaduct: Uint8Array;
  /** Extra deck width (m) on the left / right: aux lanes at ramps. */
  wl: Float64Array;
  wr: Float64Array;
  /** 1 = no parapet on that side at the station (a lane / ramp joins there). */
  openL: Uint8Array;
  openR: Uint8Array;
  /** Ramp data (kind === 'ramp'). */
  ramp?: XRampInfo;
  label?: string;
}

export interface XPier {
  routeId: number;
  /** Station (m along the route) and the unit direction of the deck there. */
  s: number;
  dx: number;
  dz: number;
  /** Centre of the pier (on the deck centre line) and the arrangement: single column, median (on the yellow line of a highway), portal (two columns beside a road), ramp column, abutment. */
  x: number;
  z: number;
  kind: 'single' | 'median' | 'portal' | 'ramp' | 'abutment';
  /** Columns: world x, z. Size across the deck (b) and along it (t), m. */
  cols: { x: number; z: number }[];
  b: number;
  t: number;
  /** Cap beam: top height, depth, half length (across the deck), roll (rad) of the deck there. */
  capTop: number;
  capDepth: number;
  capHalf: number;
  roll: number;
  /** Foundation level (m) and the ground level at the pier. */
  bottom: number;
  ground: number;
  /** Span before / after (m) and the deck surface height at the pier. */
  spanA: number;
  spanB: number;
  deckY: number;
  /** Highway it stands on (median piers). */
  onRoad?: string;
}

export interface XSpan {
  routeId: number;
  s0: number;
  s1: number;
  length: number;
  depth: number;
  material: 'pc-girder' | 'pc-box' | 'steel-box';
}

export interface XInterchange {
  n: number;
  id: string;
  kind: 'service' | 'terminal' | 'system';
  x: number;
  z: number;
  routeId: number;
  s: number;
  rampIds: number[];
  /** System interchange: the ring route and the station of the junction on it. */
  ringRoute?: number;
  ringS?: number;
  /** Ordinary road it connects to (name) or the other route (system). */
  roads: string[];
}

export interface XLamp {
  x: number;
  z: number;
  y: number;
  /** Unit direction across the deck pointing over the carriageway (the arm). */
  ax: number;
  az: number;
  routeId: number;
}
export interface XSign {
  x: number;
  z: number;
  y: number;
  /** Deck direction. */
  dx: number;
  dz: number;
  routeId: number;
  /** Half span (m) of the gantry, the exit it announces (interchange n) and the distance (m). */
  half: number;
  n: number;
  dist: number;
  /** +1 = faces traffic going along +s, -1 = against. */
  face: number;
}
export interface XScupper {
  x: number;
  z: number;
  y: number;
  routeId: number;
  side: number;
}
export interface XCushion {
  x: number;
  z: number;
  y: number;
  dx: number;
  dz: number;
  routeId: number;
}
