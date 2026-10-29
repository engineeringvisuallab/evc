/**
 * ELEVATED CARGO EXPRESSWAY - MASTER PLAN (data only). Design numbers live in ExpresswayStandards.ts.
 *
 * One expressway of two 4-lane carriageways (4 + 4 = 8 lanes) for freight, planned for the WHOLE map:
 *   - the RING ("outer logistics ring", a 'C' open at the north-west where a mountain ridge blocks it; it keeps clear of the army camp, the airports,
 *     the railway stations and the land kept for the future airport) runs through open country between the middle ring road and the outer freeway
 *     and touches every logistics, industry, farm and utility district. Outside the city the line goes where the engineer can make it straight:
 *     long tangents, circular arcs with clothoid transitions, never tighter than the design radius;
 *   - two SPOKES cross the city centre. They run ALONG the big highways F6+F7 (west-east) and F4 (north), so the expressway deck is centred on the
 *     highway and the piers stand on its yellow centre line (median piers) or beside the road; the highway keeps running underneath. Highway F5 is not
 *     used in the south: it runs under two elevated railway stations, so the north-south spoke stops at the edge of the centre.
 *     The north-south spoke crosses the west-east one at the centre, OVER it;
 *   - the PORT SPUR leaves the ring at the south-east and ends at the seaport;
 *   - every spoke / spur meets the ring in a directional T interchange (flyover ramps), the ring ends and the spur end are terminal interchanges,
 *     and in between there are service interchanges with separate one-way exit and entrance ramps and a new link road to an ordinary road.
 *
 * Units: metres, x east, z south, map centre 0,0.
 */

export type XKind = 'ring' | 'spur' | 'diameter' | 'ramp';

export interface XRoutePlan {
  name: string;
  kind: 'ring' | 'spur' | 'diameter';
  /** 'free' = the router finds the way, then straight tangents + curves are fitted; 'follow' = the centre line of the named highways (in order). */
  mode: 'free' | 'follow';
  /** free: waypoints (hints). */
  pts?: readonly (readonly [number, number])[];
  /** follow: highway names in order; `reverse[i]` turns highway i around. */
  highways?: readonly string[];
  reverse?: readonly boolean[];
  /** free: use the waypoints as they are (no path search). */
  direct?: boolean;
  /** follow: after the highways the guide continues through these waypoints (free routing). */
  then?: readonly (readonly [number, number])[];
  /** The route ends on the ring: it is cut `T_STANDOFF` m before it comes near it (room for the T interchange). */
  joinsRing?: boolean;
  /** Smallest radius (m) of this route. The ring keeps the full 450 m; the city spokes may go down to 300 m (advisory speed 70 km/h on those curves). */
  rMin?: number;
  /** follow: points closer than this to the map centre are dropped: the route stops there (a terminal interchange). */
  stopShort?: number;
  /** follow: keep only the part of the guide inside this window (any side left out is open). */
  clip?: { x0?: number; z0?: number; x1?: number; z1?: number };
}

export const RING = 'XR';
export const RING2 = 'XS';

const N8: readonly [number, number] = [560, -3420];
const N9: readonly [number, number] = [-2450, -300];

export const ROUTE_PLANS: readonly XRoutePlan[] = [
  {
    // The ring is a 'C' open to the north-west (the mountains there, 70-200 m high, cannot be crossed by a deck with a 3 % grade limit) AND cut in two in the
    // east: between the east-works station and the transport area the fenced engineering areas (automation, mech works, dam, transport), the river valley and the
    // hills leave no 43 m wide corridor, and in the south the plants block the way between x = -440 and 590. So the ring is three arcs: XR (north -> east), XS (port -> south coast) and XT (south-west -> west farms). Every end is a terminal interchange.
    name: RING,
    kind: 'ring',
    mode: 'free',
    direct: true,
    pts: [N8, [900, -3300], [1300, -3300], [1700, -3250], [2050, -2900], [2250, -2300], [2330, -1700], [2330, -1100], [2640, -640], [2650, -100]],
  },
  {
    // port gate -> north -> west along the south coast plain, as far as the grid plant (the old spur is the first km). West of it the sewage treatment plant, the grid
    // plant, the south-interchange railway station and the future airport land leave no 43 m corridor between x = -440 and x = 590, so the arc ends there.
    name: 'XS',
    kind: 'ring',
    mode: 'free',
    direct: true,
    pts: [[2060, 2470], [2060, 1900], [1350, 1900], [900, 1950], [720, 1960]],
  },
  {
    // the west arc: from the corridor between the sewage plant and the future airport land round the south-west to the west farms
    name: 'XT',
    kind: 'ring',
    mode: 'free',
    direct: true,
    pts: [[-480, 2305], [-1250, 2300], [-1250, 1900], [-1500, 1500], [-2240, 1360], [-2500, 1100], [-2650, 600], N9],
  },
  // The centre of the city cannot take an 8-lane deck: the mall and the library stand 34 m apart across highway F7 (the deck is 42.8 m wide) and the
  // police plot, the EV lab and four highways meet there. So the west-east spoke is two routes on the yellow lines of F6 (west) and F7 (east); each stops at the edge of the centre
  // in a terminal interchange (freight lands on the ordinary streets there).
  { name: 'XW', kind: 'diameter', mode: 'follow', highways: ['F6'], joinsRing: true, rMin: 300, stopShort: 850 },
  { name: 'XE', kind: 'diameter', mode: 'follow', highways: ['F7'], joinsRing: true, rMin: 300, stopShort: 850 },
  // from the north ring into the city along highway F4 (turned around). It stops 1 km short of the centre, at the edge of the dense centre, in a terminal
  // interchange: highway F5 (the way on) runs under two elevated railway stations, so the deck cannot follow it.
  { name: 'XN', kind: 'diameter', mode: 'follow', highways: ['F4'], reverse: [true], rMin: 300, stopShort: 1000, clip: { z0: -2850 } },
];

/** A service / terminal interchange: roughly where along which route, and what kind. */
export interface XInterchangePlan {
  n: number;
  id: string;
  route: string;
  /** Hint position: the interchange goes to the best crossing road near it. */
  x: number;
  z: number;
  /** 'terminal' = the end of a route: the carriageways come down to the ground and meet an ordinary road there. */
  kind: 'service' | 'terminal';
  end?: 'start' | 'end';
}

export const INTERCHANGES: readonly XInterchangePlan[] = [
  { n: 1, id: 'port-gate', route: 'XS', x: 2060, z: 2470, kind: 'terminal', end: 'start' },
  { n: 8, id: 'north-end', route: 'XR', x: N8[0], z: N8[1], kind: 'terminal', end: 'start' },
  { n: 3, id: 'east-end', route: 'XR', x: 2650, z: -100, kind: 'terminal', end: 'end' },
  { n: 4, id: 'north-heavy', route: 'XR', x: 1300, z: -3300, kind: 'service' },
  { n: 5, id: 'east-farms', route: 'XR', x: 2250, z: -2300, kind: 'service' },
  { n: 9, id: 'west-farms', route: 'XT', x: N9[0], z: N9[1], kind: 'terminal', end: 'end' },
  { n: 10, id: 'sw-farms', route: 'XT', x: -1500, z: 1500, kind: 'service' },
  { n: 11, id: 'south-gate', route: 'XT', x: -480, z: 2305, kind: 'terminal', end: 'start' },
  { n: 12, id: 'airport-link', route: 'XS', x: 1500, z: 1900, kind: 'service' },
  { n: 6, id: 'grid-end', route: 'XS', x: 720, z: 1960, kind: 'terminal', end: 'end' },
  { n: 13, id: 'city-west', route: 'XW', x: -850, z: 0, kind: 'terminal', end: 'end' },
  { n: 14, id: 'city-east', route: 'XE', x: 850, z: 0, kind: 'terminal', end: 'start' },
  { n: 16, id: 'city-centre', route: 'XN', x: 200, z: -1000, kind: 'terminal', end: 'end' },
  { n: 15, id: 'north-link', route: 'XN', x: 269, z: -2843, kind: 'terminal', end: 'start' },
];

/** Where a spoke / spur reaches the ring: a directional T (system) interchange with flyover ramps. */
export const SYSTEM_JOINTS: readonly { id: string; route: string; end: 'start' | 'end' }[] = [
  { id: 'T-west', route: 'XW', end: 'start' },
  { id: 'T-east', route: 'XE', end: 'end' },
];
