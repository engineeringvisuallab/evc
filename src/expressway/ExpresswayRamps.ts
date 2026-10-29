import { DECK_HALF, LANE_OUT, XD, girderDepth, rampSuperelevation } from './ExpresswayStandards';
import { dubinsPaths, sampleDubins } from './ExpresswayDubins';
import { MAIN_LIMITS, RAMP_LIMITS, solveProfile } from './ExpresswayProfile';
import { PolyIndex, clamp, type Pt } from './ExpresswayMath';
import type { DeckContext } from './ExpresswayDeck';
import type { XRoadLike } from './ExpresswayWorld';
import type { XCushion, XInterchange, XPier, XRampInfo, XRampType, XRoute, XSpan } from './ExpresswayTypes';

/**
 * RAMPS: separate one-way exit and entrance ramps with a taper + deceleration / acceleration lane on the main deck, a gore and a crash cushion at the nose,
 * a path made of Dubins arcs (never tighter than the ramp radius), a vertical profile with the ramp grade and K limits, and - the important part - a NEW LINK ROAD that
 * comes down to the ground and merges tangentially into the kerb lane of an ordinary road with a 1:15 taper, so the traffic of the road is never stopped.
 * Bangladesh drives on the left: the kerb lane, the exit and the entrance are on the left of the direction of travel.
 */

export interface RampContext extends DeckContext {
  cushions: XCushion[];
  roads: readonly XRoadLike[];
  ramps: XRoute[];
  interchanges: XInterchange[];
}

export const RAMP_DEBUG: Record<string, number> = {};
/** Debug (tests / plots only): switch on to keep every rejected candidate path. */
export const DBG = { on: false, paths: [] as { pts: Pt[]; why: string; tag: string }[] };
let lastRej = '';
let lastFlow: Pt[] = [];
export const rej = (why: string): null => {
  lastRej = why;
  RAMP_DEBUG[why] = (RAMP_DEBUG[why] ?? 0) + 1;
  return null;
};
export const STEP = 8; // station spacing of a ramp (m)
/** Soffit allowance (m) over something a ramp crosses: asphalt + slab + a girder for a span of up to 100 m (steel box, span / 30). */
export const CROSS_DEPTH = XD.asphalt + XD.slab + 100 / 30 + 0.3;
const MERGE = XD.mergeRatio * 3.6; // length of the final merge taper on the ordinary road: 54 m
const NOSE_OFF = 330;

interface Frame {
  x: number;
  z: number;
  h: number;
  y: number;
  cl: number;
  cr: number;
  i: number;
}

/** Interpolate a route at station s. */
export function frameAt(r: XRoute, s: number): Frame {
  const n = r.xs.length;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (r.cum[m] <= s) lo = m;
    else hi = m;
  }
  const t = clamp((s - r.cum[lo]) / Math.max(1e-9, r.cum[hi] - r.cum[lo]), 0, 1);
  return {
    x: r.xs[lo] + (r.xs[hi] - r.xs[lo]) * t,
    z: r.zs[lo] + (r.zs[hi] - r.zs[lo]) * t,
    h: r.heading[lo] + (r.heading[hi] - r.heading[lo]) * t,
    y: r.ys[lo] + (r.ys[hi] - r.ys[lo]) * t,
    cl: r.cl[lo] + (r.cl[hi] - r.cl[lo]) * t,
    cr: r.cr[lo] + (r.cr[hi] - r.cr[lo]) * t,
    i: t < 0.5 ? lo : hi,
  };
}

/** Surface height of the main deck at lateral position u (+ left) of a frame. */
export function deckHeightAt(f: Frame, u: number, main = true): number {
  if (!main) return f.y - f.cl * u;
  if (Math.abs(u) <= XD.medianHalf) return f.y;
  return u > 0 ? f.y - f.cl * (u - XD.medianHalf) : f.y - f.cr * (-u - XD.medianHalf);
}

/** Road points a ramp may land on: ordinary roads (tiers 1-3, not earth tracks, not on a bridge), every 32 m. */
interface LandPt {
  x: number;
  z: number;
  road: XRoadLike;
  k: number;
}
const landCache = new WeakMap<readonly XRoadLike[], LandPt[]>();
function landingPoints(roads: readonly XRoadLike[]): LandPt[] {
  let a = landCache.get(roads);
  if (a) return a;
  a = [];
  for (const r of roads) {
    if (r.tier > 3 || r.earth) continue;
    const n = r.xs.length;
    const stride = Math.max(1, Math.round(32 / Math.max(1, Math.hypot(r.xs[1] - r.xs[0], r.zs[1] - r.zs[0]))));
    for (let k = 1; k + 1 < n; k += stride) {
      if (r.bridgeOf[k] >= 0 || r.bridgeOf[k - 1] >= 0 || r.bridgeOf[k + 1] >= 0) continue;
      a.push({ x: r.xs[k], z: r.zs[k], road: r, k });
    }
  }
  landCache.set(roads, a);
  return a;
}

/** Ramp obstacle classes of a 6 m cell: 1 hard (building, plot, facility ...), 2 water, 4 railway land, 8 junction pad, 16 engineering area. Cached per world. */
const cellMemo = new WeakMap<object, Map<number, number>>();
export function cellClass(ctx: RampContext, x: number, z: number, hw: number): number {
  let m = cellMemo.get(ctx.world);
  if (!m) {
    m = new Map();
    cellMemo.set(ctx.world, m);
  }
  const cx = Math.floor(x / 6);
  const cz = Math.floor(z / 6);
  const k = ((cx + 4096) * 8192 + (cz + 4096)) * 2 + (hw > 3.5 ? 1 : 0);
  let v = m.get(k);
  if (v === undefined) {
    const px = (cx + 0.5) * 6;
    const pz = (cz + 0.5) * 6;
    v = 0;
    if (ctx.world.keepOut(px, pz, hw + 1)) v |= 1;
    if (ctx.world.wetAround(px, pz, hw + 1)) v |= 2;
    if (ctx.world.railDist(px, pz, 40) < 14 + hw + 1) v |= 4;
    if (ctx.world.nearPad(px, pz, hw + 2)) v |= 8;
    if (ctx.world.softOut(px, pz, hw)?.startsWith('eng')) v |= 16;
    m.set(k, v);
  }
  return v;
}

const polyCache = new WeakMap<XRoute, PolyIndex>();
export function polyOf(r: XRoute, extra = 8): PolyIndex {
  let p = polyCache.get(r);
  if (!p) {
    p = new PolyIndex(r.xs, r.zs, r.ys, r.halfWidth + extra);
    polyCache.set(r, p);
  }
  return p;
}

interface Built {
  route: XRoute;
}

/** Create a ramp. Returns the route (not yet registered) or null if no landing works. */
export function buildRamp(
  ctx: RampContext,
  parent: XRoute,
  spec: { type: 'exit' | 'entrance'; side: number; noseS: number; lanes: number; routeId: number; terminal?: boolean },
): Built | null {
  const world = ctx.world;
  const { type, side, noseS, lanes } = spec;
  const hw = lanes === 1 ? XD.ramp1W / 2 : XD.ramp2W / 2;
  const f = frameAt(parent, noseS);
  const hT = side > 0 ? f.h : f.h + Math.PI; // travel heading on that carriageway
  const nLx = Math.sin(f.h);
  const nLz = -Math.cos(f.h);
  const L0 = LANE_OUT + 1.8 * lanes;
  const nx0 = f.x + nLx * side * L0;
  const nz0 = f.z + nLz * side * L0;
  const yN = deckHeightAt(f, side * L0) - 0.0;
  const R = XD.rampMinRadius;
  const parentIdx = polyOf(parent);
  const mains = ctx.others.filter((r) => r.id !== parent.id && r.main);
  const mainIdx = mains.map((r) => ({ r, idx: polyOf(r) }));
  // candidates on the kerb side
  const cands: { lp: LandPt; d: number; pose: [number, number, number]; lane: [number, number]; len: number; word: string; path: ReturnType<typeof dubinsPaths>[number] }[] = [];
  for (const lp of landingPoints(ctx.roads)) {
    const dx = lp.x - nx0;
    const dz = lp.z - nz0;
    const dist = Math.hypot(dx, dz);
    if (dist < 150 || dist > 750) continue;
    const lat = side * (dx * nLx + dz * nLz);
    const along = dx * Math.cos(hT) + dz * Math.sin(hT);
    // a terminal's ramp lands on the road beyond the end of the deck (that road is free of the deck there); otherwise on the kerb side, far enough for the ramp to come down beside the deck
    if (spec.terminal ? (lat < -60 || (type === 'exit' ? along < 100 : along > -100)) : lat < 70) continue;
    if (!spec.terminal && (type === 'exit' ? along < -50 : along > 50)) continue; // an exit lands ahead of its nose, an entrance starts behind it
    const q = parentIdx.query(lp.x, lp.z, lp.x, lp.z, parent.halfWidth + 22);
    if (q && q.i > 0 && q.i < parent.xs.length - 2) continue; // the road runs under the deck there
    const r = lp.road;
    for (const d of [1, -1]) {
      const k2 = lp.k + d;
      const tx0 = r.xs[k2] - r.xs[lp.k];
      const tz0 = r.zs[k2] - r.zs[lp.k];
      const tl = Math.hypot(tx0, tz0) || 1;
      const tx = tx0 / tl;
      const tz = tz0 / tl;
      const hr = Math.atan2(tz, tx);
      const lnx = Math.sin(hr);
      const lnz = -Math.cos(hr);
      const off = r.halfWidth * 0.5;
      const lane: [number, number] = [lp.x + lnx * off, lp.z + lnz * off];
      let pose: [number, number, number];
      if (type === 'exit') {
        const t0: Pt = [lane[0] + lnx * 3.6 - tx * MERGE, lane[1] + lnz * 3.6 - tz * MERGE];
        pose = [t0[0], t0[1], Math.atan2(lane[1] - t0[1], lane[0] - t0[0])];
      } else {
        const t1: Pt = [lane[0] + lnx * 3.6 + tx * MERGE, lane[1] + lnz * 3.6 + tz * MERGE];
        pose = [t1[0], t1[1], Math.atan2(t1[1] - lane[1], t1[0] - lane[0])];
      }
      const paths = type === 'exit' ? dubinsPaths(nx0, nz0, hT, pose[0], pose[1], pose[2], R) : dubinsPaths(pose[0], pose[1], pose[2], nx0, nz0, hT, R);
      // the first turn of an exit leaves the deck (to the left); an entrance comes in from the kerb side at a small angle and its last turn straightens it out (also to the left)
      const ok = paths.find((p) => p.word[1] === 'S' && (type === 'exit' ? p.word[0] === 'L' : p.word[2] === 'L') && turnOf(p) <= (170 * Math.PI) / 180 && p.length <= 1.5 * dist + 160);
      if (!ok) continue;
      // the ramp has to come down (or go up) the height difference at the ramp grade
      if (ok.length * 0.05 < yN - (lp.road.ys[lp.k] + 0.5) + 6) continue;
      cands.push({ lp, d, pose, lane, len: ok.length + MERGE, word: ok.word, path: ok });
    }
  }
  // keep the ramps of one interchange apart: a landing close to a ramp that is already built costs extra
  const placed = ctx.ramps.filter((o) => o.ramp && o.ramp.onRoute === parent.id && o.ramp.landing && Math.abs(o.ramp.noseS - noseS) < 1500);
  const penal = (c: (typeof cands)[number]): number => {
    let p = 0;
    for (const o of placed) if (Math.hypot(o.ramp!.landing!.x - c.lane[0], o.ramp!.landing!.z - c.lane[1]) < 160) p += 400;
    return p;
  };
  cands.sort((a, b) => a.len + penal(a) - (b.len + penal(b)));
  if (!cands.length) rej('no-candidates');
  const need = Math.abs(yN - 0) > 0 ? 0 : 0;
  void need;
  let tried = 0;
  for (const c of cands) {
    if (tried++ >= (spec.terminal ? 60 : 36)) break;
    const built = tryCandidate(c);
    if (DBG.on && !built) DBG.paths.push({ pts: lastFlow, why: lastRej, tag: `${parent.name}:${type}:${side}:${noseS.toFixed(0)}` });
    if (built) return built;
  }
  return null;

  function tryCandidate(c: (typeof cands)[number]): Built | null {
    // flow-ordered polyline
    const sd = sampleDubins(c.path, 2);
    let pts: Pt[] = sd.pts;
    if (type === 'exit') {
      // straight merge taper: pose -> lane
      const [px, pz] = c.pose;
      const n = Math.ceil(MERGE / 2);
      for (let k = 1; k <= n; k++) pts.push([px + ((c.lane[0] - px) * k) / n, pz + ((c.lane[1] - pz) * k) / n]);
    } else {
      const [px, pz] = c.pose;
      const n = Math.ceil(MERGE / 2);
      const head: Pt[] = [];
      for (let k = 0; k < n; k++) head.push([c.lane[0] + ((px - c.lane[0]) * k) / n, c.lane[1] + ((pz - c.lane[1]) * k) / n]);
      pts = [...head, ...pts];
    }
    // resample to STEP
    const flow = resample(pts, STEP);
    lastFlow = flow;
    // geometry checks
    const m = flow.length;
    // cheap obstacle pass first (every 16 m, cached cells). Buildings, plots, facilities stop a ramp anywhere; water, railway land, junction pads and
    // fenced areas only where it is on the ground (the last 170 m before the road, or the first 90 m at the nose): elsewhere the ramp is lifted over them.
    const lenAll = (m - 1) * STEP;
    let wetRun = 0;
    for (let i = 0; i < m; i += 2) {
      const [x, z] = flow[i];
      const fromN = type === 'exit' ? i * STEP : (m - 1 - i) * STEP;
      if (fromN <= 60) continue;
      const cc = cellClass(ctx, x, z, hw);
      if (cc & 1) return rej('hard');
      wetRun = cc & 2 ? wetRun + 16 : 0;
      if (wetRun > 60) return rej('water-long'); // a ramp may hop a stream, not cross a lake
      const low = lenAll - fromN < 170 || fromN <= 120;
      if (low && cc & 2) return rej('water');
      if (low && cc & 4) return rej('rail');
      if (low && cc & 16 && !spec.terminal) return rej('soft');
      if (lenAll - fromN < 100 && cc & 8) return rej('pad');
      if (fromN > 90 && parentIdx.dist(x, z, parent.halfWidth + 0.6 + hw) < Infinity) {
        if (DBG.on && type === 'entrance') DBG.paths.push({ pts: [[x, z]], why: `PARENT fromN=${fromN.toFixed(0)} i=${i}/${m} d=${parentIdx.dist(x, z, 400).toFixed(1)} word=${c.word} nose=${noseS.toFixed(0)} side=${side}`, tag: parent.name });
        return rej('parent');
      }
    }
    // work in "from the nose" order: exit = flow order, entrance = reversed
    const fromNose: Pt[] = type === 'exit' ? flow : [...flow].reverse();
    const cumN = new Float64Array(m);
    for (let i = 1; i < m; i++) cumN[i] = cumN[i - 1] + Math.hypot(fromNose[i][0] - fromNose[i - 1][0], fromNose[i][1] - fromNose[i - 1][1]);
    const gmax = new Float64Array(m);
    const gcc = new Float64Array(m);
    const ymin = new Float64Array(m);
    const dir = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const a = fromNose[Math.max(0, i - 1)];
      const b = fromNose[Math.min(m - 1, i + 1)];
      dir[i] = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
    for (let i = 0; i < m; i++) {
      const [x, z] = fromNose[i];
      const nx = Math.sin(dir[i]);
      const nz = -Math.cos(dir[i]);
      const away = cumN[i] > 90; // near the nose the ramp is still over the widened main deck
      if (away) {
        if (world.keepOut(x, z, hw + 1)) return rej('hard-exact');
        const pq = parentIdx.dist(x, z, parent.halfWidth + 0.6 + hw);
        if (pq < Infinity) return rej('parent');
        for (const e of mainIdx) if (e.idx.dist(x, z, e.r.halfWidth + 3 + hw) < Infinity) return rej('other-main');
      }
      // ground across the ramp
      let g = -Infinity;
      let wetMax = -Infinity;
      for (const u of [-hw, 0, hw]) {
        const s = world.sample(x + nx * u, z + nz * u);
        if (s.h > g) g = s.h;
        if (u === 0) gcc[i] = s.h;
        if (!Number.isNaN(s.water) && s.h < s.water && s.water > wetMax) wetMax = s.water;
      }
      gmax[i] = g;
      let v = g + 0.06;
      if (away) {
        const hits = [
          ...world.roadsUnder(x + nx * hw, z + nz * hw, x - nx * hw, z - nz * hw),
          ...world.railUnder(x + nx * hw, z + nz * hw, x - nx * hw, z - nz * hw),
        ];
        for (const h of hits) {
          if (h.kind === 'road' && h.ref === c.lp.road.id && i >= m - 20) continue; // the road we land on
          v = Math.max(v, h.top + h.clear + CROSS_DEPTH);
        }
        for (const h of world.padsUnder(x + nx * hw, z + nz * hw, x - nx * hw, z - nz * hw)) v = Math.max(v, h.top + h.clear + CROSS_DEPTH);
        for (const e of mainIdx) {
          const q = e.idx.query(x + nx * hw, z + nz * hw, x - nx * hw, z - nz * hw, e.r.halfWidth + 3);
          if (q) v = Math.max(v, q.y + XD.clearRoad + CROSS_DEPTH);
        }
        if (wetMax > -Infinity) v = Math.max(v, wetMax + XD.clearRiver + CROSS_DEPTH);
      }
      ymin[i] = v;
    }
    // the road surface at the landing
    const landIdx = type === 'exit' ? m - 1 : 0; // (flow order) -> in fromNose order the landing is the LAST point either way
    void landIdx;
    const lastG = gcc[m - 1];
    const yLand = c.lp.road.ys[c.lp.k];
    ymin[0] = yN;
    ymin[m - 1] = Math.max(ymin[m - 1], Math.max(yLand, lastG) + 0.02);
    const y = solveProfile(ymin, cumN, { grade: 0.055, kCrest: XD.rampKCrest, kSag: XD.rampKSag });
    if (Math.abs(y[0] - yN) > 0.02) {
      if (DBG.on) {
        let wi = 0;
        let wv = -Infinity;
        for (let i = 0; i < m; i++) if (ymin[i] - (yN - 0.055 * cumN[i]) > wv) { wv = ymin[i] - (yN - 0.055 * cumN[i]); wi = i; }
        DBG.paths.push({ pts: [fromNose[wi]], why: `climbinfo i=${wi} cum=${cumN[wi].toFixed(0)} ymin=${ymin[wi].toFixed(1)} yN=${yN.toFixed(1)} g=${gmax[wi].toFixed(1)} at ${fromNose[wi][0].toFixed(0)},${fromNose[wi][1].toFixed(0)}`, tag: `${parent.name}` });
      }
      return rej('climb');
    } // would have to climb off the deck
    if (y[m - 1] > Math.max(yLand, lastG) + 0.25) return rej('too-short'); // too short to come down
    // the last merge-length must be on the ground
    for (let i = 0; i < m; i++) if (cumN[m - 1] - cumN[i] <= MERGE + 8 && y[i] - gcc[i] > 0.9) return rej('merge-not-on-ground');
    // two ramps of one interchange must not touch
    for (const o of ctx.ramps) {
      if (o.ramp && o.ramp.onRoute === parent.id) {
        const oi = new PolyIndex(o.xs, o.zs, o.ys, 0);
        for (let i = 12; i < m; i++) if (oi.dist(fromNose[i][0], fromNose[i][1], hw * 2 + o.halfWidth + 4) < Infinity && !(o.ramp.type === type && o.ramp.side === side && Math.abs(o.ramp.noseS - noseS) < 1)) return rej('overlap');
      }
    }
    return assemble(fromNose, dir, y, gmax, gcc, c);
  }

  function assemble(fromNose: Pt[], dir: Float64Array, yN2: Float64Array, gmax: Float64Array, gcc: Float64Array, c: (typeof cands)[number]): Built {
    const m = fromNose.length;
    // flow order: exit = nose -> landing, entrance = landing -> nose
    const idx = (i: number): number => (type === 'exit' ? i : m - 1 - i);
    const xs = new Float64Array(m);
    const zs = new Float64Array(m);
    const ys = new Float64Array(m);
    const ground = new Float64Array(m);
    const gc = new Float64Array(m);
    const cum = new Float64Array(m);
    const heading = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const j = idx(i);
      xs[i] = fromNose[j][0];
      zs[i] = fromNose[j][1];
      ys[i] = yN2[j];
      ground[i] = gmax[j];
      gc[i] = gcc[j];
      heading[i] = type === 'exit' ? dir[j] : dir[j] + Math.PI;
    }
    for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
    // curvature: signed 3-point, + = left (map: heading decreases)
    const kappa = new Float64Array(m);
    for (let i = 1; i + 1 < m; i++) {
      const a = Math.atan2(zs[i] - zs[i - 1], xs[i] - xs[i - 1]);
      const b = Math.atan2(zs[i + 1] - zs[i], xs[i + 1] - xs[i]);
      let d = b - a;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      kappa[i] = -d / (cum[i + 1] - cum[i - 1]) * 2;
    }
    kappa[0] = kappa[1];
    kappa[m - 1] = kappa[m - 2];
    for (let i = 0; i < m; i++) heading[i] = i + 1 < m ? Math.atan2(zs[i + 1] - zs[i], xs[i + 1] - xs[i]) : heading[i - 1];
    // superelevation: a ramp is one plane. e = +left bank; tangent: 2 % to the left (kerb); rate-limited
    const e = new Float64Array(m);
    const pos = new Float64Array(m);
    const neg = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const k = Math.abs(kappa[i]);
      const req = k > 1e-6 ? rampSuperelevation(1 / k, XD.rampSpeed) : 0;
      if (kappa[i] >= 0) pos[i] = Math.max(req, XD.crown);
      else neg[i] = req;
    }
    const rate = (0.0065 / (2 * hw)) * STEP;
    for (const a of [pos, neg]) {
      for (let it = 0; it < 2; it++) {
        for (let i = 1; i < m; i++) a[i] = Math.max(a[i], a[i - 1] - rate);
        for (let i = m - 2; i >= 0; i--) a[i] = Math.max(a[i], a[i + 1] - rate);
      }
    }
    for (let i = 0; i < m; i++) e[i] = clamp(pos[i] - neg[i], -XD.rampEMax, XD.rampEMax);
    const cl = Float64Array.from(e);
    const cr = Float64Array.from(e, (v) => -v);
    // fill / viaduct
    const viaduct = new Uint8Array(m);
    for (let i = 0; i < m; i++) viaduct[i] = ys[i] - gc[i] >= XD.embankMax ? 1 : 0;
    const info: XRampInfo = {
      type: type as XRampType,
      onRoute: parent.id,
      noseS,
      side,
      lanes,
      speed: XD.rampSpeed,
      taper: lanes * 3.6 * XD.taperRatio,
      parallel: type === 'exit' ? XD.decelLen : XD.accelLen,
      auxS0: 0,
      auxS1: 0,
      landing: { x: c.lane[0], z: c.lane[1], y: c.lp.road.ys[c.lp.k], roadId: c.lp.road.id, heading: Math.atan2(c.lane[1] - c.pose[1], c.lane[0] - c.pose[0]) },
      mergeLen: MERGE,
      fromRoad: type === 'entrance',
    };
    const route: XRoute = {
      id: spec.routeId,
      name: `${parent.name}-${type === 'exit' ? 'X' : 'E'}${side > 0 ? 'L' : 'R'}${Math.round(noseS)}`,
      kind: 'ramp',
      closed: false,
      main: false,
      lanes,
      halfWidth: hw,
      step: STEP,
      xs,
      zs,
      ys,
      ground,
      gc,
      cum,
      length: cum[m - 1],
      heading,
      kappa,
      e,
      cl,
      cr,
      girder: new Float64Array(m),
      viaduct,
      wl: new Float64Array(m),
      wr: new Float64Array(m),
      openL: new Uint8Array(m),
      openR: new Uint8Array(m),
      ramp: info,
      label: c.lp.road.name,
    };
    return { route };
  }
}

/** Total turning (rad) of a Dubins path. */
function turnOf(p: { seg: [number, number, number]; R: number; word: string }): number {
  return (p.seg[0] + p.seg[2]) / p.R;
}

export function resample(pts: Pt[], step: number): Pt[] {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const n = Math.max(2, Math.round(total / step));
  const ds = total / n;
  const out: Pt[] = [[pts[0][0], pts[0][1]]];
  let acc = 0;
  let target = ds;
  for (let i = 1; i < pts.length && out.length < n; i++) {
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (L < 1e-9) continue;
    while (acc + L >= target - 1e-9 && out.length < n) {
      const t = (target - acc) / L;
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
      target += ds;
    }
    acc += L;
  }
  out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}

/* ------------------------------------------------------------ piers of a ramp */

export function placeRampPiers(ctx: RampContext, r: XRoute): void {
  const world = ctx.world;
  const m = r.xs.length;
  const mains = ctx.others.filter((o) => o.main);
  const idxs = mains.map((o) => ({ o, idx: new PolyIndex(o.xs, o.zs, o.ys, o.halfWidth + 3) }));
  const hw = r.halfWidth;
  // viaduct runs
  let i = 0;
  while (i < m) {
    if (!r.viaduct[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < m && r.viaduct[j + 1]) j++;
    if (j - i >= 2) {
      const sa = r.cum[i];
      const sb = r.cum[j];
      const posList: number[] = [sa];
      let cur = sa;
      const legal = (s: number): boolean => {
        const k = Math.min(m - 1, Math.max(0, Math.round(s / STEP)));
        const x = r.xs[k];
        const z = r.zs[k];
        if (world.pierBlocked(x, z, hw + 0.8, Math.cos(r.heading[k]), Math.sin(r.heading[k]), false) !== null) return false;
        for (const e of idxs) if (e.idx.dist(x, z, e.o.halfWidth + 3 + hw + 0.8) < Infinity) return false;
        return true;
      };
      while (sb - cur > XD.rampSpan * 1.25) {
        let pick = -1;
        for (let d = XD.rampSpan + 6; d >= 14; d -= 2) {
          if (legal(cur + d)) {
            pick = cur + d;
            break;
          }
        }
        if (pick < 0) {
          // no legal pier within the normal span: the shortest longer span (<= 70 m) that has one
          for (let d = XD.rampSpan + 8; d <= 120; d += 2) {
            if (cur + d >= sb) break;
            if (legal(cur + d)) {
              pick = cur + d;
              break;
            }
          }
        }
        if (pick < 0 && sb - cur <= 120) break; // the abutment at the end of the run takes the last long span
        if (pick < 0) {
          ctx.issues.push(`${r.name}: no pier position near ${cur.toFixed(0)} m`);
          pick = cur + XD.rampSpan;
        }
        posList.push(pick);
        cur = pick;
      }
      posList.push(sb);
      for (let q = 0; q < posList.length; q++) {
        const s = posList[q];
        const k = Math.min(m - 1, Math.max(0, Math.round(s / STEP)));
        const spanA = q > 0 ? s - posList[q - 1] : 0;
        const spanB = q + 1 < posList.length ? posList[q + 1] - s : 0;
        const depth = girderDepth(Math.max(spanA, spanB, 10));
        const x = r.xs[k];
        const z = r.zs[k];
        const g = world.ground(x, z);
        const pier: XPier = {
          routeId: r.id,
          s,
          dx: Math.cos(r.heading[k]),
          dz: Math.sin(r.heading[k]),
          x,
          z,
          kind: q === 0 || q === posList.length - 1 ? 'abutment' : 'ramp',
          cols: [{ x, z }],
          b: Math.max(1.6, hw * 0.7),
          t: 1.4,
          capTop: r.ys[k] - XD.asphalt - XD.slab - depth - 0.3,
          capDepth: 1.2,
          capHalf: hw - 0.3,
          roll: 0,
          bottom: g - XD.footing,
          ground: g,
          spanA,
          spanB,
          deckY: r.ys[k],
        };
        ctx.piers.push(pier);
        if (q > 0) {
          const sp: XSpan = { routeId: r.id, s0: posList[q - 1], s1: s, length: spanA, depth: girderDepth(spanA), material: spanA <= XD.spanMax ? 'pc-girder' : spanA <= XD.spanSpecial ? 'pc-box' : 'steel-box' };
          ctx.spans.push(sp);
          for (let t = 0; t < m; t++) if (r.cum[t] >= sp.s0 - 1e-6 && r.cum[t] <= sp.s1 + 1e-6) r.girder[t] = Math.max(r.girder[t], sp.depth);
        }
      }
    }
    i = j + 1;
  }
  // a viaduct station without a girder (run too short to carry piers) is a short bridge on fill: give it the standard depth
  for (let t = 0; t < m; t++) if (r.viaduct[t] && r.girder[t] === 0) r.girder[t] = girderDepth(XD.rampSpan);
  void MAIN_LIMITS;
  void RAMP_LIMITS;
  void DECK_HALF;
}

/* ------------------------------------------------- aux lane on the main deck */

/** Widen the main deck for the aux lane of a ramp (taper + parallel lane + gore) and open the parapet where the ramp leaves / joins. */
export function applyAux(parent: XRoute, ramp: XRoute): void {
  const info = ramp.ramp!;
  const auxW = info.lanes * 3.6;
  const dirS = info.side > 0 ? 1 : -1; // direction of travel along s
  const arr = info.side > 0 ? parent.wl : parent.wr;
  const open = info.side > 0 ? parent.openL : parent.openR;
  const taper = info.taper;
  const par = info.parallel;
  const nose = info.noseS;
  const gore = XD.goreLen;
  // station range (along s) of: taper start, full width start, nose, end of widening
  let a0: number;
  let a1: number;
  let b0: number;
  let b1: number;
  if (info.type === 'exit') {
    // upstream = against the travel direction
    a0 = nose - dirS * (taper + par); // taper starts
    a1 = nose - dirS * par; // full width from here
    b0 = nose; // nose
    b1 = nose + dirS * gore; // widening ends (gore)
  } else {
    a0 = nose - dirS * gore; // gore: the ramp joins the deck
    a1 = nose; // full width from the nose
    b0 = nose + dirS * par; // full width until here, then taper
    b1 = nose + dirS * (par + taper);
  }
  const lo = Math.min(a0, b1);
  const hi = Math.max(a0, b1);
  for (let i = 0; i < parent.xs.length; i++) {
    const s = parent.cum[i];
    if (s < lo - 1 || s > hi + 1) continue;
    let w = 0;
    if (info.type === 'exit') {
      const u = (s - a0) * dirS; // distance along travel from the taper start
      const total = taper + par + gore;
      if (u < 0 || u > total) w = 0;
      else if (u < taper) w = (u / taper) * auxW;
      else w = auxW;
      if (u > taper + par) w = auxW * Math.max(0, 1 - (u - taper - par) / gore);
      void a1;
      void b0;
      void b1;
    } else {
      const u = (s - a0) * dirS;
      const total = gore + par + taper;
      if (u < 0 || u > total) w = 0;
      else if (u < gore) w = auxW * (u / gore);
      else if (u < gore + par) w = auxW;
      else w = auxW * (1 - (u - gore - par) / taper);
      void b0;
    }
    if (w > arr[i]) arr[i] = w;
    // open parapet where the ramp attaches (the nose zone)
    const un = (s - nose) * dirS;
    if (un > -8 && un < gore) open[i] = 1;
  }
  info.auxS0 = Math.min(a0, b1);
  info.auxS1 = Math.max(a0, b1);
}

/* ------------------------------------------------------------- interchanges */

export function register(ctx: RampContext, r: XRoute, parent: XRoute): void {
  ctx.ramps.push(r);
  ctx.others.push(r);
  // no parapet where the ramp meets the main deck (the first / last 36 m at the nose; also the stem end of a system ramp)
  const ri = r.ramp!;
  const openEnd = (atStart: boolean): void => {
    for (let i = 0; i < r.xs.length; i++) {
      const d = atStart ? r.cum[i] : r.length - r.cum[i];
      if (d < 36) r.openL[i] = r.openR[i] = 1;
    }
  };
  if (ri.type === 'exit') openEnd(true);
  else openEnd(false);
  if (ri.system) {
    openEnd(true);
    openEnd(false);
  }
  placeRampPiers(ctx, r);
  applyAux(parent, r);
  // crash cushion at the nose, on the gore
  const info = r.ramp!;
  const dirS = info.side > 0 ? 1 : -1;
  const f = frameAt(parent, info.noseS + dirS * XD.cushionLen);
  const lat = info.side * (LANE_OUT + info.lanes * 3.6 + 0.4);
  ctx.cushions.push({ x: f.x + Math.sin(f.h) * lat, z: f.z - Math.cos(f.h) * lat, y: deckHeightAt(f, lat), dx: Math.cos(f.h) * dirS, dz: Math.sin(f.h) * dirS, routeId: parent.id });
  // the cap beams of the main piers inside the aux lane must reach the widened edge
  for (const p of ctx.piers) {
    if (p.routeId !== parent.id) continue;
    if (p.s >= info.auxS0 && p.s <= info.auxS1) {
      const k = Math.round(p.s / parent.step);
      const w = info.side > 0 ? parent.wl[Math.min(parent.xs.length - 1, k)] : parent.wr[Math.min(parent.xs.length - 1, k)];
      p.capHalf = Math.max(p.capHalf, DECK_HALF - 1 + w);
    }
  }
}

/** Try to build one ramp, shifting its nose along the main deck if the first place does not work. */
export function addRamp(ctx: RampContext, parent: XRoute, type: 'exit' | 'entrance', side: number, noseS: number, lanes: number, terminal = false): XRoute | null {
  const aux = lanes * 3.6 * XD.taperRatio + (type === 'exit' ? XD.decelLen : XD.accelLen) + XD.goreLen;
  const dirS = side > 0 ? 1 : -1;
  for (const shift of [0]) {
    const s = noseS + shift;
    const start = type === 'exit' ? s - dirS * aux : s - dirS * XD.goreLen;
    const end = type === 'exit' ? s + dirS * XD.goreLen : s + dirS * (aux - XD.goreLen);
    if (Math.min(start, end) < 20 || Math.max(start, end) > parent.length - 20) continue;
    const b = buildRamp(ctx, parent, { type, side, noseS: s, lanes, routeId: ctx.nextId(), terminal });
    if (b) {
      register(ctx, b.route, parent);
      return b.route;
    }
  }
  return null;
}

interface Snap {
  ramps: number;
  others: number;
  piers: number;
  spans: number;
  cushions: number;
  interchanges: number;
  issues: number;
  notes: number;
  wl: Float64Array;
  wr: Float64Array;
  oL: Uint8Array;
  oR: Uint8Array;
  caps: number[];
}
function snapshot(ctx: RampContext, parent: XRoute): Snap {
  return {
    ramps: ctx.ramps.length,
    others: ctx.others.length,
    piers: ctx.piers.length,
    spans: ctx.spans.length,
    cushions: ctx.cushions.length,
    interchanges: ctx.interchanges.length,
    issues: ctx.issues.length,
    notes: ctx.notes.length,
    wl: Float64Array.from(parent.wl),
    wr: Float64Array.from(parent.wr),
    oL: Uint8Array.from(parent.openL),
    oR: Uint8Array.from(parent.openR),
    caps: ctx.piers.map((p) => p.capHalf),
  };
}
function restore(ctx: RampContext, parent: XRoute, s: Snap): void {
  ctx.ramps.length = s.ramps;
  ctx.others.length = s.others;
  ctx.piers.length = s.piers;
  ctx.spans.length = s.spans;
  ctx.cushions.length = s.cushions;
  ctx.interchanges.length = s.interchanges;
  ctx.issues.length = s.issues;
  ctx.notes.length = s.notes;
  parent.wl.set(s.wl);
  parent.wr.set(s.wr);
  parent.openL.set(s.oL);
  parent.openR.set(s.oR);
  for (let i = 0; i < s.caps.length; i++) ctx.piers[i].capHalf = s.caps[i];
}

/** A service interchange: exit + entrance on each side of the main deck, each with its own link road to an ordinary road. The place slides along the deck until all four ramps find a legal landing. */
export function addServiceInterchange(ctx: RampContext, parent: XRoute, hint: { x: number; z: number }, n: number, id: string): XInterchange | null {
  let bs = 0;
  let bd = Infinity;
  for (let i = 0; i < parent.xs.length; i++) {
    const d = Math.hypot(parent.xs[i] - hint.x, parent.zs[i] - hint.z);
    if (d < bd) {
      bd = d;
      bs = i;
    }
  }
  const base = parent.cum[bs];
  const offsets = [0, 200, -200, 400, -400, 600, -600, 800, -800, 1000, -1000, 1300, -1300];
  let best = -1;
  let bestOff = 0;
  const run = (off: number): number => {
    const s0 = base + off;
    let c = 0;
    const take = (r: XRoute | null): void => {
      if (r) c++;
    };
    // + side: traffic along +s: exit upstream (smaller s), entrance downstream. - side: the other way round.
    take(addRamp(ctx, parent, 'exit', 1, s0 - NOSE_OFF, 1));
    take(addRamp(ctx, parent, 'entrance', 1, s0 + NOSE_OFF, 1));
    take(addRamp(ctx, parent, 'exit', -1, s0 + NOSE_OFF, 1));
    take(addRamp(ctx, parent, 'entrance', -1, s0 - NOSE_OFF, 1));
    return c;
  };
  for (const off of offsets) {
    if (ctx.interchanges.some((o) => (o.routeId === parent.id ? Math.abs(o.s - (base + off)) < XD.interchangeSpacing : o.ringRoute === parent.id && Math.abs((o.ringS ?? 1e9) - (base + off)) < XD.interchangeSpacing))) continue;
    const snap = snapshot(ctx, parent);
    const c = run(off);
    restore(ctx, parent, snap);
    if (c > best) {
      best = c;
      bestOff = off;
    }
    if (c === 4) break;
  }
  if (best <= 0) {
    ctx.notes.push(`interchange ${n} (${id}): no legal ramp landing within 1 km`);
    return null;
  }
  run(bestOff);
  const mine = ctx.ramps.slice(-best);
  const s0 = base + bestOff;
  const ids = mine.map((r) => r.id);
  const roads = [...new Set(mine.map((r) => r.label ?? ''))].filter((q) => q);
  const ic: XInterchange = { n, id, kind: 'service', x: frameAt(parent, s0).x, z: frameAt(parent, s0).z, routeId: parent.id, s: s0, rampIds: ids, roads };
  ctx.interchanges.push(ic);
  if (best < 4) ctx.notes.push(`interchange ${n} (${id}): only ${best} of 4 ramps found a legal landing`);
  return ic;
}

/** A terminal: the last exit (2 lanes) and the first entrance (2 lanes) at the end of a route, which then ends in an end wall + crash cushions. */
export function addTerminal(ctx: RampContext, parent: XRoute, end: 'start' | 'end', n: number, id: string): XInterchange | null {
  const L = parent.length;
  const ids: number[] = [];
  const roads = new Set<string>();
  const take = (r: XRoute | null): void => {
    if (!r) return;
    ids.push(r.id);
    if (r.label) roads.add(r.label);
  };
  for (const off of [260, 420, 600]) {
    if (end === 'end') {
      if (!ids.some((id) => ctx.ramps.find((q) => q.id === id)?.ramp?.side === 1)) take(addRamp(ctx, parent, 'exit', 1, L - off, 2, true));
      if (!ids.some((id) => ctx.ramps.find((q) => q.id === id)?.ramp?.side === -1)) take(addRamp(ctx, parent, 'entrance', -1, L - off, 2, true));
    } else {
      if (!ids.some((id) => ctx.ramps.find((q) => q.id === id)?.ramp?.side === -1)) take(addRamp(ctx, parent, 'exit', -1, off, 2, true));
      if (!ids.some((id) => ctx.ramps.find((q) => q.id === id)?.ramp?.side === 1)) take(addRamp(ctx, parent, 'entrance', 1, off, 2, true));
    }
    if (ids.length >= 2) break;
  }
  // end wall: crash cushions across both carriageways at the very end
  const k = end === 'end' ? parent.xs.length - 1 : 0;
  const f = frameAt(parent, end === 'end' ? L : 0);
  void k;
  for (const sgn of [1, -1]) {
    const lat = sgn * (XD.medianHalf + 10.2);
    ctx.cushions.push({ x: f.x + Math.sin(f.h) * lat, z: f.z - Math.cos(f.h) * lat, y: deckHeightAt(f, lat), dx: Math.cos(f.h) * (end === 'end' ? 1 : -1), dz: Math.sin(f.h) * (end === 'end' ? 1 : -1), routeId: parent.id });
  }
  const ic: XInterchange = { n, id, kind: 'terminal', x: f.x, z: f.z, routeId: parent.id, s: end === 'end' ? L : 0, rampIds: ids, roads: [...roads] };
  ctx.interchanges.push(ic);
  if (ids.length < 2) ctx.notes.push(`terminal ${n} (${id}): only ${ids.length} of 2 ramps found a legal landing`);
  return ic;
}
