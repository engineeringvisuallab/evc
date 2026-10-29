import type { Pt } from './ExpresswayMath';

/**
 * Shortest path of a car with a minimum turning radius R between two poses (x, z, heading): a Dubins path = a turn, a straight, a turn
 * (or three turns). Ramps are built from it, so a ramp can never be tighter than R. Map coordinates are x east, z SOUTH, heading = atan2(dz, dx);
 * the formulas below are for the usual x east / y NORTH frame, so z is mirrored (y = -z, heading -> -heading) on the way in and out.
 * A "left" turn here is a left turn on the map (counter-clockwise, seen from above).
 */

export interface DubinsPath {
  /** Total length (m). */
  length: number;
  /** Word, e.g. 'LSR', and the three segment lengths (m). */
  word: string;
  seg: [number, number, number];
  start: [number, number, number];
  R: number;
}

const TWO_PI = Math.PI * 2;
const mod2pi = (a: number): number => {
  const r = a % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
};

type Word = 'LSL' | 'RSR' | 'LSR' | 'RSL' | 'RLR' | 'LRL';

function solve(word: Word, a: number, b: number, d: number): [number, number, number] | null {
  const sa = Math.sin(a);
  const sb = Math.sin(b);
  const ca = Math.cos(a);
  const cb = Math.cos(b);
  const cab = Math.cos(a - b);
  switch (word) {
    case 'LSL': {
      const p2 = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
      if (p2 < 0) return null;
      const tmp = Math.atan2(cb - ca, d + sa - sb);
      return [mod2pi(-a + tmp), Math.sqrt(p2), mod2pi(b - tmp)];
    }
    case 'RSR': {
      const p2 = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
      if (p2 < 0) return null;
      const tmp = Math.atan2(ca - cb, d - sa + sb);
      return [mod2pi(a - tmp), Math.sqrt(p2), mod2pi(-b + tmp)];
    }
    case 'LSR': {
      const p2 = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
      if (p2 < 0) return null;
      const p = Math.sqrt(p2);
      const tmp = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p);
      return [mod2pi(-a + tmp), p, mod2pi(-mod2pi(b) + tmp)];
    }
    case 'RSL': {
      const p2 = d * d - 2 + 2 * cab - 2 * d * (sa + sb);
      if (p2 < 0) return null;
      const p = Math.sqrt(p2);
      const tmp = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p);
      return [mod2pi(a - tmp), p, mod2pi(b - tmp)];
    }
    case 'RLR': {
      const tmp = (6 - d * d + 2 * cab + 2 * d * (sa - sb)) / 8;
      if (Math.abs(tmp) > 1) return null;
      const p = mod2pi(TWO_PI - Math.acos(tmp));
      const t = mod2pi(a - Math.atan2(ca - cb, d - sa + sb) + mod2pi(p / 2));
      return [t, p, mod2pi(a - b - t + mod2pi(p))];
    }
    case 'LRL': {
      const tmp = (6 - d * d + 2 * cab + 2 * d * (-sa + sb)) / 8;
      if (Math.abs(tmp) > 1) return null;
      const p = mod2pi(TWO_PI - Math.acos(tmp));
      const t = mod2pi(-a - Math.atan2(ca - cb, d + sa - sb) + p / 2);
      return [t, p, mod2pi(mod2pi(b) - a - t + mod2pi(p))];
    }
  }
}

/** All Dubins words from pose 0 to pose 1 (in map coordinates), shortest first. */
export function dubinsPaths(x0: number, z0: number, h0: number, x1: number, z1: number, h1: number, R: number): DubinsPath[] {
  // mirror z -> y
  const y0 = -z0;
  const y1 = -z1;
  const p0 = -h0;
  const p1 = -h1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const D = Math.hypot(dx, dy);
  const d = D / R;
  const theta = mod2pi(Math.atan2(dy, dx));
  const a = mod2pi(p0 - theta);
  const b = mod2pi(p1 - theta);
  const out: DubinsPath[] = [];
  for (const w of ['LSL', 'RSR', 'LSR', 'RSL', 'RLR', 'LRL'] as Word[]) {
    const s = solve(w, a, b, d);
    if (!s) continue;
    out.push({ length: (s[0] + s[1] + s[2]) * R, word: w, seg: [s[0] * R, s[1] * R, s[2] * R], start: [x0, z0, h0], R });
  }
  return out.sort((p, q) => p.length - q.length);
}

/** Points along a Dubins path every `step` m (including both ends) and the signed curvature at each (+ = left turn on the map). */
export function sampleDubins(p: DubinsPath, step: number): { pts: Pt[]; kappa: number[]; heading: number[] } {
  const pts: Pt[] = [];
  const kappa: number[] = [];
  const heading: number[] = [];
  let [x, z, h] = p.start;
  const turn = (c: string): number => (c === 'L' ? -1 : 1); // map: a left turn DEcreases atan2(dz, dx) (z is south)
  const letters = p.word.split('');
  const push = (k: number): void => {
    pts.push([x, z]);
    kappa.push(k);
    heading.push(h);
  };
  push(letters[0] === 'S' ? 0 : -turn(letters[0]) * 0 + (letters[0] === 'L' ? 1 : -1) / p.R);
  for (let i = 0; i < 3; i++) {
    const L = p.seg[i];
    const c = letters[i];
    const n = Math.max(1, Math.ceil(L / step));
    const ds = L / n;
    for (let k = 0; k < n; k++) {
      if (c === 'S') {
        x += Math.cos(h) * ds;
        z += Math.sin(h) * ds;
      } else {
        // exact arc: heading changes by turn * ds / R
        const dh = (turn(c) * ds) / p.R;
        const hm = h + dh / 2;
        const chord = 2 * p.R * Math.sin(Math.abs(dh) / 2);
        x += Math.cos(hm) * chord;
        z += Math.sin(hm) * chord;
        h += dh;
      }
      push(c === 'S' ? 0 : c === 'L' ? 1 / p.R : -1 / p.R);
    }
  }
  return { pts, kappa, heading };
}
