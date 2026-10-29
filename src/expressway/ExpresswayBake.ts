import type { XCushion, XInterchange, XPier, XRampInfo, XRoute, XSpan } from './ExpresswayTypes';
import type { XRoadLike, XTerrain } from './ExpresswayWorld';

/**
 * BAKED DESIGN. Designing the network (alignment fitting, corridor shifting, profile solving, 800 pier layouts, ramp path searches) takes seconds, far more than a game
 * should spend at start-up. The design is therefore done once, by `npm run bake:expressway` (scripts/expressway-bake.ts), and written to ExpresswayBaked.ts as plain numbers.
 * The game loads that. It is only used when the world it was designed for is the world being played: a signature of the terrain heights, the roads and the railway
 * is stored with it; if the signature differs (somebody changed the terrain, the roads or the rail) the network is designed again at start-up (slow but correct).
 * scripts/expressway-test.ts checks that the baked data and a fresh design agree.
 */

export const BAKE_VERSION = 'x1';

/** A short fingerprint of the world the expressway is designed for. */
export function worldSignature(terrain: XTerrain, roads: readonly XRoadLike[]): string {
  let pts = 0;
  let len = 0;
  for (const r of roads) {
    pts += r.xs.length;
    for (let i = 1; i < r.xs.length; i += 7) len += Math.abs(r.xs[i] - r.xs[i - 1]) + Math.abs(r.zs[i] - r.zs[i - 1]);
  }
  let h = 0;
  for (const [x, z] of [[0, 0], [1234, -2345], [-2345, 1234], [2700, 300], [-1500, -2500], [400, 3000], [-3000, -500], [900, -3800]]) h += terrain.heightAt(x, z);
  const rail = terrain.rail ? `${terrain.rail.edges.length}.${terrain.rail.piers.length}.${terrain.rail.stations.length}` : '0';
  return `${BAKE_VERSION}|${roads.length}.${pts}.${Math.round(len)}|${h.toFixed(2)}|${rail}`;
}

/* ------------------------------------------------------------------ base64 of typed arrays */

function toB64(a: Float32Array | Float64Array | Uint8Array): string {
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, Math.min(u.length, i + 0x8000)));
  return btoa(s);
}
function fromB64(b: string): ArrayBuffer {
  const s = atob(b);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}
const f64 = (b: string): Float64Array => new Float64Array(fromB64(b));
const f32 = (b: string): Float32Array => new Float32Array(fromB64(b));
const u8 = (b: string): Uint8Array => new Uint8Array(fromB64(b));

/* ------------------------------------------------------------------------------- routes */

interface RouteData {
  id: number;
  name: string;
  kind: string;
  main: boolean;
  lanes: number;
  halfWidth: number;
  step: number;
  label?: string;
  ramp?: XRampInfo;
  n: number;
  xs: string;
  zs: string;
  f32: string; // ys, ground, gc, cum, heading, kappa, e, cl, cr, girder, wl, wr (12 x n)
  u8: string; // viaduct, openL, openR (3 x n)
}
const F32_FIELDS = ['ys', 'ground', 'gc', 'cum', 'heading', 'kappa', 'e', 'cl', 'cr', 'girder', 'wl', 'wr'] as const;

function packRoute(r: XRoute): RouteData {
  const n = r.xs.length;
  const a = new Float32Array(F32_FIELDS.length * n);
  F32_FIELDS.forEach((f, k) => a.set(r[f], k * n));
  const b = new Uint8Array(3 * n);
  b.set(r.viaduct, 0);
  b.set(r.openL, n);
  b.set(r.openR, 2 * n);
  return { id: r.id, name: r.name, kind: r.kind, main: r.main, lanes: r.lanes, halfWidth: r.halfWidth, step: r.step, label: r.label, ramp: r.ramp, n, xs: toB64(r.xs), zs: toB64(r.zs), f32: toB64(a), u8: toB64(b) };
}

function unpackRoute(d: RouteData): XRoute {
  const n = d.n;
  const a = f32(d.f32);
  const b = u8(d.u8);
  const get = (k: number): Float64Array => Float64Array.from(a.subarray(k * n, (k + 1) * n));
  const xs = f64(d.xs);
  const zs = f64(d.zs);
  const cum = get(3);
  return {
    id: d.id,
    name: d.name,
    kind: d.kind as XRoute['kind'],
    closed: false,
    main: d.main,
    lanes: d.lanes,
    halfWidth: d.halfWidth,
    step: d.step,
    xs,
    zs,
    ys: get(0),
    ground: get(1),
    gc: get(2),
    cum,
    length: cum[n - 1],
    heading: get(4),
    kappa: get(5),
    e: get(6),
    cl: get(7),
    cr: get(8),
    girder: get(9),
    viaduct: b.slice(0, n),
    wl: get(10),
    wr: get(11),
    openL: b.slice(n, 2 * n),
    openR: b.slice(2 * n, 3 * n),
    ramp: d.ramp,
    label: d.label,
  };
}

/* -------------------------------------------------------------------------------- piers */

const PIER_KINDS: XPier['kind'][] = ['single', 'median', 'portal', 'ramp', 'abutment'];
const PIER_W = 25; // numbers per pier

function packPiers(piers: readonly XPier[]): string {
  const a = new Float64Array(piers.length * PIER_W);
  piers.forEach((p, i) => {
    const o = i * PIER_W;
    a.set([p.routeId, p.s, p.dx, p.dz, p.x, p.z, PIER_KINDS.indexOf(p.kind), p.cols.length, p.cols[0].x, p.cols[0].z, p.cols[1]?.x ?? 0, p.cols[1]?.z ?? 0, p.b, p.t, p.capTop, p.capDepth, p.capHalf, p.roll, p.bottom, p.ground, p.spanA, p.spanB, p.deckY], o);
  });
  return toB64(a);
}
function unpackPiers(b: string): XPier[] {
  const a = f64(b);
  const out: XPier[] = [];
  for (let o = 0; o + PIER_W <= a.length; o += PIER_W) {
    const cols = [{ x: a[o + 8], z: a[o + 9] }];
    if (a[o + 7] > 1) cols.push({ x: a[o + 10], z: a[o + 11] });
    out.push({ routeId: a[o], s: a[o + 1], dx: a[o + 2], dz: a[o + 3], x: a[o + 4], z: a[o + 5], kind: PIER_KINDS[a[o + 6]], cols, b: a[o + 12], t: a[o + 13], capTop: a[o + 14], capDepth: a[o + 15], capHalf: a[o + 16], roll: a[o + 17], bottom: a[o + 18], ground: a[o + 19], spanA: a[o + 20], spanB: a[o + 21], deckY: a[o + 22] });
  }
  return out;
}

/* ---------------------------------------------------------------------------- everything */

export interface Baked {
  sig: string;
  routes: RouteData[];
  piers: string;
  spans: XSpan[];
  interchanges: XInterchange[];
  cushions: XCushion[];
  issues: string[];
  notes: string[];
}

export interface Design {
  routes: XRoute[];
  piers: XPier[];
  spans: XSpan[];
  interchanges: XInterchange[];
  cushions: XCushion[];
  issues: string[];
  notes: string[];
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
export function bake(sig: string, d: Design): Baked {
  return {
    sig,
    routes: d.routes.map(packRoute),
    piers: packPiers(d.piers),
    spans: d.spans.map((s) => ({ ...s, s0: r3(s.s0), s1: r3(s.s1), length: r3(s.length), depth: r3(s.depth) })),
    interchanges: d.interchanges,
    cushions: d.cushions.map((c) => ({ ...c, x: r3(c.x), z: r3(c.z), y: r3(c.y), dx: r3(c.dx), dz: r3(c.dz) })),
    issues: d.issues,
    notes: d.notes,
  };
}
export function unbake(b: Baked): Design {
  return { routes: b.routes.map(unpackRoute), piers: unpackPiers(b.piers), spans: b.spans, interchanges: b.interchanges, cushions: b.cushions, issues: b.issues, notes: b.notes };
}
