// Design the expressway once and write it to src/expressway/ExpresswayBaked.ts:  npx tsx scripts/expressway-bake.ts
// Run it again whenever the terrain, the roads, the railway or src/expressway/* (the design rules) change.
import { writeFileSync } from 'node:fs';
import { TerrainGenerator } from '../src/terrain/TerrainGenerator';
import { Config } from '../src/core/Config';
import { ExpresswayNetwork } from '../src/expressway/ExpresswayNetwork';
import { expresswayAvoid } from '../src/expressway/ExpresswayAvoid';

ExpresswayNetwork.noBake = true;
const g = new TerrainGenerator(Config.world.seed);
const t0 = performance.now();
const net = new ExpresswayNetwork(g, g.roads.roads, expresswayAvoid());
const ms = performance.now() - t0;
const baked = net.toBaked();
const text = `import type { Baked } from './ExpresswayBake';\n// Written by \`npm run bake:expressway\` (scripts/expressway-bake.ts). Do not edit by hand.\n// Designed in ${ms.toFixed(0)} ms for the world with signature ${baked.sig}\nexport const BAKED: Baked | null = ${JSON.stringify(baked)};\n`;
writeFileSync(new URL('../src/expressway/ExpresswayBaked.ts', import.meta.url), text);
console.log(`baked ${net.routes.length} routes, ${net.piers.length} piers: ${(text.length / 1024).toFixed(0)} KB (designed in ${ms.toFixed(0)} ms)`);
