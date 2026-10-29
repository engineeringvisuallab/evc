import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { PhysicsConfig } from '../physics/PhysicsConfig';
import type { FloatingOrigin } from '../world/FloatingOrigin';
import type { ExpresswayNetwork } from './ExpresswayNetwork';
import type { XRoute } from './ExpresswayTypes';
import { cushionBox, pierBoxes, segmentBoxes, type Box } from './ExpresswayShapes';

interface Piece {
  id: number;
  route: XRoute;
  i0: number;
  i1: number;
  cx: number;
  cz: number;
  reach: number;
  piers: number[];
  cushions: number[];
}

/**
 * Rapier colliders for the expressway: one fixed body per piece of ~16 segments (deck slab / fill, parapets, median barrier, piers, crash cushions).
 * Like the bridges, a piece only exists while the player is near it (physics radius + half the piece).
 * Bodies live in floating-origin local coordinates; PhysicsWorld shifts them when the origin moves. The boxes are the same ones the renderer draws.
 */
export class ExpresswayPhysics {
  private pieces: Piece[] = [];
  private active = new Map<number, RAPIER.RigidBody>();
  private timer = 1;

  constructor(
    private physics: PhysicsWorld,
    private origin: FloatingOrigin,
    private net: ExpresswayNetwork,
  ) {
    let id = 0;
    for (const r of net.routes) {
      const n = r.xs.length;
      const segs = n - 1;
      const per = r.kind === 'ramp' ? 20 : 16;
      for (let i0 = 0; i0 < segs; i0 += per) {
        const i1 = Math.min(segs, i0 + per);
        let cx = 0;
        let cz = 0;
        for (let i = i0; i <= i1; i++) {
          cx += r.xs[i];
          cz += r.zs[i];
        }
        cx /= i1 - i0 + 1;
        cz /= i1 - i0 + 1;
        let reach = 0;
        for (let i = i0; i <= i1; i++) reach = Math.max(reach, Math.hypot(r.xs[i] - cx, r.zs[i] - cz));
        this.pieces.push({ id: id++, route: r, i0, i1, cx, cz, reach: reach + 30, piers: [], cushions: [] });
      }
    }
    const byRoute = new Map<number, Piece[]>();
    for (const p of this.pieces) {
      const l = byRoute.get(p.route.id) ?? [];
      l.push(p);
      byRoute.set(p.route.id, l);
    }
    // a pier belongs to the piece that holds its station, a crash cushion to the piece nearest to it
    net.piers.forEach((pier, k) => {
      const list = byRoute.get(pier.routeId);
      const piece = list?.find((p) => pier.s >= p.route.cum[p.i0] - 1e-6 && pier.s <= p.route.cum[p.i1] + 1e-6) ?? list?.[list.length - 1];
      piece?.piers.push(k);
    });
    net.cushions.forEach((c, k) => {
      const list = byRoute.get(c.routeId);
      let best: Piece | undefined;
      let bd = Infinity;
      for (const p of list ?? []) {
        const d = Math.hypot(c.x - p.cx, c.z - p.cz);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      best?.cushions.push(k);
    });
  }

  get activeCount(): number {
    return this.active.size;
  }
  get pieceCount(): number {
    return this.pieces.length;
  }

  /** Call every frame with the player's WORLD position (throttled to 5 Hz). */
  update(dt: number, px: number, pz: number): void {
    this.timer += dt;
    if (this.timer < 0.2) return;
    this.timer = 0;
    for (const p of this.pieces) {
      const d = Math.hypot(px - p.cx, pz - p.cz);
      const reach = PhysicsConfig.activeRadius + p.reach;
      const has = this.active.has(p.id);
      if (!has && d <= reach) this.create(p);
      else if (has && d > reach + 64) this.remove(p.id);
    }
  }

  private create(p: Piece): void {
    const R = this.physics.RAPIER;
    const world = this.physics.world;
    const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(p.cx - this.origin.origin.x, 0, p.cz - this.origin.origin.z));
    const add = (b: Box): void => {
      if (!b.solid) return;
      const friction = b.kind === 'asphalt' ? 1.0 : 0.6;
      world.createCollider(
        R.ColliderDesc.cuboid(b.sx / 2, b.sy / 2, b.sz / 2)
          .setTranslation(b.cx - p.cx, b.cy, b.cz - p.cz)
          .setRotation({ x: b.qx, y: b.qy, z: b.qz, w: b.qw })
          .setFriction(friction),
        body,
      );
    };
    const tmp: Box[] = [];
    for (let i = p.i0; i < p.i1; i++) {
      tmp.length = 0;
      for (const b of segmentBoxes(p.route, i, tmp)) add(b);
    }
    for (const k of p.piers) {
      tmp.length = 0;
      for (const b of pierBoxes(this.net.piers[k], tmp)) add(b);
    }
    for (const k of p.cushions) {
      tmp.length = 0;
      for (const b of cushionBox(this.net.cushions[k], tmp)) add(b);
    }
    this.active.set(p.id, body);
  }

  private remove(id: number): void {
    const body = this.active.get(id);
    if (!body) return;
    this.physics.world.removeRigidBody(body);
    this.active.delete(id);
  }

  dispose(): void {
    for (const id of [...this.active.keys()]) this.remove(id);
  }
}
