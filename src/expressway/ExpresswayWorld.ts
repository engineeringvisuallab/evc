import { AIRPORT, AIRPORT_SEA, ARMY, SEAPORT } from '../city/WorldZones';
import { ENGINEERING_AREAS } from '../city/EngineeringZones';
import { BUILDING_PLACEMENTS } from '../buildings/Placements';
import { MALL_PLOT } from '../mall/MallSite';
import { LIBRARY_PLOT } from '../library/LibrarySite';
import { PROTO_PLOT } from '../buildings/ProtoSite';
import { EVLAB_PLOT } from '../evlab/EVLabSite';
import { FILL_PLACEMENTS } from '../buildings/PlacementsFill';
import { XD } from './ExpresswayStandards';
import { cellKey, inObb, pointSeg, rectDist, segSegDist } from './ExpresswayMath';

/**
 * "What else stands here?" for the expressway engineer. One index of everything the expressway must not run into or must clear:
 *   ordinary roads (asphalt + shoulder), junction pads, road bridges, the railway (formation, viaducts, stations), rivers / lakes / sea,
 *   buildings, building pads (mall, library, labs ...), the army camp, the airport, the seaport, the fenced engineering areas and
 *   the land kept for the future second airport.
 * Everything is answered from the finished data of the game (the same arrays the road / rail / terrain code uses), never guessed.
 */

export interface XTerrainSample {
  h: number;
  water: number;
  fx: number;
  fz: number;
}
export interface XRoadLike {
  id: number;
  name: string;
  tier: number;
  closed: boolean;
  earth?: boolean;
  halfWidth: number;
  shoulder: number;
  xs: ArrayLike<number>;
  zs: ArrayLike<number>;
  ys: ArrayLike<number>;
  bridgeOf: ArrayLike<number>;
}
export interface XRailLike {
  edges: readonly {
    xs: ArrayLike<number>;
    zs: ArrayLike<number>;
    design: ArrayLike<number>;
    cum: ArrayLike<number>;
    segments: readonly { kind: string; s0: number; s1: number }[];
  }[];
  stations: readonly { x: number; z: number; radius: number }[];
  piers: readonly { x: number; z: number }[];
}
interface NearSite {
  near(x: number, z: number): boolean;
}
/** The part of the game's TerrainGenerator the expressway uses (so the headless test and the engine pass the same object). */
export interface XTerrain {
  heightAt(x: number, z: number): number;
  makeSample?(): XTerrainSample;
  sample?(x: number, z: number, out: XTerrainSample): void;
  rail?: XRailLike;
  roads?: { pads: readonly { x: number; z: number; y: number; rCore: number }[] };
  mall?: NearSite;
  evlab?: NearSite;
  library?: NearSite;
  protoBuilding?: NearSite;
  airport?: NearSite;
  army?: NearSite;
  agro?: NearSite;
  infra?: readonly NearSite[];
}
/** Rectangles the expressway keeps out of (world metres). */
export interface XAvoid {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Extra clearance around it (m). */
  margin: number;
}

/** A road (or rail, pad) that passes under a piece of deck. */
export interface XHit {
  kind: 'road' | 'rail' | 'pad';
  /** Index of the road / rail edge / pad. */
  ref: number;
  tier: number;
  name: string;
  /** Surface height of the feature where it passes under the deck (road surface, rail head, pad surface). */
  top: number;
  /** Vertical clearance (m) from `top` to the soffit that the standard asks for. */
  clear: number;
  /** Distance (m) between the deck cross-section line and the feature centre line (0 = they cross). */
  d: number;
  onBridge: boolean;
}

const CELL = 48;
const RAIL_ROW_HALF = 14;
const RAIL_FORM_HALF = 11;
const BUILDING_MARGIN = 3;
const PLOT_MARGIN = 2;
const PLOTS: readonly { id: string; x0: number; z0: number; x1: number; z1: number }[] = [
  { id: 'mall', ...MALL_PLOT },
  { id: 'library', ...LIBRARY_PLOT },
  { id: 'police', ...PROTO_PLOT },
  { id: 'evlab', ...EVLAB_PLOT },
];

const ARMY_MARGIN = 70;
const AIRPORT_MARGIN = 60;
const SEAPORT_MARGIN = 0;
/** The land west of the seaport kept for the second (future) airport: x < SEAPORT.x0, z >= 2400 (+30 m margin). */
export const FUTURE_AIRPORT = { x1: SEAPORT.x0, z0: 2400, margin: 30 };

interface Building {
  x: number;
  z: number;
  hw: number;
  hd: number;
  yaw: number;
  r: number;
  id: string;
}

export class XWorld {
  private sc: XTerrainSample;

  // roads
  private roads: readonly XRoadLike[];
  private segRoad: number[] = [];
  private segIdx: number[] = [];
  private segEnd: number[] = [];
  private roadCells = new Map<number, number[]>();
  private stamp: Int32Array;
  private stampN = 0;

  // rail
  private railPts: { x: number; z: number; top: number; under: boolean; edge: number }[][] = [];
  private railSegs: { a: number; i: number }[] = [];
  private railCells = new Map<number, number[]>();
  private railPierCells = new Map<number, { x: number; z: number }[]>();
  private railStamp: Int32Array;

  // pads, buildings
  private pads: { x: number; z: number; y: number; r: number }[] = [];
  private padCells = new Map<number, number[]>();
  private buildings: Building[] = [];
  private buildingCells = new Map<number, number[]>();

  private nearSites: NearSite[] = [];
  private hardSites: NearSite[] = [];
  private avoid: readonly XAvoid[];

  constructor(
    private terrain: XTerrain,
    roads: readonly XRoadLike[],
    avoid: readonly XAvoid[],
  ) {
    this.sc = terrain.makeSample ? terrain.makeSample() : { h: 0, water: NaN, fx: 0, fz: 0 };
    this.roads = roads;
    this.avoid = avoid;
    this.indexRoads();
    this.indexRail();
    this.indexPads();
    this.indexBuildings();
    for (const s of [terrain.mall, terrain.evlab, terrain.library, terrain.protoBuilding, terrain.airport, terrain.army, terrain.agro]) if (s) this.nearSites.push(s);
    for (const s of [terrain.agro, ...(terrain.infra ?? [])]) if (s) this.hardSites.push(s);
    this.stamp = new Int32Array(this.segRoad.length);
    this.railStamp = new Int32Array(this.railSegs.length);
  }

  /* ---------------------------------------------------------------- terrain */

  /** Ground height (roads, rails and pads already cut in). */
  ground(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  /** Ground height and water surface (NaN when dry) at a point. The returned object is reused by the next call. */
  sample(x: number, z: number): XTerrainSample {
    if (this.terrain.sample) this.terrain.sample(x, z, this.sc);
    else {
      this.sc.h = this.terrain.heightAt(x, z);
      this.sc.water = NaN;
    }
    return this.sc;
  }

  /** Is there water (river, lake, pond, sea) standing at the point? */
  isWet(x: number, z: number): boolean {
    const s = this.sample(x, z);
    return !Number.isNaN(s.water) && s.h < s.water;
  }

  /** Highest ground over a straight cross-section line (n points), and the highest water surface (NaN = no water) on it. */
  across(ax: number, az: number, bx: number, bz: number, n: number): { ground: number; water: number } {
    let g = -Infinity;
    let w = NaN;
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0.5 : k / (n - 1);
      const s = this.sample(ax + (bx - ax) * t, az + (bz - az) * t);
      if (s.h > g) g = s.h;
      if (!Number.isNaN(s.water) && s.h < s.water && (Number.isNaN(w) || s.water > w)) w = s.water;
    }
    return { ground: g, water: w };
  }

  /* ------------------------------------------------------------------ roads */

  private indexRoads(): void {
    for (const r of this.roads) {
      const n = r.xs.length;
      const segs = r.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % n;
        const id = this.segRoad.length;
        this.segRoad.push(r.id);
        this.segIdx.push(i);
        this.segEnd.push(j);
        const x0 = Math.min(r.xs[i], r.xs[j]);
        const x1 = Math.max(r.xs[i], r.xs[j]);
        const z0 = Math.min(r.zs[i], r.zs[j]);
        const z1 = Math.max(r.zs[i], r.zs[j]);
        for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
          for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
            const k = cellKey(cx, cz);
            const a = this.roadCells.get(k);
            if (a) a.push(id);
            else this.roadCells.set(k, [id]);
          }
        }
      }
    }
  }

  private roadById = new Map<number, XRoadLike>();
  private road(id: number): XRoadLike {
    let r = this.roadById.get(id);
    if (!r) {
      r = this.roads.find((q) => q.id === id)!;
      this.roadById.set(id, r);
    }
    return r;
  }

  /** Road segments whose bounding cells touch the box. Calls `fn(segId)` once per segment. */
  private forRoadSegs(x0: number, z0: number, x1: number, z1: number, fn: (seg: number) => void): void {
    this.stampN++;
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        const a = this.roadCells.get(cellKey(cx, cz));
        if (!a) continue;
        for (const s of a) {
          if (this.stamp[s] === this.stampN) continue;
          this.stamp[s] = this.stampN;
          fn(s);
        }
      }
    }
  }

  /** The nearest road centre line to a point within `reach` m: distance, the road, the segment, parameter and surface height. */
  nearestRoad(x: number, z: number, reach: number): { road: XRoadLike; i: number; j: number; d: number; t: number; y: number; px: number; pz: number; tx: number; tz: number; onBridge: boolean } | null {
    let best: ReturnType<XWorld['nearestRoad']> = null;
    this.forRoadSegs(x - reach, z - reach, x + reach, z + reach, (s) => {
      const r = this.road(this.segRoad[s]);
      const i = this.segIdx[s];
      const j = this.segEnd[s];
      const q = pointSeg(x, z, r.xs[i], r.zs[i], r.xs[j], r.zs[j]);
      if (q.d < reach && (!best || q.d < best.d)) {
        const l = Math.hypot(r.xs[j] - r.xs[i], r.zs[j] - r.zs[i]) || 1;
        best = {
          road: r,
          i,
          j,
          d: q.d,
          t: q.t,
          y: r.ys[i] + (r.ys[j] - r.ys[i]) * q.t,
          px: r.xs[i] + (r.xs[j] - r.xs[i]) * q.t,
          pz: r.zs[i] + (r.zs[j] - r.zs[i]) * q.t,
          tx: (r.xs[j] - r.xs[i]) / l,
          tz: (r.zs[j] - r.zs[i]) / l,
          onBridge: r.bridgeOf[i] >= 0 || r.bridgeOf[j] >= 0,
        };
      }
    });
    return best;
  }

  /** Every road that passes under / through the cross-section line a-b (within its asphalt + shoulder). */
  roadsUnder(ax: number, az: number, bx: number, bz: number, margin = 0): XHit[] {
    const out = new Map<number, XHit>();
    this.forRoadSegs(Math.min(ax, bx) - 40, Math.min(az, bz) - 40, Math.max(ax, bx) + 40, Math.max(az, bz) + 40, (s) => {
      const r = this.road(this.segRoad[s]);
      const i = this.segIdx[s];
      const j = this.segEnd[s];
      const band = r.halfWidth + r.shoulder + margin;
      const q = segSegDist(ax, az, bx, bz, r.xs[i], r.zs[i], r.xs[j], r.zs[j]);
      if (q.d > band) return;
      const top = r.ys[i] + (r.ys[j] - r.ys[i]) * q.u;
      const hit: XHit = {
        kind: 'road',
        ref: r.id,
        tier: r.tier,
        name: r.name,
        top,
        clear: r.earth ? 4.0 : XD.clearRoad,
        d: q.d,
        onBridge: r.bridgeOf[i] >= 0 || r.bridgeOf[j] >= 0,
      };
      const old = out.get(r.id);
      if (!old || hit.top > old.top) out.set(r.id, hit);
    });
    return [...out.values()];
  }

  /* ------------------------------------------------------------------- pads */

  private indexPads(): void {
    for (const p of this.terrain.roads?.pads ?? []) {
      const id = this.pads.length;
      this.pads.push({ x: p.x, z: p.z, y: p.y, r: p.rCore });
      for (let cz = Math.floor((p.z - p.rCore) / CELL); cz <= Math.floor((p.z + p.rCore) / CELL); cz++) {
        for (let cx = Math.floor((p.x - p.rCore) / CELL); cx <= Math.floor((p.x + p.rCore) / CELL); cx++) {
          const k = cellKey(cx, cz);
          const a = this.padCells.get(k);
          if (a) a.push(id);
          else this.padCells.set(k, [id]);
        }
      }
    }
  }

  padsUnder(ax: number, az: number, bx: number, bz: number): XHit[] {
    const out: XHit[] = [];
    const seen = new Set<number>();
    for (let cz = Math.floor((Math.min(az, bz) - 8) / CELL); cz <= Math.floor((Math.max(az, bz) + 8) / CELL); cz++) {
      for (let cx = Math.floor((Math.min(ax, bx) - 8) / CELL); cx <= Math.floor((Math.max(ax, bx) + 8) / CELL); cx++) {
        for (const id of this.padCells.get(cellKey(cx, cz)) ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const p = this.pads[id];
          const q = pointSeg(p.x, p.z, ax, az, bx, bz);
          if (q.d <= p.r) out.push({ kind: 'pad', ref: id, tier: 1, name: 'pad', top: p.y, clear: XD.clearRoad, d: q.d, onBridge: false });
        }
      }
    }
    return out;
  }

  /** Is (x, z) within `margin` m of a junction pad? (radius of the levelled area) */
  nearPad(x: number, z: number, margin: number): boolean {
    for (const id of this.padCells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      const p = this.pads[id];
      if (Math.hypot(x - p.x, z - p.z) < p.r + margin) return true;
    }
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        for (const id of this.padCells.get(cellKey(Math.floor(x / CELL) + dx, Math.floor(z / CELL) + dz)) ?? []) {
          const p = this.pads[id];
          if (Math.hypot(x - p.x, z - p.z) < p.r + margin) return true;
        }
      }
    }
    return false;
  }

  /* -------------------------------------------------------------------- rail */

  private indexRail(): void {
    const rail = this.terrain.rail;
    if (!rail) return;
    rail.edges.forEach((e, ei) => {
      const pts: { x: number; z: number; top: number; under: boolean; edge: number }[] = [];
      for (let i = 0; i < e.xs.length; i++) {
        const s = e.cum[i];
        const under = e.segments.some((sg) => (sg.kind === 'tunnel' || sg.kind === 'cutcover') && s >= sg.s0 - 1 && s <= sg.s1 + 1);
        pts.push({ x: e.xs[i], z: e.zs[i], top: e.design[i] + 0.2, under, edge: ei });
      }
      this.railPts.push(pts);
      for (let i = 0; i + 1 < pts.length; i++) {
        if (pts[i].under && pts[i + 1].under) continue;
        const id = this.railSegs.length;
        this.railSegs.push({ a: ei, i });
        const x0 = Math.min(pts[i].x, pts[i + 1].x);
        const x1 = Math.max(pts[i].x, pts[i + 1].x);
        const z0 = Math.min(pts[i].z, pts[i + 1].z);
        const z1 = Math.max(pts[i].z, pts[i + 1].z);
        for (let cz = Math.floor((z0 - RAIL_ROW_HALF) / CELL); cz <= Math.floor((z1 + RAIL_ROW_HALF) / CELL); cz++) {
          for (let cx = Math.floor((x0 - RAIL_ROW_HALF) / CELL); cx <= Math.floor((x1 + RAIL_ROW_HALF) / CELL); cx++) {
            const k = cellKey(cx, cz);
            const a = this.railCells.get(k);
            if (a) a.push(id);
            else this.railCells.set(k, [id]);
          }
        }
      }
    });
    for (const p of rail.piers) {
      const k = cellKey(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
      const a = this.railPierCells.get(k);
      if (a) a.push({ x: p.x, z: p.z });
      else this.railPierCells.set(k, [{ x: p.x, z: p.z }]);
    }
  }

  private forRailSegs(x0: number, z0: number, x1: number, z1: number, fn: (seg: number) => void): void {
    this.stampN++;
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        const a = this.railCells.get(cellKey(cx, cz));
        if (!a) continue;
        for (const s of a) {
          if (this.railStamp[s] === this.stampN) continue;
          this.railStamp[s] = this.stampN;
          fn(s);
        }
      }
    }
  }

  /** Railway lines that pass under the cross-section line (inside the formation), with the rail head height there. */
  railUnder(ax: number, az: number, bx: number, bz: number): XHit[] {
    const out = new Map<number, XHit>();
    this.forRailSegs(Math.min(ax, bx) - 20, Math.min(az, bz) - 20, Math.max(ax, bx) + 20, Math.max(az, bz) + 20, (s) => {
      const { a, i } = this.railSegs[s];
      const p = this.railPts[a][i];
      const q = this.railPts[a][i + 1];
      const r = segSegDist(ax, az, bx, bz, p.x, p.z, q.x, q.z);
      if (r.d > RAIL_FORM_HALF) return;
      const top = p.top + (q.top - p.top) * r.u;
      const hit: XHit = { kind: 'rail', ref: a, tier: 0, name: `rail-${a}`, top, clear: XD.clearRail, d: r.d, onBridge: false };
      const old = out.get(a);
      if (!old || hit.top > old.top) out.set(a, hit);
    });
    return [...out.values()];
  }

  /** Distance (m) from a point to the nearest railway centre line that is above ground (not in a tunnel / cut and cover), up to `reach`. */
  railDist(x: number, z: number, reach: number): number {
    let best = Infinity;
    this.forRailSegs(x - reach, z - reach, x + reach, z + reach, (s) => {
      const { a, i } = this.railSegs[s];
      const p = this.railPts[a][i];
      const q = this.railPts[a][i + 1];
      const d = pointSeg(x, z, p.x, p.z, q.x, q.z).d;
      if (d < best) best = d;
    });
    return best;
  }

  nearRailPier(x: number, z: number, r: number): boolean {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const p of this.railPierCells.get(cellKey(Math.floor(x / CELL) + dx, Math.floor(z / CELL) + dz)) ?? []) if (Math.hypot(x - p.x, z - p.z) < r) return true;
      }
    }
    return false;
  }

  nearStation(x: number, z: number, margin: number): boolean {
    for (const s of this.terrain.rail?.stations ?? []) if (Math.hypot(x - s.x, z - s.z) < s.radius + margin) return true;
    return false;
  }

  /* -------------------------------------------------------------- buildings */

  private indexBuildings(): void {
    for (const b of [...BUILDING_PLACEMENTS, ...FILL_PLACEMENTS]) {
      const id = this.buildings.length;
      const r = Math.hypot(b.W, b.D) / 2;
      this.buildings.push({ x: b.x, z: b.z, hw: b.W / 2, hd: b.D / 2, yaw: b.yaw, r, id: b.id });
      for (let cz = Math.floor((b.z - r) / CELL); cz <= Math.floor((b.z + r) / CELL); cz++) {
        for (let cx = Math.floor((b.x - r) / CELL); cx <= Math.floor((b.x + r) / CELL); cx++) {
          const k = cellKey(cx, cz);
          const a = this.buildingCells.get(k);
          if (a) a.push(id);
          else this.buildingCells.set(k, [id]);
        }
      }
    }
  }

  /** Is the point inside a building footprint (incl. yard) grown by `m`? Returns the building id or null. */
  buildingAt(x: number, z: number, m: number): string | null {
    for (const id of this.buildingCells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      const b = this.buildings[id];
      if (Math.hypot(x - b.x, z - b.z) > b.r + m) continue;
      // the placement yaw turns the footprint (the model front looks along local +z)
      if (inObb(x, z, b.x, b.z, b.hw, b.hd, b.yaw, m)) return b.id;
    }
    return null;
  }

  /* ----------------------------------------------------- facilities and sites */

  /** Inside the future-airport land (x < 980, z >= 2400, + margin)? */
  inFutureAirport(x: number, z: number, extra = 0): boolean {
    return x < FUTURE_AIRPORT.x1 + FUTURE_AIRPORT.margin + extra && z >= FUTURE_AIRPORT.z0 - FUTURE_AIRPORT.margin - extra;
  }

  /**
   * HARD "do not build here" test for a point: the army camp, the airports, the seaport, the future airport land, the plots of the mall / library /
   * police station / EV lab, the research / treatment plants, railway stations and buildings. Returns a reason or null.
   * `m` is an extra margin (m) (the deck is 42 m wide: pass ~0 for a deck point, a column radius for a pier).
   */
  keepOut(x: number, z: number, m = 0, skipSeaport = false): string | null {
    if (rectDist(x, z, ARMY.x0, ARMY.z0, ARMY.x1, ARMY.z1) < ARMY_MARGIN + m) return 'army';
    if (rectDist(x, z, AIRPORT.x0, AIRPORT.z0, AIRPORT.x1, AIRPORT.z1) < AIRPORT_MARGIN + m) return 'airport';
    if (rectDist(x, z, AIRPORT_SEA.x0, AIRPORT_SEA.z0, AIRPORT_SEA.x1, AIRPORT_SEA.z1) < AIRPORT_MARGIN + m) return 'airport-sea';
    if (!skipSeaport && rectDist(x, z, SEAPORT.x0, SEAPORT.z0, SEAPORT.x1, SEAPORT.z1) < SEAPORT_MARGIN + m) return 'seaport';
    if (this.inFutureAirport(x, z, m)) return 'future-airport';
    for (const r of PLOTS) if (rectDist(x, z, r.x0, r.z0, r.x1, r.z1) < PLOT_MARGIN + m) return `plot:${r.id}`;
    for (const a of this.avoid) if (rectDist(x, z, a.x0, a.z0, a.x1, a.z1) < m) return 'avoid';
    for (const s of this.hardSites) if (s.near(x, z)) return 'plant';
    if (this.nearStation(x, z, 10 + m)) return 'station';
    const b = this.buildingAt(x, z, BUILDING_MARGIN + m);
    if (b) return `building:${b}`;
    return null;
  }

  /** SOFT conflicts: the fenced engineering areas and the levelled skirts of building pads. A deck may overhang them (they are only ground), a pier / ramp may not. */
  softOut(x: number, z: number, m = 0): string | null {
    for (const a of ENGINEERING_AREAS) if (rectDist(x, z, a.x0, a.z0, a.x1, a.z1) < m) return `eng:${a.id}`;
    for (const s of this.nearSites) if (s.near(x, z)) return 'site-skirt';
    return null;
  }

  /* ------------------------------------------------------------ pier test */

  /**
   * Can a pier column (a circle of radius `rc`, direction (dx, dz) of the deck) stand at (x, z)?
   * Not on / beside a road (asphalt + shoulder + gap) EXCEPT the median band of a highway (the yellow line) when the deck runs along it;
   * not in the railway land, near a rail pier, in a station, on a road bridge, on a junction pad, in water, on a building, a pad, a facility.
   * Returns null when free, `'median'` when it stands on the yellow line of a highway (allowed), else the reason.
   */
  pierBlocked(x: number, z: number, rc: number, dx: number, dz: number, allowMedian = true): string | null {
    let median = false;
    const near = this.nearestRoadsWithin(x, z, 60);
    for (const h of near) {
      const r = h.road;
      const band = r.halfWidth + r.shoulder + XD.pierGapRoad + rc;
      if (h.onBridge && h.d < r.halfWidth + 9 + rc) return `road-bridge:${r.name}`;
      if (h.d >= band) continue;
      const par = Math.abs(dx * h.tx + dz * h.tz);
      if (allowMedian && r.tier === 1 && !h.onBridge && h.d <= XD.medianBand && par > 0.99) {
        median = true;
        continue;
      }
      return `road:${r.name}`;
    }
    if (median) {
      // on the yellow line of a highway: only the hard obstacles (station, plot, building ...) count; the road runs there already
      if (this.railDist(x, z, 40) < RAIL_ROW_HALF + XD.pierGapRail + rc) return 'rail';
      return this.keepOut(x, z, rc + 1) ?? (this.nearPad(x, z, rc) ? 'junction-pad' : 'median');
    }
    if (this.nearPad(x, z, XD.pierGapRoad + rc)) return 'junction-pad';
    const rd = this.railDist(x, z, RAIL_ROW_HALF + XD.pierGapRail + rc + 2);
    if (rd < RAIL_ROW_HALF + XD.pierGapRail + rc) return 'rail';
    if (this.nearRailPier(x, z, 6 + rc)) return 'rail-pier';
    if (this.wetAround(x, z, rc + 1.5)) return 'water';
    const ko = this.keepOut(x, z, rc + 2) ?? this.softOut(x, z, rc + 2);
    if (ko) return ko;
    return median ? 'median' : null;
  }

  /** Every road within `reach` m of the point (one entry per road, the nearest segment). */
  nearestRoadsWithin(x: number, z: number, reach: number): { road: XRoadLike; d: number; tx: number; tz: number; onBridge: boolean; y: number }[] {
    const out = new Map<number, { road: XRoadLike; d: number; tx: number; tz: number; onBridge: boolean; y: number }>();
    this.forRoadSegs(x - reach, z - reach, x + reach, z + reach, (s) => {
      const r = this.road(this.segRoad[s]);
      const i = this.segIdx[s];
      const j = this.segEnd[s];
      const q = pointSeg(x, z, r.xs[i], r.zs[i], r.xs[j], r.zs[j]);
      if (q.d >= reach) return;
      const old = out.get(r.id);
      if (old && old.d <= q.d) return;
      const l = Math.hypot(r.xs[j] - r.xs[i], r.zs[j] - r.zs[i]) || 1;
      out.set(r.id, { road: r, d: q.d, tx: (r.xs[j] - r.xs[i]) / l, tz: (r.zs[j] - r.zs[i]) / l, onBridge: r.bridgeOf[i] >= 0 || r.bridgeOf[j] >= 0, y: r.ys[i] + (r.ys[j] - r.ys[i]) * q.t });
    });
    return [...out.values()];
  }

  /** Water at the centre or on a ring of radius r around the point. */
  wetAround(x: number, z: number, r: number): boolean {
    if (this.isWet(x, z)) return true;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      if (this.isWet(x + Math.cos(a) * r, z + Math.sin(a) * r)) return true;
    }
    return false;
  }

  /** The surface height of the nearest water on a segment (NaN = none): used for river clearance. */
  waterOn(ax: number, az: number, bx: number, bz: number, n = 5): number {
    return this.across(ax, az, bx, bz, n).water;
  }

  /** Total of everything under a cross-section line: roads, rail, junction pads. */
  featuresUnder(ax: number, az: number, bx: number, bz: number): XHit[] {
    return [...this.roadsUnder(ax, az, bx, bz), ...this.railUnder(ax, az, bx, bz), ...this.padsUnder(ax, az, bx, bz)];
  }
}
