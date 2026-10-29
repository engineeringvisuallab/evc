import { XD, spiralLength } from './ExpresswayStandards';
import { clamp, wrapAngle, type Pt } from './ExpresswayMath';

/**
 * HORIZONTAL ALIGNMENT: long straight tangents joined by circular arcs, with a clothoid (spiral) at each end of an arc, like a real
 * highway (AASHTO GB 3.3). The guide polyline (from the router, or the centre line of an ordinary highway) only says WHERE the road goes;
 * every corner of it becomes a curve of radius >= `rMin`, and a corner that does not have room for such a curve is cut (chamfered) into
 * two smaller corners or, if it is very gentle, straightened. Curvature is signed: + = turning LEFT of the direction of travel.
 */

export interface PI {
  /** The point of intersection of the two tangents. */
  x: number;
  z: number;
  /** Deflection (rad, + = left) and chosen radius / spiral length / total tangent length (m). */
  delta: number;
  R: number;
  Ls: number;
  Ts: number;
  /** Stations (m) of the tangent-to-spiral and spiral-to-tangent points. */
  s0: number;
  s1: number;
}

export interface Alignment {
  xs: Float64Array;
  zs: Float64Array;
  /** Signed curvature (1 / m): + = left. */
  kappa: Float64Array;
  /** Heading (rad, atan2(dz, dx)). */
  heading: Float64Array;
  cum: Float64Array;
  length: number;
  curves: PI[];
}

export interface FitOptions {
  rMin?: number;
  rMax?: number;
  minTangent?: number;
  step?: number;
  /** Douglas-Peucker tolerance (m) used to pick the corners of the guide first. */
  tol?: number;
  /** Take the sharp bends out of the guide first (default true). */
  relax?: boolean;
}

/* ------------------------------------------------------------------ helpers */

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Douglas-Peucker: the few points that keep the polyline within `tol` m. */
export function simplify(pts: readonly Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts.map((p) => [p[0], p[1]] as Pt);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const [ax, az] = pts[i0];
    const [bx, bz] = pts[i1];
    const L = Math.hypot(bx - ax, bz - az) || 1;
    let md = 0;
    let mi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((bx - ax) * (az - pts[i][1]) - (ax - pts[i][0]) * (bz - az)) / L;
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (mi >= 0 && md > tol) {
      keep[mi] = 1;
      stack.push([i0, mi], [mi, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]).map((p) => [p[0], p[1]] as Pt);
}


/** Resample a polyline to points every `step` m (ends kept). */
export function resamplePath(pts: readonly Pt[], step: number): Pt[] {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  const n = Math.max(2, Math.round(total / step));
  const ds = total / n;
  const out: Pt[] = [[pts[0][0], pts[0][1]]];
  let acc = 0;
  let target = ds;
  for (let i = 1; i < pts.length && out.length < n; i++) {
    const L = dist(pts[i - 1], pts[i]);
    while (acc + L >= target - 1e-9 && out.length < n) {
      const t = (target - acc) / (L || 1);
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
      target += ds;
    }
    acc += L;
  }
  out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}

/** Radius of the circle through three points (m); 1e9 for a straight line. */
function circleR(a: Pt, b: Pt, c: Pt): number {
  const A = dist(b, c);
  const B = dist(a, c);
  const C = dist(a, b);
  const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return area2 < 1e-9 ? 1e9 : (A * B * C) / (2 * area2);
}

/**
 * Take the sharpest bends out of a guide: points whose 3-point radius (60 m chords) is below `rTarget` move toward the middle of their
 * neighbours until every bend is gentle enough. The two ends stay where they are. The road moves as little as it must: the gentle parts are not touched.
 */
export function relaxGuide(guide: readonly Pt[], rTarget: number, step = 20): Pt[] {
  const p = resamplePath(guide, step);
  const k = 3;
  for (let it = 0; it < 1500; it++) {
    let moved = 0;
    const q = p.map((v) => [v[0], v[1]] as Pt);
    for (let i = 1; i + 1 < p.length; i++) {
      const a = Math.max(0, i - k);
      const b = Math.min(p.length - 1, i + k);
      const R = circleR(p[a], p[i], p[b]);
      if (R >= rTarget) continue;
      const mx = (p[a][0] + p[b][0]) / 2;
      const mz = (p[a][1] + p[b][1]) / 2;
      const w = Math.min(0.5, 0.15 + 0.5 * (1 - R / rTarget));
      q[i][0] += (mx - p[i][0]) * w;
      q[i][1] += (mz - p[i][1]) * w;
      moved++;
    }
    for (let i = 1; i + 1 < p.length; i++) p[i] = q[i];
    if (!moved) break;
  }
  return p;
}

/** Spiral constants for radius R, spiral length Ls: shift p, tangent extension k (AASHTO GB eq. 3-40). */
function spiralConst(R: number, Ls: number): { ths: number; xs: number; ys: number; k: number; p: number } {
  const ths = Ls / (2 * R);
  const xs = Ls * (1 - (ths * ths) / 10 + ths ** 4 / 216);
  const ys = Ls * (ths / 3 - ths ** 3 / 42 + ths ** 5 / 1320);
  return { ths, xs, ys, k: xs - R * Math.sin(ths), p: ys - R * (1 - Math.cos(ths)) };
}

/** Spiral length used for radius R and deflection |delta|: the comfort length, but never longer than a pure double spiral. */
function spiralFor(R: number, adelta: number): number {
  return Math.min(spiralLength(R), R * adelta);
}

/** Tangent length from the PI to the TS point. */
function tangentLength(R: number, adelta: number): number {
  const Ls = spiralFor(R, adelta);
  const c = spiralConst(R, Ls);
  return (R + c.p) * Math.tan(adelta / 2) + c.k;
}

/** The largest R in [rMin, rMax] whose tangent length is <= T (bisection; tangent length grows with R). null = even rMin does not fit. */
function radiusForTangent(adelta: number, T: number, rMin: number, rMax: number): number | null {
  if (tangentLength(rMin, adelta) > T) return null;
  if (tangentLength(rMax, adelta) <= T) return rMax;
  let lo = rMin;
  let hi = rMax;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (tangentLength(mid, adelta) <= T) lo = mid;
    else hi = mid;
  }
  return lo;
}

/* --------------------------------------------------------------------- fit */

interface Vtx {
  p: Pt;
  /** Deflection of the guide at this vertex (rad, in atan2(dz, dx) terms: + = clockwise on the map). */
  d: number;
  R: number;
  T: number;
}

function deflections(v: Vtx[]): void {
  for (let i = 1; i + 1 < v.length; i++) {
    const a = Math.atan2(v[i].p[1] - v[i - 1].p[1], v[i].p[0] - v[i - 1].p[0]);
    const b = Math.atan2(v[i + 1].p[1] - v[i].p[1], v[i + 1].p[0] - v[i].p[0]);
    v[i].d = wrapAngle(b - a);
  }
}

/**
 * Fit tangents + spirals + arcs to the guide. Returns the dense alignment sampled every `step` m.
 * Corners: R as large as the legs allow (up to rMax), never below rMin; a corner that cannot get rMin is chamfered (big turn) or removed (small turn).
 */
export function fitAlignment(guide: readonly Pt[], opt: FitOptions = {}): Alignment {
  const rMin = opt.rMin ?? XD.rMin;
  const rMax = opt.rMax ?? 3000;
  const minT = opt.minTangent ?? XD.minTangent;
  const step = opt.step ?? 10;
  const base = opt.relax === false ? guide : relaxGuide(guide, rMin * 1.1);
  let pts = simplify(base, opt.tol ?? 20);
  // drop doubles
  pts = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 1);
  let v: Vtx[] = pts.map((p) => ({ p, d: 0, R: rMax, T: 0 }));

  const settle = (): number => {
    deflections(v);
    // very small turns are straight
    for (let i = v.length - 2; i >= 1; i--) if (Math.abs(v[i].d) < 0.0015) v.splice(i, 1);
    deflections(v);
    for (let i = 1; i + 1 < v.length; i++) v[i].T = tangentLength(rMax, Math.abs(v[i].d));
    // share each leg between its two corners
    for (let pass = 0; pass < 8; pass++) {
      for (let k = 0; k + 1 < v.length; k++) {
        const room = dist(v[k].p, v[k + 1].p) - minT;
        const a = k >= 1 ? v[k].T : 0;
        const b = k + 2 < v.length ? v[k + 1].T : 0;
        if (a + b > room) {
          const f = room <= 0 ? 0 : room / (a + b);
          if (k >= 1) v[k].T *= f;
          if (k + 2 < v.length) v[k + 1].T *= f;
        }
      }
    }
    // the radius that fits each tangent length; the corner with the least room is the one to fix first
    let bad = -1;
    let worst = Infinity;
    for (let i = 1; i + 1 < v.length; i++) {
      const R = radiusForTangent(Math.abs(v[i].d), v[i].T, rMin, rMax);
      if (R === null) {
        if (v[i].T < worst) {
          worst = v[i].T;
          bad = i;
        }
      } else v[i].R = R;
    }
    return bad;
  };
  for (let iter = 0; iter < 400; iter++) {
    const bad = settle();
    if (bad < 0) break;
    const b = v[bad];
    const prev = v[bad - 1].p;
    const next = v[bad + 1].p;
    const lp = dist(prev, b.p);
    const ln = dist(next, b.p);
    const need = 3.2 * tangentLength(rMin, Math.abs(b.d) / 2);
    if (Math.abs(b.d) >= (30 * Math.PI) / 180 && Math.min(lp, ln) >= need && Math.abs(b.d) < Math.PI * 0.8) {
      // a real turn with long legs: cut the corner into two half turns
      const a = Math.min(0.4 * lp, 0.4 * ln);
      v.splice(
        bad,
        1,
        { p: [b.p[0] + ((prev[0] - b.p[0]) / lp) * a, b.p[1] + ((prev[1] - b.p[1]) / lp) * a], d: 0, R: rMax, T: 0 },
        { p: [b.p[0] + ((next[0] - b.p[0]) / ln) * a, b.p[1] + ((next[1] - b.p[1]) / ln) * a], d: 0, R: rMax, T: 0 },
      );
    } else {
      v.splice(bad, 1); // no room: the road cuts across the corner
    }
  }
  while (settle() >= 0) {
    // (iteration cap reached) drop what still does not fit
    deflections(v);
    for (let i = 1; i + 1 < v.length; i++) {
      if (radiusForTangent(Math.abs(v[i].d), v[i].T, rMin, rMax) === null) {
        v.splice(i, 1);
        break;
      }
    }
  }

  return build(v, step);
}

/* ------------------------------------------------------------------- build */

function build(v: Vtx[], step: number): Alignment {
  const dense: { x: number; z: number; k: number }[] = [];
  const curves: PI[] = [];
  const push = (x: number, z: number, k: number): void => {
    dense.push({ x, z, k });
  };
  push(v[0].p[0], v[0].p[1], 0);
  let acc = 0; // length so far (for the curve table)
  let last: Pt = [v[0].p[0], v[0].p[1]];
  for (let i = 1; i + 1 < v.length; i++) {
    const P = v[i].p;
    const A = v[i - 1].p;
    const B = v[i + 1].p;
    const adelta = Math.abs(v[i].d);
    const R = v[i].R;
    const Ls = spiralFor(R, adelta);
    const c = spiralConst(R, Ls);
    const Ts = (R + c.p) * Math.tan(adelta / 2) + c.k;
    const tin: Pt = [(P[0] - A[0]) / dist(A, P), (P[1] - A[1]) / dist(A, P)];
    const tout: Pt = [(B[0] - P[0]) / dist(P, B), (B[1] - P[1]) / dist(P, B)];
    const ts: Pt = [P[0] - tin[0] * Ts, P[1] - tin[1] * Ts];
    const st: Pt = [P[0] + tout[0] * Ts, P[1] + tout[1] * Ts];
    // curve side: turning toward +theta (clockwise on the map, d > 0) means the centre is to the right of the heading in (x, z): normal (-tz, tx)
    const sgn = v[i].d > 0 ? 1 : -1;
    const nIn: Pt = [-tin[1] * sgn, tin[0] * sgn]; // inside normal at TS
    const nOut: Pt = [-tout[1] * sgn, tout[0] * sgn]; // inside normal at ST
    // straight to TS
    push(ts[0], ts[1], 0);
    acc += dist(last, ts);
    const s0 = acc;
    // first spiral
    const nS = Math.max(4, Math.ceil(Ls / 2));
    const kappaMax = -sgn / R; // + = left: a clockwise (d > 0) turn is a RIGHT turn -> negative
    for (let q = 1; q <= nS; q++) {
      const s = (Ls * q) / nS;
      const phi = (s * s) / (2 * R * Ls);
      const x = s * (1 - (phi * phi) / 10 + phi ** 4 / 216);
      const y = s * (phi / 3 - phi ** 3 / 42 + phi ** 5 / 1320);
      push(ts[0] + tin[0] * x + nIn[0] * y, ts[1] + tin[1] * x + nIn[1] * y, kappaMax * (s / Ls));
    }
    // circular arc between the spirals
    const arcAngle = adelta - 2 * c.ths;
    if (arcAngle > 1e-6) {
      const cx0 = ts[0] + tin[0] * c.xs + nIn[0] * c.ys; // end of spiral 1
      const cz0 = ts[1] + tin[1] * c.xs + nIn[1] * c.ys;
      // centre of the arc: from the end of spiral 1 go R along the inside normal, which has been turned by ths
      const th = Math.atan2(tin[1], tin[0]) + sgn * c.ths;
      const nx = -Math.sin(th) * sgn;
      const nz = Math.cos(th) * sgn;
      const cenx = cx0 + nx * R;
      const cenz = cz0 + nz * R;
      const nA = Math.max(2, Math.ceil((R * arcAngle) / 2));
      for (let q = 1; q <= nA; q++) {
        const a = (arcAngle * q) / nA;
        // rotate the vector centre -> point by +sgn * a (same turning sense as the road)
        const vx = cx0 - cenx;
        const vz = cz0 - cenz;
        const ca = Math.cos(sgn * a);
        const sa = Math.sin(sgn * a);
        push(cenx + vx * ca - vz * sa, cenz + vx * sa + vz * ca, kappaMax);
      }
    }
    // second spiral: the mirror of the first, seen from ST backwards
    for (let q = nS - 1; q >= 0; q--) {
      const s = (Ls * q) / nS;
      const phi = (s * s) / (2 * R * Ls);
      const x = s * (1 - (phi * phi) / 10 + phi ** 4 / 216);
      const y = s * (phi / 3 - phi ** 3 / 42 + phi ** 5 / 1320);
      push(st[0] - tout[0] * x + nOut[0] * y, st[1] - tout[1] * x + nOut[1] * y, kappaMax * (s / Ls));
    }
    const Lc = 2 * Ls + R * Math.max(0, arcAngle);
    acc += Lc;
    last = st;
    curves.push({ x: P[0], z: P[1], delta: -v[i].d, R, Ls, Ts, s0, s1: s0 + Lc });
  }
  const end = v[v.length - 1].p;
  push(end[0], end[1], 0);

  // resample every `step` m by arc length
  let total = 0;
  const dcum: number[] = [0];
  for (let i = 1; i < dense.length; i++) {
    total += Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z);
    dcum.push(total);
  }
  const n = Math.max(2, Math.round(total / step));
  const ds = total / n;
  const xs = new Float64Array(n + 1);
  const zs = new Float64Array(n + 1);
  const kappa = new Float64Array(n + 1);
  const heading = new Float64Array(n + 1);
  const cum = new Float64Array(n + 1);
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const s = i * ds;
    while (j + 2 < dense.length && dcum[j + 1] < s) j++;
    const seg = dcum[j + 1] - dcum[j] || 1;
    const t = clamp((s - dcum[j]) / seg, 0, 1);
    xs[i] = dense[j].x + (dense[j + 1].x - dense[j].x) * t;
    zs[i] = dense[j].z + (dense[j + 1].z - dense[j].z) * t;
    kappa[i] = dense[j].k + (dense[j + 1].k - dense[j].k) * t;
    cum[i] = s;
  }
  for (let i = 0; i <= n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n, i + 1);
    heading[i] = Math.atan2(zs[b] - zs[a], xs[b] - xs[a]);
  }
  // curve table: stations of the curves on the resampled line are the dense ones (same arc length up to the tiny chord error)
  return { xs, zs, kappa, heading, cum, length: total, curves };
}

/**
 * FOLLOW MODE for the spokes that run along an ordinary highway: the expressway keeps the highway centre line (so its piers can stand on the
 * yellow line) wherever the highway is gentle enough, and only the bends sharper than `rMin` are eased (relaxGuide). No tangents are invented:
 * the road is exactly as straight as the highway is. A light 1-2-1 smoothing removes the small noise of the highway polyline.
 */
export function followAlignment(guide: readonly Pt[], opt: FitOptions = {}): Alignment {
  const rMin = opt.rMin ?? XD.rMin;
  const step = opt.step ?? 10;
  let p: Pt[] = resamplePath(guide, step);
  // ease the bends, smooth the noise, and look again: the radius is checked on 30 m chords (3 steps each side), the scale of a vehicle
  for (let round = 0; round < (opt.relax === false ? 0 : 6); round++) {
    p = relaxGuide(p, rMin * (1.04 + 0.04 * round), step);
    for (let pass = 0; pass < 2; pass++) {
      const q = p.map((v) => [v[0], v[1]] as Pt);
      for (let i = 1; i + 1 < p.length; i++) {
        q[i][0] = (p[i - 1][0] + 2 * p[i][0] + p[i + 1][0]) / 4;
        q[i][1] = (p[i - 1][1] + 2 * p[i][1] + p[i + 1][1]) / 4;
      }
      p = q;
    }
    let worst = 1e9;
    for (let i = 3; i + 3 < p.length; i++) worst = Math.min(worst, circleR(p[i - 3], p[i], p[i + 3]));
    if (worst >= rMin) break;
  }
  const n = p.length - 1;
  const xs = Float64Array.from(p, (v) => v[0]);
  const zs = Float64Array.from(p, (v) => v[1]);
  const cum = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  const heading = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n, i + 1);
    heading[i] = Math.atan2(zs[b] - zs[a], xs[b] - xs[a]);
  }
  const kappa = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const a = Math.max(0, i - 3);
    const b = Math.min(n, i + 3);
    kappa[i] = b > a ? -wrapAngle(heading[b] - heading[a]) / (cum[b] - cum[a]) : 0;
  }
  return { xs, zs, kappa, heading, cum, length: cum[n], curves: [] };
}
