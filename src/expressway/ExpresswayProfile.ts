import { XD } from './ExpresswayStandards';

/**
 * VERTICAL PROFILE: the lowest smooth grade line that stays above every lower bound (ground + embankment top, the clearance over a road /
 * railway / river) while obeying the design limits of AASHTO GB 3.4:
 *   - grade never steeper than `grade`,
 *   - crest curves no sharper than K = `kCrest` (L / A, m per % of grade change) and sag curves no sharper than K = `kSag`.
 * K is checked on the sampled line: the change of grade between two neighbouring segments (d m apart) may not exceed d / (100 K).
 *
 * The solver only ever RAISES the line (grade, sag and crest rules are all "lift this point"), so the result is the unique lowest line
 * that satisfies all of them; it never goes under a lower bound. A crest that is too sharp is eased by lifting its two shoulders,
 * which spreads the lift into a proper parabolic arch.
 */

export interface ProfileLimits {
  grade: number;
  kCrest: number;
  kSag: number;
}

export const MAIN_LIMITS: ProfileLimits = { grade: XD.maxGrade, kCrest: XD.kCrest, kSag: XD.kSag };
export const RAMP_LIMITS: ProfileLimits = { grade: XD.rampMaxGrade, kCrest: XD.rampKCrest, kSag: XD.rampKSag };

/**
 * `ymin[i]` = lower bound at station i, `cum[i]` = distance along the line. `fixedLow` (optional, per station): the line may not be higher than
 * this + the grade cone (used by the caller to pin an end to the ground); stations without one pass NaN.
 * Returns the profile (a new array).
 */
export function solveProfile(ymin: Float64Array, cum: Float64Array, lim: ProfileLimits, maxIter = 4000): Float64Array {
  const n = ymin.length;
  const y = Float64Array.from(ymin);
  if (n < 3) return y;
  const d = new Float64Array(n); // d[i] = distance between i-1 and i
  for (let i = 1; i < n; i++) d[i] = Math.max(1e-6, cum[i] - cum[i - 1]);
  for (let it = 0; it < maxIter; it++) {
    let changed = false;
    // grade: forward and backward
    for (let i = 1; i < n; i++) {
      const lo = y[i - 1] - lim.grade * d[i];
      if (y[i] < lo - 1e-9) {
        y[i] = lo;
        changed = true;
      }
    }
    for (let i = n - 2; i >= 0; i--) {
      const lo = y[i + 1] - lim.grade * d[i + 1];
      if (y[i] < lo - 1e-9) {
        y[i] = lo;
        changed = true;
      }
    }
    // vertical curvature
    for (let i = 1; i + 1 < n; i++) {
      const g0 = (y[i] - y[i - 1]) / d[i];
      const g1 = (y[i + 1] - y[i]) / d[i + 1];
      const dg = g1 - g0; // > 0 sag, < 0 crest
      const dm = (d[i] + d[i + 1]) / 2;
      const k = 1 / d[i] + 1 / d[i + 1];
      if (dg > 0) {
        const limit = dm / (100 * lim.kSag);
        if (dg > limit + 1e-9) {
          y[i] += (dg - limit) / k; // lift the bottom of the sag
          changed = true;
        }
      } else if (dg < 0) {
        const limit = dm / (100 * lim.kCrest);
        if (-dg > limit + 1e-9) {
          // lift the LOWER shoulder only (the higher one is the crest we must clear: raising it would only push the whole arch up)
          const excess = -dg - limit;
          if (y[i - 1] <= y[i + 1]) y[i - 1] += excess * d[i];
          else y[i + 1] += excess * d[i + 1];
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return y;
}

/** Largest |grade| (rise / run) of a profile. */
export function maxGradeOf(y: ArrayLike<number>, cum: ArrayLike<number>): number {
  let m = 0;
  for (let i = 1; i < y.length; i++) m = Math.max(m, Math.abs(y[i] - y[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]));
  return m;
}

/** Smallest K (m per %) over the sampled line, separately for crests and sags (Infinity = none). */
export function minKOf(y: ArrayLike<number>, cum: ArrayLike<number>): { crest: number; sag: number } {
  let crest = Infinity;
  let sag = Infinity;
  for (let i = 1; i + 1 < y.length; i++) {
    const d0 = cum[i] - cum[i - 1];
    const d1 = cum[i + 1] - cum[i];
    const g0 = (y[i] - y[i - 1]) / d0;
    const g1 = (y[i + 1] - y[i]) / d1;
    const dgPct = (g1 - g0) * 100;
    const L = (d0 + d1) / 2;
    if (dgPct > 1e-6) sag = Math.min(sag, L / dgPct);
    else if (dgPct < -1e-6) crest = Math.min(crest, L / -dgPct);
  }
  return { crest, sag };
}
