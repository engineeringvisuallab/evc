import { AIRPORT_SEA, ARMY, SEAPORT } from '../city/WorldZones';
import type { XAvoid } from './ExpresswayWorld';

/**
 * Where the expressway must not go: the army camp (+ 150 m), the new sea airport, and the flat land west of the seaport that is kept for the
 * second (future) airport (x < the port's west edge, z >= 2400, down to the coast).
 */
export function expresswayAvoid(): XAvoid[] {
  return [
    { x0: ARMY.x0, z0: ARMY.z0, x1: ARMY.x1, z1: ARMY.z1, margin: 150 },
    { x0: -4640, z0: 2400, x1: SEAPORT.x0 - 5, z1: 4640, margin: 45 },
    { x0: AIRPORT_SEA.x0, z0: AIRPORT_SEA.z0, x1: AIRPORT_SEA.x1, z1: AIRPORT_SEA.z1, margin: 60 },
  ];
}
