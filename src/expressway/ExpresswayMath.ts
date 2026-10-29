/** Small 2D geometry helpers for the expressway (x east, z south). Pure numbers: no three.js. */

export type Pt = [number, number];

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (t: number): number => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};
/** Wrap an angle to (-pi, pi]. */
export const wrapAngle = (a: number): number => {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  else if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
};

/** Distance from point p to segment a-b, plus the parameter t (0..1) of the nearest point. */
export function pointSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const abx = bx - ax;
  const abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { d: Math.hypot(px - (ax + abx * t), pz - (az + abz * t)), t };
}

/** Do the segments a-b and c-d cross? If yes returns the parameters (t along a-b, u along c-d). */
export function segCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): { t: number; u: number } | null {
  const r1x = bx - ax;
  const r1z = bz - az;
  const r2x = dx - cx;
  const r2z = dz - cz;
  const den = r1x * r2z - r1z * r2x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * r2z - (cz - az) * r2x) / den;
  const u = ((cx - ax) * r1z - (cz - az) * r1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

/** Shortest distance between segments a-b and c-d (0 if they cross), plus the parameter u (0..1) on c-d where it happens. */
export function segSegDist(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): { d: number; u: number } {
  const x = segCross(ax, az, bx, bz, cx, cz, dx, dz);
  if (x) return { d: 0, u: x.u };
  let best = { d: Infinity, u: 0 };
  const p1 = pointSeg(ax, az, cx, cz, dx, dz);
  if (p1.d < best.d) best = { d: p1.d, u: p1.t };
  const p2 = pointSeg(bx, bz, cx, cz, dx, dz);
  if (p2.d < best.d) best = { d: p2.d, u: p2.t };
  const p3 = pointSeg(cx, cz, ax, az, bx, bz);
  if (p3.d < best.d) best = { d: p3.d, u: 0 };
  const p4 = pointSeg(dx, dz, ax, az, bx, bz);
  if (p4.d < best.d) best = { d: p4.d, u: 1 };
  return best;
}

/** Is point (px, pz) inside a rectangle centred (cx, cz), half sizes (hw along its local x, hd along local z), turned by yaw (rad)? `m` grows it. */
export function inObb(px: number, pz: number, cx: number, cz: number, hw: number, hd: number, yaw: number, m = 0): boolean {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const dx = px - cx;
  const dz = pz - cz;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= hw + m && Math.abs(lz) <= hd + m;
}

/** Distance from a point to an axis-aligned rectangle (0 inside). */
export function rectDist(px: number, pz: number, x0: number, z0: number, x1: number, z1: number): number {
  const dx = Math.max(x0 - px, 0, px - x1);
  const dz = Math.max(z0 - pz, 0, pz - z1);
  return Math.hypot(dx, dz);
}

/** Cell hash for segment indices: key of a 2D cell. */
export const cellKey = (cx: number, cz: number): number => (cx + 4096) * 8192 + (cz + 4096);

/** Unit left normal (x, z) of direction (dx, dz): looking along the direction, left = (dz, -dx) with x east and z south. */
export const leftNormal = (dx: number, dz: number): Pt => [dz, -dx];

/**
 * Hash of polyline segments (e.g. another expressway deck) for fast "does this cross-section line touch it?" queries.
 * `band` = half width of what the polyline stands for (m).
 */
export class PolyIndex {
  private cells = new Map<number, number[]>();
  private stamp: Int32Array;
  private n = 0;
  constructor(
    readonly xs: ArrayLike<number>,
    readonly zs: ArrayLike<number>,
    readonly ys: ArrayLike<number>,
    readonly band: number,
    private cell = 48,
  ) {
    const m = xs.length - 1;
    this.stamp = new Int32Array(Math.max(1, m));
    for (let i = 0; i < m; i++) {
      const x0 = Math.min(xs[i], xs[i + 1]) - band;
      const x1 = Math.max(xs[i], xs[i + 1]) + band;
      const z0 = Math.min(zs[i], zs[i + 1]) - band;
      const z1 = Math.max(zs[i], zs[i + 1]) + band;
      for (let cz = Math.floor(z0 / cell); cz <= Math.floor(z1 / cell); cz++) {
        for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
          const k = cellKey(cx, cz);
          const a = this.cells.get(k);
          if (a) a.push(i);
          else this.cells.set(k, [i]);
        }
      }
    }
  }

  /** Nearest approach of the segment a-b to the polyline: distance and the polyline height there (null if farther than `reach`). */
  query(ax: number, az: number, bx: number, bz: number, reach: number): { d: number; y: number; i: number; t: number } | null {
    let best: { d: number; y: number; i: number; t: number } | null = null;
    this.n++;
    const c = this.cell;
    for (let cz = Math.floor((Math.min(az, bz) - reach) / c); cz <= Math.floor((Math.max(az, bz) + reach) / c); cz++) {
      for (let cx = Math.floor((Math.min(ax, bx) - reach) / c); cx <= Math.floor((Math.max(ax, bx) + reach) / c); cx++) {
        const a = this.cells.get(cellKey(cx, cz));
        if (!a) continue;
        for (const i of a) {
          if (this.stamp[i] === this.n) continue;
          this.stamp[i] = this.n;
          const q = segSegDist(ax, az, bx, bz, this.xs[i], this.zs[i], this.xs[i + 1], this.zs[i + 1]);
          if (q.d <= reach && (!best || q.d < best.d)) best = { d: q.d, y: this.ys[i] + (this.ys[i + 1] - this.ys[i]) * q.u, i, t: q.u };
        }
      }
    }
    return best;
  }

  /** Distance from a point to the polyline (up to `reach`), or Infinity. */
  dist(px: number, pz: number, reach: number): number {
    const r = this.query(px, pz, px, pz, reach);
    return r ? r.d : Infinity;
  }
}
