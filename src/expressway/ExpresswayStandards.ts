/**
 * EXPRESSWAY DESIGN STANDARDS (data + formulas, no game code).
 *
 * Sources: AASHTO "A Policy on Geometric Design of Highways and Streets" (Green Book, 7th ed., metric) for the alignment,
 * the cross-section, ramps and sight distance; AASHTO LRFD Bridge Design Specifications for loads (HL-93), girder depth and
 * barrier test levels; Bangladesh RHD "Road Design Standards" / LGED guidance for the vertical clearances over roads and the
 * inland-waterway (BIWTA) clearance over rivers; Bangladesh Railway / 25 kV AC practice for the clearance over the railway.
 * Bangladesh drives on the LEFT (the game does too): every AASHTO rule that says "right" (exit, entrance, kerb lane) is MIRRORED here.
 *
 * Where a number is stricter than the minimum it says so. Every number used by the network, the builder and the test is here,
 * so docs/EXPRESSWAY_DESIGN.md and scripts/expressway-test.ts can quote it.
 * Units: metres, seconds, radians unless the name says otherwise. Grades and cross slopes are rise / run (0.03 = 3 %).
 */

export const XD = {
  /* ------------------------------------------------------------ traffic */
  /** Vehicles keep to the left; the kerb lane, the exit and the entrance are on the LEFT of the direction of travel. */
  leftHandTraffic: true,
  /** Design speed (km/h): main carriageway / ramp (connector) / tight loop. */
  designSpeed: 80,
  rampSpeed: 50,
  loopSpeed: 40,

  /* -------------------------------------------------- cross-section (one carriageway = one direction) */
  lanes: 4,
  laneW: 3.6,
  /** Shoulder on the median side (>= 1.2 m; 3.0 m where a carriageway has 4+ lanes: AASHTO GB 4.4.2) and on the kerb side (emergency stop of a truck). */
  innerShoulder: 3.0,
  outerShoulder: 3.0,
  /** Median: ONE concrete F-shape barrier, 0.81 m high, 1.0 m at the base (AASHTO LRFD TL-4). */
  medianHalf: 0.5,
  medianH: 0.81,
  /** Edge parapet for trucks (TL-4/5): 1.07 m high, 0.5 m thick. */
  parapetW: 0.5,
  parapetH: 1.07,
  /** Normal cross slope of a carriageway (falls to the outer edge, where the scuppers are). */
  crown: 0.02,

  /* ---------------------------------------------------------- horizontal alignment */
  /** AASHTO minimum radius for 80 km/h at e_max = 6 % (GB table 3-8b) ... */
  rMinAashto: 250,
  /**
   * ... but the ring needs more: the median barrier blocks the view across the inside of a curve. Stopping sight distance 130 m with the
   * obstruction (innerShoulder + laneW/2) = 4.8 m from the centre of the inside lane gives R >= S^2 / (8 m) = 440 m. Design minimum: 450 m.
   */
  rMin: 450,
  eMax: 0.06,
  /** Relative gradient of the edge of a carriageway against the pivot (median) line: 0.50 % at 80 km/h (GB table 3-15, 1:200). */
  relGradient: 0.005,
  /** Shortest tangent kept between two curves (m) and clothoid (spiral) length limits. */
  minTangent: 30,
  lsMin: 60,
  /** C = 0.6 m/s^3 (a comfortable rate of lateral acceleration) for the spiral length L = 0.0214 V^3 / (R C). */
  cRate: 0.6,

  /* ------------------------------------------------------------ vertical alignment */
  /** Steepest grade of the main deck (trucks). */
  maxGrade: 0.03,
  /** Rate of vertical curvature K = L / A (m per % of grade change) for 80 km/h and a 130 m stopping sight distance. */
  kCrest: 26,
  kSag: 30,
  ssd: 130,
  /** Eye 1.08 m, object 0.60 m (GB 3.2.2). */
  eyeH: 1.08,
  objH: 0.6,
  /** Ramps at 50 km/h: stricter than AASHTO (K crest 7 / sag 13). */
  rampKCrest: 10,
  rampKSag: 15,
  rampMaxGrade: 0.06,
  /** Deck surface is never lower than this above the natural ground (m): the embankment / retained fill top. */
  embankTop: 0.7,
  /** Deck within this height (m) of the ground is an embankment / retained fill (no piers); higher = viaduct. */
  embankMax: 3.0,

  /* -------------------------------------------------------------- clearances */
  /** Vertical clearance (m) from the road surface (or rail head / flood water level) to the SOFFIT (underside) of the girder. */
  clearRoad: 5.5,
  /** Railway: 25 kV AC overhead line (contact wire 5.5 m, messenger 6.9 m above the top of ballast) + 0.6 m electrical clearance: 7.5 m. Rail head is 0.2 m above the ballast. */
  clearRail: 7.5,
  /** Rivers: BIWTA class IV 5.0 m above the highest flood level (= water surface + 1.0 m here). */
  clearRiver: 6.0,
  /** Horizontal: a pier column stays this far (m) from the edge of the road shoulder, the railway land, a building, a pad. */
  pierGapRoad: 1.5,
  pierGapRail: 3.0,
  pierGapBuilding: 4.0,
  /** Highway median pier: a pier on the yellow line must be within this distance (m) of the highway centre line and nearly parallel to it. */
  medianBand: 1.5,

  /* --------------------------------------------------------------- structure */
  /** Wearing course, deck slab. */
  asphalt: 0.1,
  slab: 0.25,
  /** Normal span, shortest / longest (m). Prestressed concrete I / box girder, depth = span / 19 (AASHTO LRFD table 2.5.2.6.3-1: 0.045 L simple, 0.040 L continuous). */
  spanNormal: 36,
  spanMin: 30,
  spanMax: 40,
  /** Special spans (over a road that crosses at a skew, a junction, a bridge): prestressed box girder up to 70 m. */
  spanSpecial: 70,
  /** River / long span: haunched steel box girder, depth = span / 30 (AASHTO 0.033 L), up to this length. */
  spanLong: 160,
  /** Pier foundations are this deep below the ground (m). */
  footing: 1.5,
  /** Concrete strength (MPa) and the allowed service stress ratio of a pier column. */
  fc: 40,
  /** Design loads: HL-93 (AASHTO LRFD 3.6.1.2): truck 325 kN, lane 9.3 kN/m, dynamic allowance 33 %, multiple presence 0.65 for 4+ lanes. */
  hl93Truck: 325,
  hl93Lane: 9.3,
  impact: 0.33,
  multiPresence: 0.65,
  concreteDensity: 24, // kN/m^3
  asphaltDensity: 22.5,

  /* ---------------------------------------------------------------- ramps */
  /** One-way ramp cross-section: 1 lane = 3.6 + 1.2 + 1.2 = 6.0 m; 2 lanes = 2 x 3.5 + 0.8 + 0.8 = 8.6 m. */
  ramp1W: 6.0,
  ramp2W: 8.6,
  rampMinRadius: 90, // 50 km/h: V^2 / (127 (e + f)) with e = 6 %, f = 0.16 -> 90 m (the brief asks for >= 60 m)
  loopMinRadius: 60, // 40 km/h: 55 m, rounded up (the brief allows 50 m)
  rampEMax: 0.06,
  /** Exit: taper 1:20 (1:15..1:25), parallel deceleration lane 130 m (100..150 m). Entrance: parallel acceleration lane 250 m (200..300 m), taper 1:20. */
  taperRatio: 20,
  decelLen: 130,
  accelLen: 250,
  /** Gore (paved wedge) after the nose, and the crash cushion at the nose. */
  goreLen: 40,
  cushionLen: 6,
  /** Ordinary-road merge: the ramp runs alongside the kerb lane and merges with a taper 1:15 (the road traffic never stops). */
  mergeRatio: 15,
  /** Ramp pier span (m). */
  rampSpan: 26,

  /* ----------------------------------------------------------- interchanges */
  /** Spacing of interchange noses along the same route (m): urban >= 1.5 km. Weaving length between an entrance nose and the next exit nose >= 450 m. */
  interchangeSpacing: 1500,
  weaveMin: 450,

  /* ---------------------------------------------------------------- furniture */
  lampSpacing: 36,
  scupperSpacing: 30,
  /** Gantry signs before an exit nose (m). */
  signDistances: [1000, 500, 250] as readonly number[],
} as const;

/* ------------------------------------------------------------------- derived numbers */

/** Width of one carriageway: inner shoulder + lanes + outer shoulder = 20.4 m. */
export const CARRIAGEWAY_W = XD.innerShoulder + XD.lanes * XD.laneW + XD.outerShoulder;
/** Half width of the whole deck (centre line to the outside of the parapet) = 21.4 m. */
export const DECK_HALF = XD.medianHalf + CARRIAGEWAY_W + XD.parapetW;
/** Distance of the first lane edge from the centre line (median half + inner shoulder). */
export const LANE_START = XD.medianHalf + XD.innerShoulder;
/** Lateral position (from the centre line) of the centre of a carriageway. */
export const CARRIAGEWAY_MID = XD.medianHalf + CARRIAGEWAY_W / 2;
/** Outer lane edge (kerb lane outside) from the centre line. */
export const LANE_OUT = LANE_START + XD.lanes * XD.laneW;

/* ----------------------------------------------------------------- formulas */

const KMH = 1 / 3.6;

/** Stopping sight distance (m): 2.5 s reaction + braking at 3.4 m/s^2 on a grade G (AASHTO GB eq. 3-1). */
export function stoppingSightDistance(vKmh: number, grade = 0): number {
  return 0.278 * vKmh * 2.5 + (vKmh * vKmh) / (254 * (3.4 / 9.81 + grade));
}

/** Smallest K that gives sight distance S on a crest curve (h1 1.08 m, h2 0.60 m): K = S^2 / 658. */
export function crestKForSight(s: number): number {
  const a = Math.sqrt(2 * XD.eyeH) + Math.sqrt(2 * XD.objH);
  return (s * s) / (100 * a * a);
}
/** Sight distance (m) a crest curve of rate K gives. */
export function crestSight(k: number): number {
  return Math.sqrt(658 * k);
}
/** Sag curve (headlight 0.6 m, 1 degree): K = S^2 / (120 + 3.5 S). */
export function sagKForSight(s: number): number {
  return (s * s) / (120 + 3.5 * s);
}
/** Sight distance (m) a sag curve of rate K gives (solves K = S^2 / (120 + 3.5 S)). */
export function sagSight(k: number): number {
  return (3.5 * k + Math.sqrt(12.25 * k * k + 480 * k)) / 2;
}

/** Radius needed so the median barrier does not block sight distance S: R >= S^2 / (8 m), m = clear distance to the barrier from the centre of the inside lane. */
export function radiusForSight(s: number, m: number): number {
  return (s * s) / (8 * m);
}
/** Lateral clearance m (m) a curve of radius R needs for sight distance S: m = R (1 - cos(28.65 S / R)). */
export function sightClearanceNeeded(s: number, r: number): number {
  return r * (1 - Math.cos(((28.65 * s) / r) * (Math.PI / 180)));
}

/**
 * Superelevation (rise / run) for a curve of radius R at e_max = 6 %, 80 km/h. AASHTO method 5 gives a nearly parabolic curve of e against 1/R, which is
 * e = e_max (2 k - k^2) with k = R_min(250) / R. (R = 250 -> 6.0 %; 450 -> 4.8 %; 1000 -> 2.6 %; 1500 -> 1.8 %.) Returns 0 where the normal crown is enough (< 2 %).
 */
export function superelevation(r: number, vKmh: number = XD.designSpeed): number {
  const rMin = (vKmh * vKmh) / (127 * (XD.eMax + 0.14)); // 80 km/h, f = 0.14 -> 252 m
  const k = Math.min(1, rMin / Math.max(r, rMin));
  const e = XD.eMax * (2 * k - k * k);
  return e < XD.crown ? 0 : e;
}

/** Side friction demanded (e + f = V^2 / (127 R)) -> f (must stay <= 0.14 at 80 km/h). */
export function frictionDemand(r: number, e: number, vKmh: number = XD.designSpeed): number {
  return (vKmh * vKmh) / (127 * r) - e;
}

/** Fastest the superelevation may change per metre: relative gradient / (2 x the carriageway width), the 2 covers the crown-removal phase. */
export const E_RATE = XD.relGradient / (2 * CARRIAGEWAY_W);

/** Shortest spiral (m): the larger of the comfort length 0.0214 V^3 / (R C) and `lsMin`. */
export function spiralLength(r: number, vKmh: number = XD.designSpeed): number {
  return Math.max(XD.lsMin, (0.0214 * vKmh ** 3) / (r * XD.cRate));
}

/** Depth (m) of the main girder for a span (m): PC girder span / 19, haunched steel box span / 30. */
export function girderDepth(span: number): number {
  return span > XD.spanSpecial ? span / 30 : span / 19;
}
/** From the road surface down to the soffit of the girder (asphalt + slab + girder). */
export function structuralDepth(span: number): number {
  return XD.asphalt + XD.slab + girderDepth(span);
}

/** Ramp superelevation (rise / run) for a ramp of radius R and speed V (same parabola, e_max 6 %, f_max = 0.16 at 50 km/h, 0.17 at 40 km/h). */
export function rampSuperelevation(r: number, vKmh: number): number {
  const f = vKmh <= 40 ? 0.17 : 0.16;
  const rMin = (vKmh * vKmh) / (127 * (XD.rampEMax + f));
  const k = Math.min(1, rMin / Math.max(r, rMin));
  const e = XD.rampEMax * (2 * k - k * k);
  return Math.max(XD.crown, e); // a ramp is a single plane: never flatter than the normal crown
}

/* ------------------------------------------------------------ structural check */

export interface PierDesign {
  /** Column size: across the deck (b) and along it (t), m. */
  b: number;
  t: number;
  /** Cap beam (hammerhead) depth, m. */
  capDepth: number;
  /** Axial load (service, MN), bending moment from one-carriageway-only live load (MNm), service stress (MPa), allowed (MPa). */
  axial: number;
  moment: number;
  stress: number;
  allowed: number;
  /** Strength I factored axial load (MN) and the capacity of the column at 2 % steel (MN). */
  pu: number;
  phiPn: number;
  ok: boolean;
}

/**
 * HL-93 check of a pier. `width` = deck width (m), `span` = mean of the two spans (m), `carriageways` = 2 for the main deck, 1 for a ramp.
 * Dead load: concrete slab + box girder (area per carriageway from the girder depth), wearing course, barriers. Live load: one design truck (325 kN, two heavy axles
 * on the reaction line) + the lane load over the span, per lane, x 1.33 dynamic allowance on the truck, x 0.65 multiple presence for 4+ loaded lanes.
 * The column is sized in `pierSize()`; this only evaluates it.
 */
export function pierLoads(width: number, span: number, carriageways: number, lanesPerCarriageway: number): { dc: number; dw: number; ll: number } {
  const D = girderDepth(span);
  const cw = width / carriageways;
  // concrete area per carriageway: slab + two webs + bottom flange of a box girder (webs 0.4 m, bottom flange 0.22 m x 55 % of the width)
  const area = XD.slab * cw + 2 * 0.4 * D + 0.22 * cw * 0.55;
  const dcPerM = carriageways * area * XD.concreteDensity + carriageways * 12.8 + (carriageways === 2 ? 25 : 0); // + parapets + median barrier (kN/m)
  const dwPerM = XD.asphalt * width * XD.asphaltDensity;
  const lanes = carriageways * lanesPerCarriageway;
  const m = lanes > 3 ? XD.multiPresence : lanes === 3 ? 0.85 : 1;
  const llLane = (XD.hl93Truck * 0.95 * (1 + XD.impact) + XD.hl93Lane * span) * m; // kN per lane at an interior pier (two spans loaded)
  return { dc: (dcPerM * span) / 1000, dw: (dwPerM * span) / 1000, ll: (lanes * llLane) / 1000 };
}

export function pierSize(width: number, span: number, carriageways: number, lanesPerCarriageway: number): PierDesign {
  const { dc, dw, ll } = pierLoads(width, span, carriageways, lanesPerCarriageway);
  const axial = dc + dw + ll;
  const pu = 1.25 * dc + 1.5 * dw + 1.75 * ll;
  // one carriageway fully loaded, the other empty: eccentricity = carriageway mid-line
  const ecc = carriageways === 2 ? CARRIAGEWAY_MID : 0.4 * width;
  const mLive = (ll / carriageways) * ecc + (carriageways === 2 ? 0 : 0);
  const moment = mLive + 0.1 * (dc / 2) * ecc * 0; // dead load is symmetric
  // column: wide across the deck for the main deck, small for a ramp
  const b = carriageways === 2 ? Math.max(3.2, Math.ceil((width * 0.085) * 10) / 10) : Math.max(1.6, Math.ceil(width * 0.28 * 10) / 10);
  const t = carriageways === 2 ? 2.2 : 1.6;
  const A = b * t;
  const Z = (t * b * b) / 6;
  const stress = axial / A + moment / Z;
  const allowed = 0.45 * XD.fc;
  // axial capacity: phi 0.75, 0.80 factor for tied columns, 2 % steel (fy 420 MPa)
  const phiPn = 0.75 * 0.8 * (0.85 * XD.fc * 0.98 + 420 * 0.02) * A;
  return { b, t, capDepth: carriageways === 2 ? 2.4 : 1.4, axial, moment, stress, allowed, pu, phiPn, ok: stress <= allowed && pu <= phiPn };
}

/** km/h -> m/s. */
export const kmh = (v: number): number => v * KMH;
