import { CARRIAGEWAY_MID, XD } from './ExpresswayStandards';
import { deckHeightAt, frameAt } from './ExpresswayRamps';
import type { XLamp, XRoute, XScupper, XSign } from './ExpresswayTypes';

/**
 * Street furniture: lamp posts every 36 m (30-40 m), scuppers (deck drains) every 30 m on the low edge, and the overhead sign gantries
 * 1000 m, 500 m and 250 m before every exit nose (AASHTO MUTCD advance guide signs).
 */

export interface Furniture {
  lamps: XLamp[];
  scuppers: XScupper[];
  signs: XSign[];
}

export function makeFurniture(routes: readonly XRoute[]): Furniture {
  const lamps: XLamp[] = [];
  const scuppers: XScupper[] = [];
  const signs: XSign[] = [];
  const byId = new Map<number, XRoute>();
  for (const r of routes) byId.set(r.id, r);
  for (const r of routes) {
    // lamps + scuppers
    let sNext = XD.lampSpacing / 2;
    let sDrain = XD.scupperSpacing / 2;
    for (let i = 0; i + 1 < r.xs.length; i++) {
      while (sNext <= r.cum[i + 1] + 1e-9) {
        const f = frameAt(r, sNext);
        const nx = Math.sin(f.h);
        const nz = -Math.cos(f.h);
        if (r.main) {
          // twin-arm pole on the median barrier
          lamps.push({ x: f.x, z: f.z, y: f.y + XD.medianH, ax: nx, az: nz, routeId: r.id });
        } else {
          const u = r.halfWidth - 0.35;
          lamps.push({ x: f.x + nx * u, z: f.z + nz * u, y: deckHeightAt(f, u, false), ax: -nx, az: -nz, routeId: r.id });
        }
        sNext += XD.lampSpacing;
      }
      while (sDrain <= r.cum[i + 1] + 1e-9) {
        if (r.viaduct[i]) {
          const f = frameAt(r, sDrain);
          const nx = Math.sin(f.h);
          const nz = -Math.cos(f.h);
          for (const side of r.main ? [1, -1] : [1]) {
            const w = r.main ? (side > 0 ? r.wl[i] : r.wr[i]) : 0;
            const u = side * (r.main ? XD.medianHalf + 20.4 + w - 0.5 : r.halfWidth - 0.6);
            scuppers.push({ x: f.x + nx * u, z: f.z + nz * u, y: deckHeightAt(f, u, r.main) - 0.1, routeId: r.id, side });
          }
        }
        sDrain += XD.scupperSpacing;
      }
    }
    // advance signs for the exits of this (main) route
    if (!r.main) continue;
  }
  for (const ramp of routes) {
    const info = ramp.ramp;
    if (!info || info.type !== 'exit') continue;
    const parent = byId.get(info.onRoute);
    if (!parent) continue;
    const dirS = info.side > 0 ? 1 : -1;
    for (const dist of XD.signDistances) {
      const s = info.noseS - dirS * dist;
      if (s < 10 || s > parent.length - 10) continue;
      const f = frameAt(parent, s);
      const lat = info.side * CARRIAGEWAY_MID;
      signs.push({
        x: f.x + Math.sin(f.h) * lat,
        z: f.z - Math.cos(f.h) * lat,
        y: deckHeightAt(f, lat),
        dx: Math.cos(f.h),
        dz: Math.sin(f.h),
        routeId: parent.id,
        half: 11.2,
        n: ramp.id,
        dist,
        face: dirS,
      });
    }
  }
  return { lamps, scuppers, signs };
}
