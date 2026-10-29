import { LANE_OUT, XD, rampSuperelevation, structuralDepth } from './ExpresswayStandards';
import { dubinsPaths, sampleDubins } from './ExpresswayDubins';
import { solveProfile } from './ExpresswayProfile';
import { clamp, type Pt } from './ExpresswayMath';
import { CROSS_DEPTH, STEP, cellClass, deckHeightAt, frameAt, polyOf, register, resample, type RampContext } from './ExpresswayRamps';
import type { XInterchange, XRampInfo, XRoute } from './ExpresswayTypes';

/**
 * DIRECTIONAL T (system) INTERCHANGE between a spoke / spur (the "stem") and the ring. Four one-way, 2-lane ramps carry the four movements;
 * nothing is butted head-on and no deck sits on another:
 *   - stem -> ring, onto the carriageway on the stem's side: a direct left-hand ramp (kerb to kerb), merging through an acceleration lane;
 *   - ring -> stem, from the carriageway on the stem's side: a direct left-hand ramp, leaving through a deceleration lane;
 *   - stem -> ring and ring -> stem for the carriageway on the FAR side of the ring: a flyover ramp that crosses over the near carriageway and the median
 *     (clearance 5.5 m + the girder) and joins the far carriageway from its own kerb.
 * Heights are pinned at both ends (the deck heights of the two routes); the profile between is the lowest one that clears the ground, the roads, the railway,
 * the river and the other deck within the ramp grade and K limits. The stem's last 40 m and the ring's aux lanes are where the ramps leave / join.
 */

const HW = XD.ramp2W / 2;
const LANES = 2;
const R = XD.rampMinRadius;

interface Pose {
  x: number;
  z: number;
  h: number;
  y: number;
}

interface LinkSpec {
  name: string;
  type: 'entrance' | 'exit';
  flyover: boolean;
  from: Pose;
  to: Pose;
  ring: XRoute;
  stem: XRoute;
  side: number;
  noseS: number;
  /** Which end of the flow touches the ring nose. */
  noseAtEnd: boolean;
}

function turnOfPath(p: { seg: [number, number, number]; R: number }): number {
  return (p.seg[0] + p.seg[2]) / p.R;
}

function tryLink(ctx: RampContext, o: LinkSpec): XRoute | null {
  const world = ctx.world;
  const paths = dubinsPaths(o.from.x, o.from.z, o.from.h, o.to.x, o.to.z, o.to.h, R)
    .filter((p) => p.word[1] === 'S' && turnOfPath(p) <= (300 * Math.PI) / 180)
    // a flow that starts at the ring nose leaves the deck with a left turn; a flow that ends at the nose comes from the kerb side and straightens out with a left turn
    .filter((p) => (o.noseAtEnd ? p.word[2] === 'L' : p.word[0] === 'L'))
    .slice(0, 2);
  const ringIdx = polyOf(o.ring);
  const stemIdx = polyOf(o.stem);
  const others = ctx.others.filter((r) => r.main && r.id !== o.ring.id && r.id !== o.stem.id).map((r) => ({ r, idx: polyOf(r) }));
  for (const path of paths) {
    const flow = resample(sampleDubins(path, 2).pts, STEP);
    const m = flow.length;
    const cum = new Float64Array(m);
    for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + Math.hypot(flow[i][0] - flow[i - 1][0], flow[i][1] - flow[i - 1][1]);
    const L = cum[m - 1];
    const dir = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const a = flow[Math.max(0, i - 1)];
      const b = flow[Math.min(m - 1, i + 1)];
      dir[i] = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
    const gmax = new Float64Array(m);
    const gcc = new Float64Array(m);
    const ymin = new Float64Array(m);
    let ok = true;
    let wetRun = 0;
    for (let i = 0; i < m && ok; i++) {
      const [x, z] = flow[i];
      const dNose = o.noseAtEnd ? L - cum[i] : cum[i];
      const dStem = o.noseAtEnd ? cum[i] : L - cum[i];
      const nx = Math.sin(dir[i]);
      const nz = -Math.cos(dir[i]);
      if (dNose > 60 && dStem > 60) {
        const cc = cellClass(ctx, x, z, HW);
        if (cc & 1) ok = false;
        wetRun = cc & 2 ? wetRun + STEP : 0;
        if (wetRun > 64) ok = false;
        // railway land, water, pads, fenced areas: only a problem where the ramp is low; the profile lifts it elsewhere
      }
      if (dNose > 100 && ringIdx.dist(x, z, o.ring.halfWidth + 3 + HW) < Infinity && !o.flyover) ok = false;
      if (dStem > 120 && stemIdx.dist(x, z, o.stem.halfWidth + 3 + HW) < Infinity) ok = false;
      for (const e of others) if (e.idx.dist(x, z, e.r.halfWidth + 3 + HW) < Infinity) ok = false;
      let g = -Infinity;
      let wet = -Infinity;
      for (const u of [-HW, 0, HW]) {
        const s = world.sample(x + nx * u, z + nz * u);
        if (s.h > g) g = s.h;
        if (u === 0) gcc[i] = s.h;
        if (!Number.isNaN(s.water) && s.h < s.water && s.water > wet) wet = s.water;
      }
      gmax[i] = g;
      let v = g + 0.06;
      const depth = CROSS_DEPTH;
      const ax = x + nx * HW;
      const az = z + nz * HW;
      const bx = x - nx * HW;
      const bz = z - nz * HW;
      for (const h of [...world.roadsUnder(ax, az, bx, bz), ...world.railUnder(ax, az, bx, bz), ...world.padsUnder(ax, az, bx, bz)]) v = Math.max(v, h.top + h.clear + depth);
      if (wet > -Infinity) v = Math.max(v, wet + XD.clearRiver + depth);
      for (const e of others) {
        const q = e.idx.query(ax, az, bx, bz, e.r.halfWidth + 3);
        if (q) v = Math.max(v, q.y + XD.clearRoad + depth);
      }
      // the deck it crosses over (flyover) or the stem / ring it only leaves: only the flyover crossing needs the clearance
      if (o.flyover && dNose > 100) {
        const q = ringIdx.query(ax, az, bx, bz, o.ring.halfWidth + 3);
        if (q) v = Math.max(v, q.y + XD.clearRoad + structuralDepth(65) + 0.5);
      }
      ymin[i] = v;
    }
    if (!ok) continue;
    ymin[0] = Math.max(ymin[0], o.from.y);
    ymin[m - 1] = Math.max(ymin[m - 1], o.to.y);
    // both ends are on decks: the profile may not sit lower than the pinned heights at the ends
    const y = solveProfile(ymin, cum, { grade: 0.055, kCrest: XD.rampKCrest, kSag: XD.rampKSag });
    if (Math.abs(y[0] - o.from.y) > 0.05 || Math.abs(y[m - 1] - o.to.y) > 0.05) continue;
    return assemble(o, flow, cum, dir, y, gmax, gcc);
  }
  return null;
}

function assemble(o: LinkSpec, flow: Pt[], cum: Float64Array, _dir: Float64Array, y: Float64Array, gmax: Float64Array, gcc: Float64Array): XRoute {
  const m = flow.length;
  const xs = new Float64Array(m);
  const zs = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    xs[i] = flow[i][0];
    zs[i] = flow[i][1];
  }
  const heading = new Float64Array(m);
  const kappa = new Float64Array(m);
  for (let i = 0; i < m; i++) heading[i] = i + 1 < m ? Math.atan2(zs[i + 1] - zs[i], xs[i + 1] - xs[i]) : heading[i - 1];
  for (let i = 1; i + 1 < m; i++) {
    let d = Math.atan2(zs[i + 1] - zs[i], xs[i + 1] - xs[i]) - Math.atan2(zs[i] - zs[i - 1], xs[i] - xs[i - 1]);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    kappa[i] = (-d / (cum[i + 1] - cum[i - 1])) * 2;
  }
  kappa[0] = kappa[1];
  kappa[m - 1] = kappa[m - 2];
  const pos = new Float64Array(m);
  const neg = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const k = Math.abs(kappa[i]);
    const req = k > 1e-6 ? rampSuperelevation(1 / k, XD.rampSpeed) : 0;
    if (kappa[i] >= 0) pos[i] = Math.max(req, XD.crown);
    else neg[i] = req;
  }
  const rate = (0.0065 / (2 * HW)) * STEP;
  for (const a of [pos, neg]) {
    for (let it = 0; it < 2; it++) {
      for (let i = 1; i < m; i++) a[i] = Math.max(a[i], a[i - 1] - rate);
      for (let i = m - 2; i >= 0; i--) a[i] = Math.max(a[i], a[i + 1] - rate);
    }
  }
  const e = new Float64Array(m);
  for (let i = 0; i < m; i++) e[i] = clamp(pos[i] - neg[i], -XD.rampEMax, XD.rampEMax);
  const viaduct = new Uint8Array(m);
  for (let i = 0; i < m; i++) viaduct[i] = y[i] - gcc[i] >= XD.embankMax ? 1 : 0;
  const info: XRampInfo = {
    type: o.type,
    onRoute: o.ring.id,
    noseS: o.noseS,
    side: o.side,
    lanes: LANES,
    speed: XD.rampSpeed,
    taper: LANES * 3.6 * XD.taperRatio,
    parallel: o.type === 'exit' ? XD.decelLen : XD.accelLen,
    auxS0: 0,
    auxS1: 0,
    landing: null,
    mergeLen: 0,
    fromRoad: o.type === 'entrance',
    system: true,
    flyover: o.flyover,
    stemRoute: o.stem.id,
    toRoute: o.ring.id,
    toS: o.noseS,
  };
  return {
    id: -1,
    name: o.name,
    kind: 'ramp',
    closed: false,
    main: false,
    lanes: LANES,
    halfWidth: HW,
    step: STEP,
    xs,
    zs,
    ys: y,
    ground: gmax,
    gc: gcc,
    cum,
    length: cum[m - 1],
    heading,
    kappa,
    e,
    cl: Float64Array.from(e),
    cr: Float64Array.from(e, (v) => -v),
    girder: new Float64Array(m),
    viaduct,
    wl: new Float64Array(m),
    wr: new Float64Array(m),
    openL: new Uint8Array(m),
    openR: new Uint8Array(m),
    ramp: info,
    label: o.stem.name,
  };
}

/** Pose on a ring carriageway nose (2-lane ramp lateral position). */
function nosePose(ring: XRoute, s: number, side: number): Pose {
  const f = frameAt(ring, s);
  const u = side * (LANE_OUT + 1.8 * LANES);
  return { x: f.x + Math.sin(f.h) * u, z: f.z - Math.cos(f.h) * u, h: side > 0 ? f.h : f.h + Math.PI, y: deckHeightAt(f, u) };
}

export function addSystemT(ctx: RampContext, stem: XRoute, end: 'start' | 'end', ring: XRoute, n: number, id: string): XInterchange | null {
  const fe = frameAt(stem, end === 'end' ? stem.length : 0);
  const hOut = end === 'end' ? fe.h : fe.h + Math.PI;
  const so = end === 'end' ? 1 : -1; // side of the stem carriageway that carries the traffic leaving the stem
  const ln = (u: number): { x: number; z: number; y: number } => ({ x: fe.x + Math.sin(fe.h) * u, z: fe.z - Math.cos(fe.h) * u, y: deckHeightAt(fe, u) });
  // the ring station nearest to the stem end, and which side of the ring the stem is on
  let bs = 0;
  let bd = Infinity;
  for (let i = 0; i < ring.xs.length; i++) {
    const d = Math.hypot(ring.xs[i] - fe.x, ring.zs[i] - fe.z);
    if (d < bd) {
      bd = d;
      bs = i;
    }
  }
  const s0 = ring.cum[bs];
  const sigma = (fe.x - ring.xs[bs]) * Math.sin(ring.heading[bs]) + (fe.z - ring.zs[bs]) * -Math.cos(ring.heading[bs]) > 0 ? 1 : -1;
  const made: XRoute[] = [];
  const aux = (type: 'entrance' | 'exit'): number => LANES * 3.6 * XD.taperRatio + (type === 'exit' ? XD.decelLen : XD.accelLen) + XD.goreLen;
  const offs = [0, 90, -90, 180, -180, 270, -270, 360, -360, 450, -450, 540, -540, 630, -630, 720, -720, 900, -900];
  const move = (label: string, type: 'entrance' | 'exit', c: number, flyover: boolean, stemLat: number[]): void => {
    let best: XRoute | null = null;
    let bestS = 0;
    for (const off of offs) {
      const s = s0 + off;
      const dirS = c > 0 ? 1 : -1;
      const lo = type === 'exit' ? s - dirS * aux(type) : s - dirS * XD.goreLen;
      const hi = type === 'exit' ? s + dirS * XD.goreLen : s + dirS * (aux(type) - XD.goreLen);
      if (Math.min(lo, hi) < 20 || Math.max(lo, hi) > ring.length - 20) continue;
      const nose = nosePose(ring, s, c);
      for (const u of stemLat) {
        const sp = ln(u);
        const stemPose: Pose = type === 'entrance' ? { x: sp.x, z: sp.z, h: hOut, y: sp.y } : { x: sp.x, z: sp.z, h: hOut + Math.PI, y: sp.y };
        const spec: LinkSpec = {
          name: `${stem.name}-${label}`,
          type,
          flyover,
          from: type === 'entrance' ? stemPose : nose,
          to: type === 'entrance' ? nose : stemPose,
          ring,
          stem,
          side: c,
          noseS: s,
          noseAtEnd: type === 'entrance',
        };
        const r = tryLink(ctx, spec);
        if (r && (!best || r.length < best.length)) {
          best = r;
          bestS = s;
        }
      }
      if (best && Math.abs(off) >= 360) break;
    }
    if (best) {
      best.id = ctx.nextId();
      best.ramp!.noseS = bestS;
      register(ctx, best, ring);
      made.push(best);
    } else ctx.notes.push(`system interchange ${n} (${id}): the ${label} ramp found no legal path`);
  };
  const out = [so * 14.3, so * 7.1];
  const inn = [-so * 14.3, -so * 7.1];
  // stem -> near / far ring carriageway, near / far ring carriageway -> stem
  move('to-ring-near', 'entrance', sigma, false, [out[0]]);
  move('to-ring-far', 'entrance', -sigma, true, [out[1]]);
  move('from-ring-near', 'exit', sigma, false, inn);
  move('from-ring-far', 'exit', -sigma, true, inn);
  void hOut;
  if (!made.length) return null;
  const ic: XInterchange = { n, id, kind: 'system', x: fe.x, z: fe.z, routeId: stem.id, s: end === 'end' ? stem.length : 0, rampIds: made.map((r) => r.id), roads: [ring.name], ringRoute: ring.id, ringS: s0 };
  ctx.interchanges.push(ic);
  return ic;
}
