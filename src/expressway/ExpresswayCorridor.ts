import { DECK_HALF } from './ExpresswayStandards';
import { resamplePath } from './ExpresswayAlign';
import type { Pt } from './ExpresswayMath';
import type { XWorld } from './ExpresswayWorld';

/**
 * CORRIDOR SHIFT: slide a guide line sideways, a few metres at a time, so the 42.8 m wide deck does not touch a building, a station, a plot,
 * a facility ... (hard conflicts) and, as far as it can, not an engineering area or a building-pad skirt (soft conflicts). A dynamic program
 * over (station, lateral offset): cost = small penalty for leaving the guide + large penalty for every conflicting sample point under the deck
 * + a smoothness penalty on the change of offset (the offset may change by at most one step per station, so the line stays gentle).
 * The two ends keep their offset 0. Returns the shifted points (same 20 m spacing).
 */

const CELL = 1;

export interface CorridorOptions {
  /** Largest sideways shift (m) and the step (m) between candidate offsets. */
  umax: number;
  du: number;
  /** Penalty per unit squared offset. */
  wDev?: number;
  /** Sample spacing along the line (m). */
  step?: number;
  /** Keep the first / last `fixEnds` stations at offset 0. */
  fixEnds?: number;
}

export function shiftCorridor(guide: readonly Pt[], world: XWorld, opt: CorridorOptions): { pts: Pt[]; hard: number; soft: number; moved: number } {
  const step = opt.step ?? 20;
  const p = resamplePath(guide, step);
  const n = p.length;
  const M = Math.floor(opt.umax / opt.du) * 2 + 1;
  const mid = (M - 1) >> 1;
  const wDev = opt.wDev ?? 0.02;
  const fix = opt.fixEnds ?? 1;
  const nx = new Float64Array(n);
  const nz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = p[Math.max(0, i - 1)];
    const b = p[Math.min(n - 1, i + 1)];
    const h = Math.atan2(b[1] - a[1], b[0] - a[0]);
    nx[i] = Math.sin(h);
    nz[i] = -Math.cos(h);
  }
  const memo = new Map<number, number>();
  // coarse test first: a station whose neighbourhood (the whole sideways range + the deck) holds no obstacle needs no per-offset evaluation
  const COARSE = 24;
  const coarse = new Map<number, number>();
  const coarseHit = (x: number, z: number): boolean => {
    const cx = Math.floor(x / COARSE);
    const cz = Math.floor(z / COARSE);
    const k = (cx + 4096) * 8192 + (cz + 4096);
    let v = coarse.get(k);
    if (v === undefined) {
      const px = (cx + 0.5) * COARSE;
      const pz = (cz + 0.5) * COARSE;
      v = world.keepOut(px, pz, COARSE * 0.71) || world.softOut(px, pz, COARSE * 0.71) || world.isWet(px, pz) ? 1 : 0;
      coarse.set(k, v);
    }
    return v === 1;
  };
  const roadNear = new Uint8Array(n);
  const near = new Uint8Array(n);
  const reach = opt.umax + DECK_HALF + 2;
  for (let i = 0; i < n; i++) {
    if (world.nearestRoad(p[i][0], p[i][1], opt.umax + 16)) roadNear[i] = 1;
    const steps = Math.ceil(reach / COARSE);
    outer: for (let a = -steps; a <= steps; a++) {
      if (coarseHit(p[i][0] + nx[i] * a * COARSE, p[i][1] + nz[i] * a * COARSE)) {
        near[i] = 1;
        break outer;
      }
    }
  }
  // soft conflicts (engineering areas, pad skirts, water) are tested on the coarse grid only; hard ones on a 1 m grid (a plot edge is a hard line)
  const softMemo = new Map<number, number>();
  const SOFT = 12;
  const softAt = (x: number, z: number): number => {
    const cx = Math.floor(x / SOFT);
    const cz = Math.floor(z / SOFT);
    const k = (cx + 4096) * 8192 + (cz + 4096);
    let v = softMemo.get(k);
    if (v === undefined) {
      const px = (cx + 0.5) * SOFT;
      const pz = (cz + 0.5) * SOFT;
      v = world.softOut(px, pz, 0) || world.isWet(px, pz) ? 1 : 0;
      softMemo.set(k, v);
    }
    return v;
  };
  const cellOf = (x: number, z: number): number => {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const k = (cx + 4096) * 8192 + (cz + 4096);
    let v = memo.get(k);
    if (v === undefined) {
      v = world.keepOut((cx + 0.5) * CELL, (cz + 0.5) * CELL, 1.0) ? 2 : 0;
      memo.set(k, v);
    }
    return v === 2 ? 2 : softAt(x, z);
  };
  const offs = [-DECK_HALF, -14.3, -7.1, 0, 7.1, 14.3, DECK_HALF];
  const cost = (i: number, j: number): { c: number; hard: number; soft: number } => {
    const u = (j - mid) * opt.du;
    let road = 0;
    if (roadNear[i]) {
      // a column on the centre line must not stand on a road (a highway's yellow line is the one exception): hugging a road for long is what forces portal piers
      const q = world.nearestRoad(p[i][0] + nx[i] * u, p[i][1] + nz[i] * u, 14);
      if (q && !(q.road.tier === 1 && q.d <= 1.5)) road = q.d < q.road.halfWidth + q.road.shoulder + 3.5 ? 6 : 0;
    }
    // a column on the centre line may not stand in a fenced engineering area: keep the centre line out of it
    const cx = p[i][0] + nx[i] * u;
    const cz = p[i][1] + nz[i] * u;
    if (roadNear[i] || near[i]) {
      if (world.softOut(cx, cz, 6)?.startsWith('eng')) road += 400;
    }
    if (!near[i]) return { c: wDev * u * u + road, hard: 0, soft: 0 };
    let hard = 0;
    let soft = 0;
    for (const d of offs) {
      const v = cellOf(p[i][0] + nx[i] * (u + d), p[i][1] + nz[i] * (u + d));
      if (v === 2) hard++;
      else if (v === 1) soft++;
    }
    return { c: wDev * u * u + road + hard * 400 + soft * 3, hard, soft };
  };
  const best = new Float64Array(n * M).fill(Infinity);
  const from = new Int16Array(n * M).fill(-1);
  for (let j = 0; j < M; j++) if (j === mid || fix === 0) best[j] = cost(0, j).c + (j === mid ? 0 : 1e9);
  best[mid] = cost(0, mid).c;
  for (let i = 1; i < n; i++) {
    const pinned = i < fix || i >= n - fix;
    for (let j = 0; j < M; j++) {
      if (pinned && j !== mid) continue;
      const own = cost(i, j).c;
      let bc = Infinity;
      let bj = -1;
      for (let dj = -1; dj <= 1; dj++) {
        const k = j + dj;
        if (k < 0 || k >= M) continue;
        const b = best[(i - 1) * M + k];
        if (b === Infinity) continue;
        const c = b + (dj ? 1.5 : 0);
        if (c < bc) {
          bc = c;
          bj = k;
        }
      }
      if (bj >= 0) {
        best[i * M + j] = bc + own;
        from[i * M + j] = bj;
      }
    }
  }
  let j = mid;
  const js = new Int16Array(n);
  js[n - 1] = mid;
  for (let i = n - 1; i > 0; i--) {
    js[i] = j;
    j = from[i * M + j];
    if (j < 0) j = mid;
  }
  js[0] = mid;
  // light smoothing of the offsets so the guide has no steps
  const u = new Float64Array(n);
  for (let i = 0; i < n; i++) u[i] = (js[i] - mid) * opt.du;
  for (let pass = 0; pass < 3; pass++) for (let i = 1; i + 1 < n; i++) u[i] = (u[i - 1] + 2 * u[i] + u[i + 1]) / 4;
  const out: Pt[] = [];
  let hard = 0;
  let soft = 0;
  let moved = 0;
  for (let i = 0; i < n; i++) {
    out.push([p[i][0] + nx[i] * u[i], p[i][1] + nz[i] * u[i]]);
    if (Math.abs(u[i]) > 0.5) moved++;
    // count on the final line
    for (const d of offs) {
      const v = cellOf(out[i][0] + nx[i] * d, out[i][1] + nz[i] * d);
      if (v === 2) hard++;
      else if (v === 1) soft++;
    }
  }
  return { pts: out, hard, soft, moved };
}
