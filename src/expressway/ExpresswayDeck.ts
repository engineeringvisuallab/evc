import { CARRIAGEWAY_MID, DECK_HALF, E_RATE, XD, girderDepth, pierSize, structuralDepth, superelevation } from './ExpresswayStandards';
import type { Alignment } from './ExpresswayAlign';
import { MAIN_LIMITS, solveProfile } from './ExpresswayProfile';
import { PolyIndex, clamp } from './ExpresswayMath';
import type { XHit, XWorld } from './ExpresswayWorld';
import type { XPier, XRoute, XSpan } from './ExpresswayTypes';
import type { XKind } from './ExpresswayPlan';

/**
 * MAIN DECK: from a horizontal alignment to a finished 8-lane viaduct / embankment.
 *   1. look under the deck at every station: ground, water, roads, railway, junction pads, other expressway decks;
 *   2. work out how high the deck must be (clearance + structure depth), solve the vertical profile (grade, K);
 *   3. superelevation from the curvature (rate-limited), cross slopes of the two carriageways;
 *   4. embankment / retained fill where the deck is lower than 3 m over the ground, viaduct elsewhere;
 *   5. pier positions by dynamic programming: spans 30-40 m, longer only where a road / rail / river / junction forces it, piers never on a road
 *      (except the yellow line of a highway), the railway, water, a building ...; a pier that cannot stand on the centre line gets a portal (two columns beside the road).
 */

export interface DeckContext {
  world: XWorld;
  /** Routes already built (this deck passes over them). */
  others: XRoute[];
  piers: XPier[];
  spans: XSpan[];
  issues: string[];
  notes: string[];
  nextId(): number;
}

/** Height of the cap beam's underside below the soffit of the girder (bearing 0.3 m + cap depth). */
const CAP_DEPTH = 2.4;
const CAP_HANG = 0.3 + CAP_DEPTH;
const CAND = 3; // pier candidate spacing (m)
const ALONG_RUN = 55; // a feature under the deck for longer than this (m) runs ALONG it: the cap beams must clear it too

interface HitInfo {
  top: number;
  clear: number;
  along: boolean;
  name: string;
}
interface PierPlan {
  kind: 'single' | 'median' | 'portal';
  /** Portal: lateral positions (m from the deck centre line, + = left) of the two columns. */
  lp: number;
  lq?: number;
}

function runsOf(flags: ArrayLike<number>, gap = 1): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  let a = -1;
  let last = -1;
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    if (a < 0) a = i;
    else if (i - last > gap + 1) {
      out.push({ a, b: last });
      a = i;
    }
    last = i;
  }
  if (a >= 0) out.push({ a, b: last });
  return out;
}

/** Superelevation profile (signed, + = banked left) from the curvature: the required value, then the lowest line above it that changes no faster than E_RATE. */
export function superelevationProfile(kappa: ArrayLike<number>, cum: ArrayLike<number>): Float64Array {
  const n = kappa.length;
  const pos = new Float64Array(n);
  const neg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(kappa[i]);
    const e = k > 1e-9 ? superelevation(1 / k) : 0;
    if (kappa[i] > 0) pos[i] = e;
    else neg[i] = e;
  }
  for (const a of [pos, neg]) {
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < n; i++) a[i] = Math.max(a[i], a[i - 1] - E_RATE * (cum[i] - cum[i - 1]));
      for (let i = n - 2; i >= 0; i--) a[i] = Math.max(a[i], a[i + 1] - E_RATE * (cum[i + 1] - cum[i]));
    }
  }
  const e = new Float64Array(n);
  for (let i = 0; i < n; i++) e[i] = clamp(pos[i] - neg[i], -XD.eMax, XD.eMax);
  return e;
}

/** Cross slopes (fall per metre away from the centre line) of the left / right carriageway for a superelevation e (+ = left bank): the outer carriageway turns about the median edge, crown removed first. */
export function crossSlopes(e: number): { cl: number; cr: number } {
  const q = XD.crown;
  const a = Math.abs(e);
  const inside = Math.max(q, a);
  const outside = a <= q ? q - 2 * a : -a;
  return e >= 0 ? { cl: inside, cr: outside } : { cl: outside, cr: inside };
}

export function buildMainRoute(ctx: DeckContext, name: string, kind: XKind, al: Alignment, ends: { start: 'free' | 'grade'; end: 'free' | 'grade' } = { start: 'free', end: 'free' }): XRoute {
  void ends;
  const world = ctx.world;
  const n = al.xs.length;
  const E = DECK_HALF;
  const dxs = new Float64Array(n);
  const dzs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    dxs[i] = Math.cos(al.heading[i]);
    dzs[i] = Math.sin(al.heading[i]);
  }
  const ext = ctx.others.map((r) => ({ r, idx: new PolyIndex(r.xs, r.zs, r.ys, r.halfWidth + 3) }));

  /* ------------------------------------------------ 1. under the deck */
  const gMax = new Float64Array(n);
  const gc = new Float64Array(n);
  const waterY = new Float64Array(n).fill(NaN);
  const wetAny = new Uint8Array(n);
  const ko = new Uint8Array(n);
  const hasHit = new Uint8Array(n);
  const hits: XHit[][] = new Array(n);
  const us = [E, E / 2, 0, -E / 2, -E];
  let koCount = 0;
  for (let i = 0; i < n; i++) {
    const nx = dzs[i];
    const nz = -dxs[i];
    let g = -Infinity;
    let w = NaN;
    for (let k = 0; k < 5; k++) {
      const px = al.xs[i] + nx * us[k];
      const pz = al.zs[i] + nz * us[k];
      const s = world.sample(px, pz);
      if (s.h > g) g = s.h;
      if (k === 2) gc[i] = s.h;
      if (!Number.isNaN(s.water) && s.h < s.water) {
        wetAny[i] = 1;
        if (Number.isNaN(w) || s.water > w) w = s.water;
      }
      if (!ko[i] && world.keepOut(px, pz, 0)) {
        ko[i] = 1;
        koCount++;
      }
    }
    gMax[i] = g;
    waterY[i] = w;
    const ax = al.xs[i] + nx * E;
    const az = al.zs[i] + nz * E;
    const bx = al.xs[i] - nx * E;
    const bz = al.zs[i] - nz * E;
    const h = world.featuresUnder(ax, az, bx, bz);
    for (const e of ext) {
      const q = e.idx.query(ax, az, bx, bz, e.r.halfWidth + 3);
      if (q) h.push({ kind: 'road', ref: 100000 + e.r.id, tier: 0, name: e.r.name, top: q.y, clear: XD.clearRoad, d: q.d, onBridge: false });
    }
    hits[i] = h;
    if (h.length) hasHit[i] = 1;
  }
  if (koCount) ctx.notes.push(`${name}: ${koCount} stations have a building / site / facility under the deck width`);

  // runs of every feature: a long run ALONG the deck needs the cap beams to clear it too
  const byKey = new Map<string, number[]>();
  for (let i = 0; i < n; i++) for (const h of hits[i]) {
    const k = `${h.kind}:${h.ref}`;
    const a = byKey.get(k);
    if (a) a.push(i);
    else byKey.set(k, [i]);
  }
  const alongSet = new Set<string>(); // `${key}@${station}`
  for (const [k, list] of byKey) {
    let a = list[0];
    let last = list[0];
    const flush = (): void => {
      if ((last - a + 1) * 10 > ALONG_RUN) for (let q = a; q <= last; q++) alongSet.add(`${k}@${q}`);
    };
    for (let q = 1; q < list.length; q++) {
      if (list[q] - last > 2) {
        flush();
        a = list[q];
      }
      last = list[q];
    }
    flush();
  }
  const hitInfo: HitInfo[][] = hits.map((hs, i) => hs.map((h) => ({ top: h.top, clear: h.clear, along: alongSet.has(`${h.kind}:${h.ref}@${i}`), name: h.name })));
  const wetAlong = new Uint8Array(n);
  for (const r of runsOf(wetAny, 2)) if ((r.b - r.a + 1) * 10 > ALONG_RUN) for (let i = r.a; i <= r.b; i++) wetAlong[i] = 1;

  const extNear = (x: number, z: number, rc: number): boolean => {
    for (const e of ext) if (e.idx.dist(x, z, e.r.halfWidth + 3 + rc) < Infinity) return true;
    return false;
  };

  // where a column on the centre line cannot stand (road, rail, water, pad, other deck ...): decides the span (and so the girder depth) there
  const cb = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!hasHit[i] && !wetAny[i] && !ko[i]) continue;
    const r = world.pierBlocked(al.xs[i], al.zs[i], 2.0, dxs[i], dzs[i], true);
    if ((r !== null && r !== 'median') || extNear(al.xs[i], al.zs[i], 2.0)) cb[i] = 1;
  }
  const spanEst = new Float64Array(n).fill(XD.spanNormal);
  for (const r of runsOf(cb, 1)) {
    const len = (r.b - r.a + 1) * 10 + 8;
    const sp = clamp(len, XD.spanNormal, XD.spanLong);
    for (let i = Math.max(0, r.a - 1); i <= Math.min(n - 1, r.b + 1); i++) spanEst[i] = Math.max(spanEst[i], sp);
  }

  /* --------------------------------------- 2. lower bound, profile, piers (repeat until the real girder depth clears everything) */
  const lift = new Float64Array(n);
  let y: Float64Array = new Float64Array(n);
  let viaduct = new Uint8Array(n);
  let girder = new Float64Array(n);
  let piers: XPier[] = [];
  let spans: XSpan[] = [];
  const routeId = ctx.nextId();
  for (let pass = 0; pass < 4; pass++) {
    const ymin = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const depth = structuralDepth(spanEst[i]);
      let v = gMax[i] + XD.embankTop;
      for (const h of hitInfo[i]) v = Math.max(v, h.top + h.clear + (h.along ? CAP_HANG : 0) + depth);
      if (!Number.isNaN(waterY[i])) v = Math.max(v, waterY[i] + XD.clearRiver + (wetAlong[i] ? CAP_HANG : 0) + depth);
      ymin[i] = v + lift[i];
    }
    y = solveProfile(ymin, al.cum, MAIN_LIMITS);
    // viaduct / fill
    viaduct = new Uint8Array(n);
    const must = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      must[i] = hasHit[i] || wetAny[i] ? 1 : 0;
      viaduct[i] = y[i] - gc[i] >= XD.embankMax || must[i] ? 1 : 0;
    }
    for (const r of runsOf(viaduct, 0)) {
      let mx = 0;
      let forced = false;
      for (let i = r.a; i <= r.b; i++) {
        mx = Math.max(mx, y[i] - gc[i]);
        if (must[i]) forced = true;
      }
      if ((r.b - r.a + 1) * 10 < 60 && !forced && mx < 6) for (let i = r.a; i <= r.b; i++) viaduct[i] = 0;
    }
    const fill = new Uint8Array(n);
    for (let i = 0; i < n; i++) fill[i] = viaduct[i] ? 0 : 1;
    for (const r of runsOf(fill, 0)) {
      if (r.a > 0 && r.b < n - 1 && (r.b - r.a + 1) * 10 < 60) for (let i = r.a; i <= r.b; i++) viaduct[i] = 1;
    }
    // piers
    piers = [];
    spans = [];
    girder = new Float64Array(n);
    const size = pierSize(2 * DECK_HALF, XD.spanNormal, 2, XD.lanes);
    const placed = placePiers();
    piers = placed.piers;
    spans = placed.spans;
    for (const sp of spans) {
      const d = girderDepth(sp.length);
      for (let i = 0; i < n; i++) if (al.cum[i] >= sp.s0 - 1e-6 && al.cum[i] <= sp.s1 + 1e-6) girder[i] = Math.max(girder[i], d);
    }
    // check the real depths
    let deficit = false;
    for (let i = 0; i < n; i++) {
      if (!viaduct[i]) continue;
      const soffit = y[i] - XD.asphalt - XD.slab - girder[i];
      let need = 0;
      for (const h of hitInfo[i]) need = Math.max(need, h.top + h.clear + (h.along ? CAP_HANG : 0));
      if (!Number.isNaN(waterY[i])) need = Math.max(need, waterY[i] + XD.clearRiver + (wetAlong[i] ? CAP_HANG : 0));
      if (need > 0 && soffit < need - 0.02) {
        const d = need - soffit + 0.05;
        for (let q = Math.max(0, i - 1); q <= Math.min(n - 1, i + 1); q++) lift[q] = Math.max(lift[q], lift[i] + d);
        lift[i] = Math.max(lift[i], d + (y[i] - ymin[i] > 0 ? 0 : 0));
        deficit = true;
      }
    }
    void size;
    if (!deficit) break;
    if (pass === 3) ctx.issues.push(`${name}: clearance still short after 4 passes`);
  }
  for (const p of piers) ctx.piers.push(p);
  for (const s of spans) ctx.spans.push(s);

  /* ------------------------------------------------ 3. superelevation and cross slopes */
  const e = superelevationProfile(al.kappa, al.cum);
  const cl = new Float64Array(n);
  const cr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = crossSlopes(e[i]);
    cl[i] = c.cl;
    cr[i] = c.cr;
  }

  const route: XRoute = {
    id: routeId,
    name,
    kind,
    closed: false,
    main: true,
    lanes: XD.lanes,
    halfWidth: DECK_HALF,
    step: 10,
    xs: al.xs,
    zs: al.zs,
    ys: y,
    ground: gMax,
    gc,
    cum: al.cum,
    length: al.length,
    heading: al.heading,
    kappa: al.kappa,
    e,
    cl,
    cr,
    girder,
    viaduct,
    wl: new Float64Array(n),
    wr: new Float64Array(n),
    openL: new Uint8Array(n),
    openR: new Uint8Array(n),
  };
  return route;

  /* ---------------------------------------------------------- piers (closure over the pass) */
  function posAt(s: number): { x: number; z: number; dx: number; dz: number; y: number; i: number } {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (al.cum[m] <= s) lo = m;
      else hi = m;
    }
    const t = clamp((s - al.cum[lo]) / Math.max(1e-6, al.cum[hi] - al.cum[lo]), 0, 1);
    const hd = al.heading[lo] + (al.heading[hi] - al.heading[lo]) * t;
    return { x: al.xs[lo] + (al.xs[hi] - al.xs[lo]) * t, z: al.zs[lo] + (al.zs[hi] - al.zs[lo]) * t, dx: Math.cos(hd), dz: Math.sin(hd), y: y[lo] + (y[hi] - y[lo]) * t, i: t < 0.5 ? lo : hi };
  }

  function pierPlan(s: number): PierPlan | null {
    const p = posAt(s);
    const i = p.i;
    const lo = Math.max(0, i - 1);
    const hi = Math.min(n - 1, i + 1);
    let near = false;
    for (let q = lo; q <= hi; q++) if (hasHit[q] || wetAny[q] || ko[q]) near = true;
    if (!near) return { kind: 'single', lp: 0 };
    // the cap beam (it reaches across the whole deck) must clear every road / rail that is not already cleared by design
    const capBottom = p.y - XD.asphalt - XD.slab - girderDepth(XD.spanNormal) - CAP_HANG;
    for (let q = lo; q <= hi; q++) for (const h of hitInfo[q]) if (!h.along && capBottom < h.top + h.clear - 0.05) return null;
    if (!Number.isNaN(waterY[i]) && !wetAlong[i] && capBottom < waterY[i] + XD.clearRiver - 0.05) return null;
    const r1 = world.pierBlocked(p.x, p.z, 2.0, p.dx, p.dz, true);
    if ((r1 === null || r1 === 'median') && !extNear(p.x, p.z, 2.0)) return { kind: r1 === 'median' ? 'median' : 'single', lp: 0 };
    const nx = p.dz;
    const nz = -p.dx;
    // portal: two columns, one each side of the road, at any lateral positions the cap beam reaches (a road need not be under the middle of the deck)
    const lat = [9, 10.5, 12, 13.5, 15, 16.5, 18];
    const okAt = (l: number): boolean => {
      const cx = p.x + nx * l;
      const cz = p.z + nz * l;
      return world.pierBlocked(cx, cz, 1.5, p.dx, p.dz, false) === null && !extNear(cx, cz, 1.5);
    };
    let left = 0;
    let right = 0;
    for (const l of lat) if (!left && okAt(l)) left = l;
    for (const l of lat) if (!right && okAt(-l)) right = -l;
    if (left && right) return { kind: 'portal', lp: left, lq: right };
    return null;
  }

  function placePiers(): { piers: XPier[]; spans: XSpan[] } {
    const outP: XPier[] = [];
    const outS: XSpan[] = [];
    const size = pierSize(2 * DECK_HALF, XD.spanNormal, 2, XD.lanes);
    for (const run of runsOf(viaduct, 0)) {
      const sa = al.cum[run.a];
      const sb = al.cum[run.b];
      if (sb - sa < 12) continue;
      const K = Math.max(1, Math.floor((sb - sa) / CAND));
      const pos: number[] = [];
      for (let k = 0; k < K; k++) pos.push(sa + k * CAND);
      pos.push(sb);
      const m = pos.length;
      const plan: (PierPlan | null)[] = new Array(m);
      for (let k = 1; k < m - 1; k++) plan[k] = pierPlan(pos[k]);
      plan[0] = { kind: 'single', lp: 0 };
      plan[m - 1] = { kind: 'single', lp: 0 };
      let chosen: number[] | null = null;
      for (const maxSpan of [XD.spanMax, XD.spanSpecial, XD.spanLong]) {
        const cost = new Float64Array(m).fill(Infinity);
        const prev = new Int32Array(m).fill(-1);
        cost[0] = 0;
        for (let k2 = 1; k2 < m; k2++) {
          if (!plan[k2]) continue;
          for (let k1 = k2 - 1; k1 >= 0; k1--) {
            const span = pos[k2] - pos[k1];
            if (span > maxSpan) break;
            if (!plan[k1] || cost[k1] === Infinity) continue;
            const minSpan = k1 === 0 || k2 === m - 1 ? 12 : XD.spanMin;
            if (span < minSpan) continue;
            const d = span - XD.spanNormal;
            const sc = span <= XD.spanMax ? 0.5 * d * d : 8 + 5 * (span - XD.spanMax) + 0.05 * d * d;
            const c = cost[k1] + sc + (k2 === m - 1 ? 0 : 60 + (plan[k2]!.kind === 'portal' ? 300 : 0));
            if (c < cost[k2]) {
              cost[k2] = c;
              prev[k2] = k1;
            }
          }
        }
        if (cost[m - 1] < Infinity) {
          chosen = [];
          for (let k = m - 1; k >= 0; k = prev[k]) {
            chosen.push(k);
            if (k === 0) break;
          }
          chosen.reverse();
          break;
        }
      }
      if (!chosen) {
        // no legal pier layout: lay piers every 36 m anyway and say so
        ctx.issues.push(`${name}: no legal pier layout between ${sa.toFixed(0)} and ${sb.toFixed(0)} m`);
        chosen = [0];
        for (let k = 1; k < m - 1; k++) if (pos[k] - pos[chosen[chosen.length - 1]] >= XD.spanNormal) chosen.push(k);
        chosen.push(m - 1);
      }
      for (let c = 0; c < chosen.length; c++) {
        const k = chosen[c];
        const p = posAt(pos[k]);
        const a = c > 0 ? pos[k] - pos[chosen[c - 1]] : 0;
        const b = c + 1 < chosen.length ? pos[chosen[c + 1]] - pos[k] : 0;
        const pl = plan[k] ?? { kind: 'single' as const, lp: 0 };
        const abut = c === 0 || c === chosen.length - 1;
        const depth = girderDepth(Math.max(a, b, 1));
        const g = world.ground(p.x, p.z);
        const nx = p.dz;
        const nz = -p.dx;
        const portal = pl.kind === 'portal';
        const cols = portal
          ? [pl.lp, pl.lq ?? -pl.lp].map((l) => ({ x: p.x + nx * l, z: p.z + nz * l }))
          : [{ x: p.x, z: p.z }];
        const capTop = p.y - XD.asphalt - XD.slab - depth - 0.3;
        outP.push({
          routeId,
          s: pos[k],
          dx: p.dx,
          dz: p.dz,
          x: p.x,
          z: p.z,
          kind: abut ? 'abutment' : pl.kind,
          cols,
          b: portal ? 2.0 : size.b,
          t: portal ? 2.0 : size.t,
          capTop,
          capDepth: CAP_DEPTH,
          capHalf: DECK_HALF - 1,
          roll: 0,
          bottom: g - XD.footing,
          ground: g,
          spanA: a,
          spanB: b,
          deckY: p.y,
        });
        if (c > 0) {
          const len = pos[k] - pos[chosen[c - 1]];
          outS.push({ routeId, s0: pos[chosen[c - 1]], s1: pos[k], length: len, depth: girderDepth(len), material: len <= XD.spanMax ? 'pc-girder' : len <= XD.spanSpecial ? 'pc-box' : 'steel-box' });
        }
      }
    }
    return { piers: outP, spans: outS };
  }
}

/** Where on the cross-section a carriageway's centre line is (m from the route centre line): +CARRIAGEWAY_MID left, - right. */
export const CARRIAGEWAY_OFFSET = CARRIAGEWAY_MID;
