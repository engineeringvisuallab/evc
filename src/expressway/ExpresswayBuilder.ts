import * as THREE from 'three';
import type { ExpresswayNetwork } from './ExpresswayNetwork';
import { cushionBox, lampBoxes, pierBoxes, scupperBox, segmentBoxes, signBoxes, type Box, type BoxKind } from './ExpresswayShapes';

const CELL = 600;

const COLORS: Record<BoxKind, number> = {
  concrete: 0xb9b6ad,
  asphalt: 0x2c2e33,
  paint: 0xf1f1ea,
  dark: 0x2a2a2c,
  sign: 0x1d6b3a,
  lamp: 0xfff1c2,
  warning: 0xe2b900,
  steel: 0x7d8186,
};

/**
 * Visual expressway. Every part (slab with crown and banking, asphalt, girders, fill, parapets, median barrier, lane paint, piers with cap beams, expansion joints,
 * lamp posts, scuppers, sign gantries, crash cushions) comes from ExpresswayShapes as an oriented box and is drawn with InstancedMesh, one per material and 600 m cell,
 * so the camera only draws what it sees. Everything is placed in absolute world coordinates under the world root (the floating origin moves the root), like the bridges.
 */
export class ExpresswayBuilder {
  readonly group = new THREE.Group();
  private parts = new Map<BoxKind, Map<string, Box[]>>();
  private geo = new THREE.BoxGeometry(1, 1, 1);
  private mats: THREE.MeshLambertMaterial[] = [];
  readonly counts: Record<BoxKind, number> = { concrete: 0, asphalt: 0, paint: 0, dark: 0, sign: 0, lamp: 0, warning: 0, steel: 0 };

  constructor(net: ExpresswayNetwork) {
    this.group.name = 'Expressway';
    const tmp: Box[] = [];
    for (const r of net.routes) {
      for (let i = 0; i + 1 < r.xs.length; i++) {
        tmp.length = 0;
        for (const b of segmentBoxes(r, i, tmp)) this.push(b);
      }
    }
    for (const p of net.piers) {
      tmp.length = 0;
      for (const b of pierBoxes(p, tmp)) this.push(b);
    }
    for (const l of net.lamps) {
      tmp.length = 0;
      for (const b of lampBoxes(l, tmp)) this.push(b);
    }
    for (const s of net.signs) {
      tmp.length = 0;
      for (const b of signBoxes(s, tmp)) this.push(b);
    }
    for (const s of net.scuppers) {
      tmp.length = 0;
      for (const b of scupperBox(s, tmp)) this.push(b);
    }
    for (const c of net.cushions) {
      tmp.length = 0;
      for (const b of cushionBox(c, tmp)) this.push(b);
    }
    for (const kind of Object.keys(COLORS) as BoxKind[]) this.finish(kind);
  }

  private push(b: Box): void {
    const key = `${Math.floor(b.cx / CELL)},${Math.floor(b.cz / CELL)}`;
    let m = this.parts.get(b.kind);
    if (!m) this.parts.set(b.kind, (m = new Map()));
    let list = m.get(key);
    if (!list) m.set(key, (list = []));
    list.push({ ...b });
    this.counts[b.kind]++;
  }

  private finish(kind: BoxKind): void {
    const m = this.parts.get(kind);
    if (!m) return;
    const mat = new THREE.MeshLambertMaterial({ color: COLORS[kind] });
    if (kind === 'lamp') mat.emissive = new THREE.Color(0xffe9a8);
    this.mats.push(mat);
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    for (const list of m.values()) {
      const mesh = new THREE.InstancedMesh(this.geo, mat, list.length);
      list.forEach((b, i) => {
        pos.set(b.cx, b.cy, b.cz);
        quat.set(b.qx, b.qy, b.qz, b.qw);
        scl.set(b.sx, b.sy, b.sz);
        mesh.setMatrixAt(i, matrix.compose(pos, quat, scl));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = kind === 'concrete' || kind === 'steel';
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    m.clear();
  }

  dispose(): void {
    this.geo.dispose();
    for (const m of this.mats) m.dispose();
  }
}
