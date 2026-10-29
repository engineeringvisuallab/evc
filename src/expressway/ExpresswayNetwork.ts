import { INTERCHANGES, ROUTE_PLANS, SYSTEM_JOINTS, type XKind, type XRoutePlan } from './ExpresswayPlan';
import { addServiceInterchange, addTerminal, type RampContext } from './ExpresswayRamps';
import { addSystemT } from './ExpresswaySystem';
import { ExpresswayRouter } from './ExpresswayRouter';
import { fitAlignment, followAlignment, resamplePath, type Alignment } from './ExpresswayAlign';
import { shiftCorridor } from './ExpresswayCorridor';
import { buildMainRoute, type DeckContext } from './ExpresswayDeck';
import { XWorld, type XAvoid, type XRoadLike, type XTerrain } from './ExpresswayWorld';
import type { XCushion, XInterchange, XLamp, XPier, XRoute, XScupper, XSign, XSpan } from './ExpresswayTypes';
import { makeFurniture } from './ExpresswayFurniture';
import { bake, unbake, worldSignature, type Baked } from './ExpresswayBake';
import { BAKED } from './ExpresswayBaked';
import type { Pt } from './ExpresswayMath';

export type { XRoadLike, XTerrain, XAvoid } from './ExpresswayWorld';
export type { XRoute, XPier, XSpan, XInterchange } from './ExpresswayTypes';
/** What the network needs from the world: the ground height. */
export interface XGround {
  heightAt(x: number, z: number): number;
}

/** A spoke is cut this far (m) before the ring: room for the directional T interchange. */
export const T_STANDOFF = 520;

/**
 * The expressway network: routes (main decks + ramps), piers, spans, interchanges and street furniture, all computed once from the real terrain,
 * roads, railway, rivers and buildings of the game. Deterministic: the same world gives the same network.
 */
export class ExpresswayNetwork {
  readonly routes: XRoute[] = [];
  readonly piers: XPier[] = [];
  readonly spans: XSpan[] = [];
  readonly interchanges: XInterchange[] = [];
  readonly cushions: XCushion[] = [];
  lamps: XLamp[] = [];
  scuppers: XScupper[] = [];
  signs: XSign[] = [];
  /** Problems found while building (tests / debug). */
  readonly issues: string[] = [];
  /** Not errors: remarks about the design. */
  readonly notes: string[] = [];
  private _world: XWorld | null = null;
  private readonly _terrain: XTerrain;
  private readonly _roads: readonly XRoadLike[];
  private readonly _avoid: readonly XAvoid[];
  /** World signature the design belongs to, and whether it was loaded from the baked data. */
  readonly signature: string;
  readonly fromBaked: boolean;
  /** Debug / test: never use the baked data. */
  static noBake = false;
  /** Debug: print the time of every build stage. */
  static timing = false;
  /** Guide lines before the alignment was fitted (debug / test): by route name. */
  readonly guides = new Map<string, Pt[]>();

  constructor(terrain: XTerrain, roads: readonly XRoadLike[], avoid: readonly XAvoid[] = []) {
    this._terrain = terrain;
    this._roads = roads;
    this._avoid = avoid;
    this.signature = worldSignature(terrain, roads);
    const baked = BAKED as Baked | null;
    this.fromBaked = !ExpresswayNetwork.noBake && !!baked && baked.sig === this.signature;
    if (this.fromBaked && baked) {
      const d = unbake(baked);
      this.routes.push(...d.routes);
      this.piers.push(...d.piers);
      this.spans.push(...d.spans);
      this.interchanges.push(...d.interchanges);
      this.cushions.push(...d.cushions);
      this.issues.push(...d.issues);
      this.notes.push(...d.notes);
      const fb = makeFurniture(this.routes);
      this.lamps = fb.lamps;
      this.scuppers = fb.scuppers;
      this.signs = fb.signs;
      return;
    }
    const T0 = performance.now();
    const lap = (what: string): void => {
      if (ExpresswayNetwork.timing) console.log(`  [${(performance.now() - T0).toFixed(0)} ms] ${what}`);
    };
    const world = new XWorld(terrain, roads, avoid);
    this._world = world;
    lap('world index');
    let router: ExpresswayRouter | null = null;
    const getRouter = (): ExpresswayRouter => (router ??= new ExpresswayRouter(terrain, avoid, (x, z) => world.keepOut(x, z, 40) !== null));
    const ctx: DeckContext = { world, others: [], piers: this.piers, spans: this.spans, issues: this.issues, notes: this.notes, nextId: () => this.routes.length };
    const highway = (name: string, rev: boolean): Pt[] => {
      const r = roads.find((q) => q.name === name);
      if (!r) throw new Error(`expressway: highway ${name} not found`);
      const pts: Pt[] = [];
      for (let i = 0; i < r.xs.length; i++) pts.push([r.xs[i], r.zs[i]]);
      return rev ? pts.reverse() : pts;
    };
    for (const plan of ROUTE_PLANS) {
      let al: Alignment;
      if (plan.mode === 'follow') {
        let guide: Pt[] = [];
        (plan.highways ?? []).forEach((name, k) => {
          for (const p of highway(name, !!plan.reverse?.[k])) guide.push(p);
        });
        if (plan.then) {
          const path = getRouter().route(plan.then, false, () => true);
          for (let i = 1; i < path.length; i++) guide.push(path[i]);
        }
        if (plan.joinsRing) guide = this.trimAtRing(guide, plan);
        guide = this.trimConflicts(guide);
        if (plan.clip) {
          const c = plan.clip;
          guide = guide.filter((p) => p[0] >= (c.x0 ?? -1e9) && p[0] <= (c.x1 ?? 1e9) && p[1] >= (c.z0 ?? -1e9) && p[1] <= (c.z1 ?? 1e9));
        }
        if (plan.stopShort) guide = guide.filter((p) => Math.hypot(p[0], p[1]) >= plan.stopShort!);
        this.guides.set(plan.name, guide);
        let sh = shiftCorridor(guide, world, { umax: 60, du: 2, fixEnds: 1 });
        al = followAlignment(sh.pts, { rMin: plan.rMin });
        for (let round = 0; round < 3; round++) {
          const cur: Pt[] = [];
          for (let i = 0; i < al.xs.length; i++) cur.push([al.xs[i], al.zs[i]]);
          sh = shiftCorridor(cur, world, { umax: 40, du: 1.5, fixEnds: 1 });
          if (!sh.hard) break;
          al = followAlignment(sh.pts, { rMin: plan.rMin });
        }
        for (let round = 0; round < 3 && sh.hard; round++) {
          // last nudge: tiny sideways steps on the finished line, no re-smoothing
          const cur: Pt[] = [];
          for (let i = 0; i < al.xs.length; i++) cur.push([al.xs[i], al.zs[i]]);
          sh = shiftCorridor(cur, world, { umax: 4, du: 0.25, fixEnds: 1 });
          al = followAlignment(sh.pts, { rMin: plan.rMin, relax: false });
        }
        if (sh.hard) this.notes.push(`${plan.name}: ${sh.hard} deck sample points still touch a building / station / plot after the sideways shift`);
      } else {
        // the waypoints are dense and were checked against hills, water, stations and facilities: use them as the guide (the router is only for open ground)
        const guide: Pt[] = plan.direct ? (plan.pts ?? []).map((p) => [p[0], p[1]] as Pt) : getRouter().route(plan.pts ?? [], false, () => true);
        this.guides.set(plan.name, guide);
        let pts: Pt[] = shiftCorridor(guide, world, plan.direct ? { umax: 45, du: 3, wDev: 0.4, fixEnds: 1 } : { umax: 150, du: 5, fixEnds: 1 }).pts;
        const tol = 25;
        // fit, then slide the fitted line off whatever it still touches, and fit again (the arcs cut corners)
        al = fitAlignment(pts, { tol, relax: !plan.direct });
        for (let round = 0; round < 3; round++) {
          const cur: Pt[] = [];
          for (let i = 0; i < al.xs.length; i++) cur.push([al.xs[i], al.zs[i]]);
          const sh = shiftCorridor(cur, world, { umax: 60, du: 2, fixEnds: 1 });
          if (!sh.hard) break;
          pts = sh.pts;
          // the line is smooth already: no corner fitting again (that would cut the arcs), just resample it
          al = followAlignment(pts, { relax: false });
        }
      }
      lap(`${plan.name} alignment`);
      const r = buildMainRoute(ctx, plan.name, plan.kind as XKind, al);
      lap(`${plan.name} deck`);
      this.routes.push(r);
      ctx.others.push(r);
    }
    // interchanges (ramps are added to `routes` too, after the main decks). Service interchanges and terminals first, then the directional T interchanges where a spoke / spur reaches the ring.
    const rctx: RampContext = Object.assign(ctx, { cushions: this.cushions, roads, ramps: this.routes, interchanges: this.interchanges });
    for (const ic of INTERCHANGES) {
      const parent = this.routes.find((q) => q.name === ic.route && q.kind !== 'ramp');
      if (!parent) continue;
      if (ic.kind === 'terminal') addTerminal(rctx, parent, ic.end ?? 'end', ic.n, ic.id);
      else addServiceInterchange(rctx, parent, ic, ic.n, ic.id);
      lap(`interchange ${ic.n}`);
    }
    // directional T interchanges where a spoke / spur reaches the ring
    {
      let k = 21;
      for (const sp of SYSTEM_JOINTS) {
        const stem = this.routes.find((q) => q.name === sp.route && q.kind !== 'ramp');
        if (!stem) continue;
        const e = sp.end === 'end' ? stem.xs.length - 1 : 0;
        let ringRoute: XRoute | null = null;
        let bd = Infinity;
        for (const q of this.routes) {
          if (q.kind !== 'ring') continue;
          for (let i = 0; i < q.xs.length; i += 2) {
            const d = Math.hypot(q.xs[i] - stem.xs[e], q.zs[i] - stem.zs[e]);
            if (d < bd) {
              bd = d;
              ringRoute = q;
            }
          }
        }
        if (ringRoute) addSystemT(rctx, stem, sp.end, ringRoute, k++, sp.id);
        lap(`system T ${sp.id}`);
      }
    }
    const fu = makeFurniture(this.routes);
    this.lamps = fu.lamps;
    this.scuppers = fu.scuppers;
    this.signs = fu.signs;
    lap('furniture');
  }

  /** Cut a spoke where it comes within `T_STANDOFF` of the ring (searching from the middle of the guide outward in both directions). */
  private trimAtRing(guide: Pt[], plan: XRoutePlan): Pt[] {
    const rings = this.routes.filter((r) => r.kind === 'ring');
    if (!rings.length) return guide;
    const rp = resamplePath(guide, 20);
    // the middle of the city: the guide point nearest the map centre
    let c = 0;
    let bd = Infinity;
    for (let i = 0; i < rp.length; i++) {
      const d = Math.hypot(rp[i][0], rp[i][1]);
      if (d < bd) {
        bd = d;
        c = i;
      }
    }
    const near = (p: Pt): number => {
      let m = Infinity;
      for (const ring of rings) for (let i = 0; i < ring.xs.length; i += 2) m = Math.min(m, Math.hypot(ring.xs[i] - p[0], ring.zs[i] - p[1]));
      return m;
    };
    let a = 0;
    for (let i = c; i >= 0; i--) {
      if (near(rp[i]) < T_STANDOFF) {
        a = Math.min(rp.length - 1, i + 1);
        break;
      }
    }
    let b = rp.length - 1;
    for (let i = c; i < rp.length; i++) {
      if (near(rp[i]) < T_STANDOFF) {
        b = Math.max(0, i - 1);
        break;
      }
    }
    this.notes.push(`${plan.name}: cut to ${(((b - a) * 20) / 1000).toFixed(1)} km, ${T_STANDOFF} m before the ring at both ends`);
    return rp.slice(a, b + 1);
  }

  /** Cut the ends of a guide while the deck there would stand on a building / station / plot (the T interchange moves a little way off the ring). */
  private trimConflicts(guide: Pt[]): Pt[] {
    const w = this.world;
    const bad = (p: Pt, q: Pt): boolean => {
      const h = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const nx = Math.sin(h);
      const nz = -Math.cos(h);
      for (const u of [-21.4, -10.7, 0, 10.7, 21.4]) if (w.keepOut(p[0] + nx * u, p[1] + nz * u, 0)) return true;
      return false;
    };
    const p = resamplePath(guide, 20);
    let a = 0;
    let b = p.length - 1;
    while (a < b - 2 && bad(p[a], p[a + 1])) a++;
    while (b > a + 2 && bad(p[b], p[b - 1])) b--;
    // leave a little room beyond the conflict
    a = Math.min(a + (a > 0 ? 3 : 0), b);
    b = Math.max(b - (b < p.length - 1 ? 3 : 0), a);
    return p.slice(a, b + 1);
  }

  /** The obstacle index (built on first use when the design was loaded from the baked data). */
  get world(): XWorld {
    return (this._world ??= new XWorld(this._terrain, this._roads, this._avoid));
  }

  /** The design as baked data (scripts/expressway-bake.ts). */
  toBaked(): Baked {
    return bake(this.signature, { routes: this.routes, piers: this.piers, spans: this.spans, interchanges: this.interchanges, cushions: this.cushions, issues: this.issues, notes: this.notes });
  }

  /** Total length of all deck (not ramps), km. */
  get deckKm(): number {
    return this.routes.filter((r) => r.kind !== 'ramp').reduce((a, r) => a + r.length, 0) / 1000;
  }
}
