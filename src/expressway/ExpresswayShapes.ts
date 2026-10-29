import { CARRIAGEWAY_W, DECK_HALF, LANE_START, XD } from './ExpresswayStandards';
import type { XCushion, XLamp, XPier, XRoute, XScupper, XSign } from './ExpresswayTypes';

/**
 * Every visible / solid part of the expressway as a plain list of oriented boxes (pure numbers, no three.js), so the renderer
 * (InstancedMesh), the physics (Rapier cuboids) and the test all read the SAME geometry.
 * A box: centre (cx, cy, cz), rotation quaternion (qx, qy, qz, qw), full size (sx, sy, sz) along its own x, y, z.
 * x east, y up, z south. A route segment is built from its own forward direction, so grades, banking (superelevation) and the 2 % crown are real.
 */

export type BoxKind = 'concrete' | 'asphalt' | 'paint' | 'dark' | 'sign' | 'lamp' | 'warning' | 'steel';

export interface Box {
  kind: BoxKind;
  cx: number;
  cy: number;
  cz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  sx: number;
  sy: number;
  sz: number;
  /** Gets a physics collider (the player can drive on it / hit it). */
  solid: boolean;
}

type V3 = [number, number, number];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Quaternion of the rotation whose columns are (ax, ay, az). */
export function quatFromBasis(ax: V3, ay: V3, az: V3): [number, number, number, number] {
  const m00 = ax[0];
  const m10 = ax[1];
  const m20 = ax[2];
  const m01 = ay[0];
  const m11 = ay[1];
  const m21 = ay[2];
  const m02 = az[0];
  const m12 = az[1];
  const m22 = az[2];
  const tr = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return [x, y, z, w];
}

/** The frame of a forward direction d: ax = the LEFT of travel, ay = up-ish, az = forward (same as roads/BridgeGeometry.basisFromDirection). */
export function frameOf(d: V3): { ax: V3; ay: V3; az: V3 } {
  const az = norm(d);
  const ax = norm([az[2], 0, -az[0]]);
  const ay = cross(az, ax);
  return { ax, ay, az };
}

/** Rotate (ax, ay) about az by phi. */
function tilt(f: { ax: V3; ay: V3; az: V3 }, phi: number): { ax: V3; ay: V3; az: V3 } {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return {
    ax: [f.ax[0] * c + f.ay[0] * s, f.ax[1] * c + f.ay[1] * s, f.ax[2] * c + f.ay[2] * s],
    ay: [f.ay[0] * c - f.ax[0] * s, f.ay[1] * c - f.ax[1] * s, f.ay[2] * c - f.ax[2] * s],
    az: f.az,
  };
}

function box(kind: BoxKind, c: V3, f: { ax: V3; ay: V3; az: V3 }, sx: number, sy: number, sz: number, solid = false): Box {
  const q = quatFromBasis(f.ax, f.ay, f.az);
  return { kind, cx: c[0], cy: c[1], cz: c[2], qx: q[0], qy: q[1], qz: q[2], qw: q[3], sx, sy, sz, solid };
}

const add = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Parts of segment i -> i+1 of a route. */
export function segmentBoxes(r: XRoute, i: number, out: Box[] = []): Box[] {
  const j = i + 1;
  const a: V3 = [r.xs[i], r.ys[i], r.zs[i]];
  const b: V3 = [r.xs[j], r.ys[j], r.zs[j]];
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  const L = len + 0.1;
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const f = frameOf(d);
  const fill = !r.viaduct[i] && !r.viaduct[j];
  const girder = Math.max(r.girder[i], r.girder[j]);
  const gc = (r.gc[i] + r.gc[j]) / 2;
  const cl = (r.cl[i] + r.cl[j]) / 2;
  const cr = (r.cr[i] + r.cr[j]) / 2;
  const open: [number, number] = [Math.max(r.openL[i], r.openL[j]), Math.max(r.openR[i], r.openR[j])];
  const widen: [number, number] = [(r.wl[i] + r.wl[j]) / 2, (r.wr[i] + r.wr[j]) / 2];

  const carriageway = (side: 1 | -1, m0: number, w: number, slope: number, sideOpen: number): void => {
    const phi = side > 0 ? -Math.atan(slope) : Math.atan(slope);
    const t = tilt(f, phi);
    const outward: V3 = side > 0 ? t.ax : [-t.ax[0], -t.ax[1], -t.ax[2]];
    const base = add(mid, f.ax, side * m0); // pivot edge of the carriageway
    const at = (u: number, up: number): V3 => add(add(base, outward, u), t.ay, up);
    const ts = { ax: t.ax, ay: t.ay, az: f.az };
    const T = XD.slab;
    if (fill) {
      // retained fill: from 2.5 m under the ground at the centre to the underside of the slab
      const H = Math.max(0.6, mid[1] - (gc - 2.5) - XD.asphalt);
      out.push(box('concrete', at(w / 2, -XD.asphalt - H / 2), ts, w, H, L, true));
    } else {
      out.push(box('concrete', at(w / 2, -XD.asphalt - T / 2), ts, w, T, L, true));
      if (girder > 0) out.push(box('concrete', at(w / 2, -XD.asphalt - T - girder / 2), ts, w * 0.6, girder, L, false));
    }
    out.push(box('asphalt', at(w / 2, -XD.asphalt / 2), ts, w - 0.5, XD.asphalt, L, false));
    if (!sideOpen) out.push(box('concrete', at(w - XD.parapetW / 2, XD.parapetH / 2), ts, XD.parapetW, XD.parapetH, L, true));
    // lane paint: solid edge lines, dashed lane lines (the aux lane of a ramp widens the carriageway)
    const aux = Math.max(0, w - CARRIAGEWAY_W);
    const laneIn = XD.innerShoulder;
    const dash = Math.min(3, len * 0.3);
    out.push(box('paint', at(laneIn, 0.02), ts, 0.16, 0.04, L, false));
    for (let k = 1; k < XD.lanes; k++) out.push(box('paint', at(laneIn + k * XD.laneW, 0.02), ts, 0.14, 0.04, dash, false));
    if (aux > 0.5) {
      out.push(box('paint', at(laneIn + XD.lanes * XD.laneW, 0.02), ts, 0.14, 0.04, dash, false));
      out.push(box('paint', at(laneIn + XD.lanes * XD.laneW + aux, 0.02), ts, 0.16, 0.04, L, false));
    } else out.push(box('paint', at(laneIn + XD.lanes * XD.laneW, 0.02), ts, 0.16, 0.04, L, false));
  };

  if (r.main) {
    carriageway(1, XD.medianHalf, CARRIAGEWAY_W + widen[0], cl, open[0]);
    carriageway(-1, XD.medianHalf, CARRIAGEWAY_W + widen[1], cr, open[1]);
    const phi = -Math.atan((cl - cr) / 2);
    const tm = tilt(f, phi);
    const c = add(mid, tm.ay, XD.medianH / 2);
    out.push(box('concrete', c, tm, XD.medianHalf * 2, XD.medianH, L, true));
  } else {
    // one plane: bank = cl (falls to the left)
    const phi = -Math.atan(cl);
    const t = tilt(f, phi);
    const w = r.halfWidth * 2;
    const at = (u: number, up: number): V3 => add(add(mid, t.ax, u), t.ay, up);
    const ts = { ax: t.ax, ay: t.ay, az: f.az };
    const T = 0.25;
    if (fill) {
      const H = Math.max(0.6, mid[1] - (gc - 2.0) - XD.asphalt);
      out.push(box('concrete', at(0, -XD.asphalt - H / 2), ts, w, H, L, true));
    } else {
      out.push(box('concrete', at(0, -XD.asphalt - T / 2), ts, w, T, L, true));
      if (girder > 0) out.push(box('concrete', at(0, -XD.asphalt - T - girder / 2), ts, w * 0.6, girder, L, false));
    }
    out.push(box('asphalt', at(0, -XD.asphalt / 2), ts, w - 0.5, XD.asphalt, L, false));
    for (const side of [1, -1]) {
      if (!(side > 0 ? open[0] : open[1])) out.push(box('concrete', at(side * (r.halfWidth - XD.parapetW / 2), XD.parapetH / 2), ts, XD.parapetW, XD.parapetH, L, true));
      out.push(box('paint', at(side * (r.halfWidth - 1.0), 0.02), ts, 0.14, 0.04, L, false));
    }
    if (r.lanes > 1) out.push(box('paint', at(0, 0.02), ts, 0.14, 0.04, Math.min(3, len * 0.3), false));
  }
  return out;
}

/** Parts of one pier: columns, cap beam (hammerhead), abutment wall, expansion joint on the deck. */
export function pierBoxes(p: XPier, out: Box[] = []): Box[] {
  const f = frameOf([p.dx, 0, p.dz]);
  const capBottom = p.capTop - p.capDepth;
  const H = Math.max(0.4, capBottom - p.bottom);
  for (const c of p.cols) out.push(box('concrete', [c.x, p.bottom + H / 2, c.z], f, p.b, H, p.t, true));
  const cx = p.x;
  const cz = p.z;
  if (p.kind === 'abutment') {
    // an end wall of the retained fill / the deck end: full width, from the foundation up to the cap
    out.push(box('concrete', [cx, p.bottom + (p.capTop - p.bottom) / 2, cz], f, p.capHalf * 2, p.capTop - p.bottom, 1.2, true));
  } else {
    out.push(box('concrete', [cx, p.capTop - p.capDepth / 2, cz], f, p.capHalf * 2, p.capDepth, p.t + 0.6, true));
  }
  // expansion joint across the deck (a dark strip level with the road)
  out.push(box('dark', [cx, p.deckY + 0.015, cz], f, p.capHalf * 2 - 1, 0.04, 0.3, false));
  return out;
}

export function lampBoxes(l: XLamp, out: Box[] = []): Box[] {
  const f = frameOf([l.ax, 0, l.az]); // z along the arm direction (across the deck)
  out.push(box('steel', [l.x, l.y + 4.5, l.z], f, 0.25, 9, 0.25, false));
  for (const s of [1, -1]) {
    const px = l.x + l.ax * 1.6 * s;
    const pz = l.z + l.az * 1.6 * s;
    out.push(box('steel', [px, l.y + 9.0, pz], { ax: f.ax, ay: f.ay, az: f.az }, 0.15, 0.15, 3.4, false));
    out.push(box('lamp', [l.x + l.ax * 3.2 * s, l.y + 8.85, l.z + l.az * 3.2 * s], f, 0.4, 0.15, 0.7, false));
  }
  return out;
}

export function signBoxes(s: XSign, out: Box[] = []): Box[] {
  const f = frameOf([s.dx, 0, s.dz]);
  const nx = s.dz;
  const nz = -s.dx;
  for (const sg of [1, -1]) out.push(box('steel', [s.x + nx * s.half * sg, s.y + 3.6, s.z + nz * s.half * sg], f, 0.45, 7.2, 0.45, false));
  out.push(box('steel', [s.x, s.y + 7.0, s.z], f, s.half * 2, 0.5, 0.5, false));
  out.push(box('sign', [s.x, s.y + 5.8, s.z], f, s.half * 2 - 1.2, 2.4, 0.12, false));
  // countdown bars: 1, 2, 3 for 1000 / 500 / 250 m
  const bars = s.dist >= 1000 ? 1 : s.dist >= 500 ? 2 : 3;
  for (let k = 0; k < bars; k++) out.push(box('paint', [s.x + nx * (-2 + k * 1.4), s.y + 5.8, s.z + nz * (-2 + k * 1.4) + 0.0], f, 0.5, 1.8, 0.14, false));
  return out;
}

export function scupperBox(s: XScupper, out: Box[] = []): Box[] {
  out.push(box('dark', [s.x, s.y, s.z], { ax: [1, 0, 0], ay: [0, 1, 0], az: [0, 0, 1] }, 0.4, 0.35, 0.4, false));
  return out;
}

export function cushionBox(c: XCushion, out: Box[] = []): Box[] {
  const f = frameOf([c.dx, 0, c.dz]);
  out.push(box('warning', [c.x, c.y + 0.5, c.z], f, 1.6, 1.0, 4.0, true));
  return out;
}

/** Safe lateral edge (m) of the main deck without any widening: used by the tests. */
export const MAIN_EDGE = DECK_HALF;
export const MAIN_LANE_START = LANE_START;
