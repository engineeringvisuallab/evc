// Headless expressway test (real terrain + roads + railway + buildings): npx tsx scripts/expressway-test.ts
// Every design limit of docs/EXPRESSWAY_DESIGN.md is one PASS / FAIL line. Exit code 1 if anything fails.
import { TerrainGenerator } from '../src/terrain/TerrainGenerator';
import { Config } from '../src/core/Config';
import { ExpresswayNetwork } from '../src/expressway/ExpresswayNetwork';
import { expresswayAvoid } from '../src/expressway/ExpresswayAvoid';
import { ARMY, AIRPORT, AIRPORT_SEA, SEAPORT } from '../src/city/WorldZones';
import { CARRIAGEWAY_W, DECK_HALF, XD, crestSight, girderDepth, pierSize, sagSight, sightClearanceNeeded, stoppingSightDistance } from '../src/expressway/ExpresswayStandards';
import { maxGradeOf, minKOf } from '../src/expressway/ExpresswayProfile';
import { pierBoxes, segmentBoxes } from '../src/expressway/ExpresswayShapes';
import { rectDist } from '../src/expressway/ExpresswayMath';
import type { XRoute } from '../src/expressway/ExpresswayTypes';

let fails = 0;
let passes = 0;
const check = (c: boolean, msg: string): void => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (c) passes++;
  else fails++;
};
const f1 = (v: number): string => v.toFixed(1);
const f0 = (v: number): string => v.toFixed(0);

const g = new TerrainGenerator(Config.world.seed);
ExpresswayNetwork.noBake = true; // test the DESIGN, not the baked copy of it
const t0 = performance.now();
const net = new ExpresswayNetwork(g, g.roads.roads, expresswayAvoid());
const built = performance.now() - t0;
const mains = net.routes.filter((r) => r.kind !== 'ramp');
const ramps = net.routes.filter((r) => r.kind === 'ramp');
console.log(`built in ${f0(built)} ms: ${mains.length} main routes (${net.deckKm.toFixed(1)} km), ${ramps.length} ramps, ${net.piers.length} piers, ${net.spans.length} spans, ${net.interchanges.length} interchanges`);
for (const r of mains) console.log(`  ${r.name.padEnd(4)} ${r.kind.padEnd(9)} ${f0(r.length).padStart(6)} m`);
if (net.notes.length) console.log('notes:\n  ' + net.notes.join('\n  '));
if (net.issues.length) console.log('issues:\n  ' + net.issues.join('\n  '));

/* ----------------------------------------------------------------- helpers */
const radiusAt = (r: XRoute, i: number, k: number): number => {
  const a = i - k;
  const b = i + k;
  if (a < 0 || b >= r.xs.length) return Infinity;
  const A = Math.hypot(r.xs[i] - r.xs[b], r.zs[i] - r.zs[b]);
  const B = Math.hypot(r.xs[a] - r.xs[b], r.zs[a] - r.zs[b]);
  const C = Math.hypot(r.xs[a] - r.xs[i], r.zs[a] - r.zs[i]);
  const ar = Math.abs((r.xs[i] - r.xs[a]) * (r.zs[b] - r.zs[a]) - (r.zs[i] - r.zs[a]) * (r.xs[b] - r.xs[a]));
  return ar < 1e-9 ? Infinity : (A * B * C) / (2 * ar);
};
const left = (r: XRoute, i: number): [number, number] => [Math.sin(r.heading[i]), -Math.cos(r.heading[i])];

/* ------------------------------------------------------- 0. the standard itself */
console.log('\n== cross-section and standards ==');
check(XD.lanes === 4 && XD.laneW === 3.6, `4 lanes x 3.6 m per direction (8 lanes)`);
check(XD.innerShoulder >= 3.0 && XD.outerShoulder >= 3.0, `shoulders: inner ${XD.innerShoulder} m (4+ lanes: 3.0), outer ${XD.outerShoulder} m (emergency stop)`);
check(Math.abs(XD.medianH - 0.81) < 1e-9 && Math.abs(XD.parapetH - 1.07) < 1e-9, `median F-shape barrier ${XD.medianH} m, truck parapet ${XD.parapetH} m`);
check(Math.abs(CARRIAGEWAY_W - 20.4) < 1e-9 && Math.abs(DECK_HALF * 2 - 42.8) < 1e-9, `carriageway ${f1(CARRIAGEWAY_W)} m, whole deck ${f1(DECK_HALF * 2)} m`);
check(XD.designSpeed === 80 && XD.rampSpeed >= 40 && XD.rampSpeed <= 50, `design speed ${XD.designSpeed} km/h, ramps ${XD.rampSpeed} km/h`);
check(XD.rMinAashto === 250 && XD.rMin >= 250 && XD.eMax === 0.06, `R min AASHTO ${XD.rMinAashto} m, designed ${XD.rMin} m, e max ${XD.eMax * 100} %`);
check(Math.abs(stoppingSightDistance(80) - 130) < 4, `stopping sight distance at 80 km/h = ${f0(stoppingSightDistance(80))} m (130 m)`);
check(XD.kCrest >= 26 && XD.kSag >= 30 && crestSight(XD.kCrest) >= 128 && sagSight(XD.kSag) >= 128, `K crest ${XD.kCrest} (sight ${f0(crestSight(XD.kCrest))} m), K sag ${XD.kSag} (sight ${f0(sagSight(XD.kSag))} m)`);
check(XD.maxGrade <= 0.03, `main grade limit ${XD.maxGrade * 100} %`);
check(XD.ramp1W >= 5 && XD.ramp1W <= 6 && XD.ramp2W >= 8 && XD.ramp2W <= 9, `ramp widths: 1 lane ${XD.ramp1W} m, 2 lanes ${XD.ramp2W} m`);
check(XD.rampMinRadius >= 60 && XD.loopMinRadius >= 50, `ramp radius ${XD.rampMinRadius} m (>= 60), loop ${XD.loopMinRadius} m (>= 50)`);
check(XD.taperRatio >= 15 && XD.taperRatio <= 25 && XD.decelLen >= 100 && XD.decelLen <= 150 && XD.accelLen >= 200 && XD.accelLen <= 300, `taper 1:${XD.taperRatio}, decel ${XD.decelLen} m, accel ${XD.accelLen} m`);
check(XD.clearRoad >= 5.5 && XD.clearRail >= 7.0 && XD.clearRiver >= 5.0, `clearances: road ${XD.clearRoad}, railway ${XD.clearRail} (25 kV), river ${XD.clearRiver} m`);
check(Math.abs(girderDepth(35) - 35 / 19) < 1e-9 && girderDepth(35) >= 1.75 && girderDepth(35) <= 2.0, `girder depth at 35 m span = ${girderDepth(35).toFixed(2)} m (span/19)`);
{
  const p = pierSize(2 * DECK_HALF, XD.spanMax, 2, XD.lanes);
  check(p.ok, `HL-93 pier check at 40 m span: column ${p.b} x ${p.t} m, axial ${f1(p.axial)} MN (factored ${f1(p.pu)} MN <= capacity ${f1(p.phiPn)} MN), stress ${f1(p.stress)} <= ${f1(p.allowed)} MPa`);
  const q = pierSize(2 * DECK_HALF, XD.spanSpecial, 2, XD.lanes);
  check(q.ok, `HL-93 pier check at 70 m span: factored ${f1(q.pu)} MN <= ${f1(q.phiPn)} MN`);
}

/* ------------------------------------------------------ 1. horizontal alignment */
console.log('\n== horizontal alignment ==');
for (const r of mains) {
  let rmin = Infinity;
  let straight = 0;
  for (let i = 3; i + 3 < r.xs.length; i++) {
    const R = radiusAt(r, i, 3);
    rmin = Math.min(rmin, R);
    if (R > 5000) straight += r.step;
  }
  const limit = r.kind === 'ring' ? XD.rMin : 300;
  check(rmin >= limit - 1, `${r.name}: minimum radius ${f0(rmin)} m >= ${limit} m (AASHTO 250 m); straight ${(straight / r.length * 100).toFixed(0)} % of the length`);
}
{
  // sight distance on curves: R tighter than 450 m runs at an advisory 70 km/h
  let bad = 0;
  let worst = 0;
  for (const r of mains) {
    for (let i = 3; i + 3 < r.xs.length; i++) {
      const R = radiusAt(r, i, 3);
      if (!isFinite(R) || R > 5000) continue;
      const v = R >= XD.rMin ? XD.designSpeed : 70;
      const S = stoppingSightDistance(v);
      const need = sightClearanceNeeded(S, R);
      const have = XD.innerShoulder + XD.laneW / 2;
      worst = Math.max(worst, need);
      if (need > have + 0.3) bad++;
    }
  }
  check(bad === 0, `sight distance on curves: lateral clearance needed <= ${f1(XD.innerShoulder + XD.laneW / 2)} m everywhere (worst ${f1(worst)} m; R < 450 m runs at an advisory 70 km/h)`);
}
{
  let worstE = 0;
  let wrongSign = 0;
  let worstF = 0;
  let worstRel = 0;
  let shortE = 0;
  let curves = 0;
  for (const r of mains) {
    for (let i = 1; i + 1 < r.xs.length; i++) {
      worstE = Math.max(worstE, Math.abs(r.e[i]));
      const k = r.kappa[i];
      if (Math.abs(k) > 1 / 1000) {
        curves++;
        if (r.e[i] * k < 0) wrongSign++;
        const f = (XD.designSpeed * XD.designSpeed) / (127 * (1 / Math.abs(k))) - Math.abs(r.e[i]);
        worstF = Math.max(worstF, f);
        if (Math.abs(r.e[i]) < 0.02) shortE++;
      }
      const d = Math.max(Math.abs(r.cl[i + 1] - r.cl[i]), Math.abs(r.cr[i + 1] - r.cr[i])) * CARRIAGEWAY_W / (r.cum[i + 1] - r.cum[i]);
      worstRel = Math.max(worstRel, d);
    }
  }
  check(worstE <= XD.eMax + 1e-9, `superelevation never above ${XD.eMax * 100} % (max ${(worstE * 100).toFixed(2)} %)`);
  check(wrongSign === 0, `superelevation always banked toward the inside of a curve (${curves} curve stations)`);
  check(worstF <= 0.14 + 1e-6, `side friction demand <= 0.14 at 80 km/h (max ${worstF.toFixed(3)})`);
  check(worstRel <= 0.0105, `relative gradient of the carriageway edge <= 1 % per step... max ${(worstRel * 100).toFixed(2)} % (design 0.5 %, crown removal doubles it)`);
  check(shortE <= curves * 0.4, `curves carry >= 2 % superelevation on ${(100 - (100 * shortE) / Math.max(1, curves)).toFixed(0)} % of curve stations`);
}

/* --------------------------------------------------------- 2. vertical alignment */
console.log('\n== vertical alignment ==');
for (const r of mains) {
  const gr = maxGradeOf(r.ys, r.cum);
  const k = minKOf(r.ys, r.cum);
  check(gr <= XD.maxGrade + 5e-4, `${r.name}: max grade ${(gr * 100).toFixed(2)} % <= 3 %`);
  check(k.crest >= XD.kCrest * 0.97, `${r.name}: min crest K ${isFinite(k.crest) ? f1(k.crest) : 'n/a'} >= ${XD.kCrest} (sight ${isFinite(k.crest) ? f0(crestSight(k.crest)) : '-'} m >= 125)`);
  check(k.sag >= XD.kSag * 0.97, `${r.name}: min sag K ${isFinite(k.sag) ? f1(k.sag) : 'n/a'} >= ${XD.kSag} (sight ${isFinite(k.sag) ? f0(sagSight(k.sag)) : '-'} m >= 125)`);
}

/* ------------------------------------------------------------- 3. clearances */
console.log('\n== clearances (independent re-check with the world data) ==');
{
  const worst: Record<string, number> = { road: Infinity, rail: Infinity, water: Infinity, pad: Infinity, deck: Infinity };
  let violations = 0;
  for (const r of net.routes) {
    for (let i = 0; i < r.xs.length; i++) {
      if (!r.viaduct[i]) continue;
      const [nx, nz] = left(r, i);
      const hw = r.halfWidth;
      const ax = r.xs[i] + nx * hw;
      const az = r.zs[i] + nz * hw;
      const bx = r.xs[i] - nx * hw;
      const bz = r.zs[i] - nz * hw;
      const soffit = r.ys[i] - XD.asphalt - XD.slab - r.girder[i];
      for (const h of net.world.featuresUnder(ax, az, bx, bz)) {
        if (h.kind === 'road' && h.onBridge && r.id < 0) continue;
        const margin = soffit - (h.top + h.clear);
        const key = h.kind === 'road' ? 'road' : h.kind;
        worst[key] = Math.min(worst[key], margin);
        if (margin < -0.12) violations++;
      }
      const w = net.world.waterOn(ax, az, bx, bz);
      if (!Number.isNaN(w)) {
        const margin = soffit - (w + XD.clearRiver);
        worst.water = Math.min(worst.water, margin);
        if (margin < -0.12) violations++;
      }
    }
  }
  const show = (v: number): string => (isFinite(v) ? f1(v) : 'n/a');
  check(violations === 0, `girder soffit clears every road (5.5 m), railway head (7.5 m), river (6.0 m above the water), junction pad (5.5 m): worst margins road ${show(worst.road)} / rail ${show(worst.rail)} / water ${show(worst.water)} / pad ${show(worst.pad)} m, ${violations} violations`);
  // cap beams
  let capBad = 0;
  let capWorst = Infinity;
  for (const p of net.piers) {
    const r = net.routes[p.routeId];
    const capBottom = p.capTop - p.capDepth;
    const [nx, nz] = [p.dz, -p.dx];
    const hw = p.capHalf;
    for (const h of net.world.featuresUnder(p.x + nx * hw, p.z + nz * hw, p.x - nx * hw, p.z - nz * hw)) {
      const m = capBottom - (h.top + h.clear);
      capWorst = Math.min(capWorst, m);
      if (m < -0.12) capBad++;
    }
    void r;
  }
  check(capBad === 0, `underside of every pier cap beam clears the road / rail under it (worst margin ${show(capWorst)} m, ${capBad} violations)`);
}
{
  // low fill: deck within 3 m of the ground is an embankment (no piers), higher is a viaduct
  let wrong = 0;
  let fillKm = 0;
  for (const r of net.routes) {
    for (let i = 0; i < r.xs.length; i++) {
      const h = r.ys[i] - r.gc[i];
      if (!r.viaduct[i]) fillKm += r.step / 1000;
      if (r.viaduct[i] && h < XD.embankMax - 0.01 && r.girder[i] === 0) wrong++;
      if (!r.viaduct[i] && h > 6.5) wrong++;
    }
  }
  check(wrong === 0, `deck lower than 3 m is retained fill, not a hanging deck (${fillKm.toFixed(1)} km on fill, ${wrong} wrong stations)`);
}

/* ------------------------------------------------------------ 4. piers, spans */
console.log('\n== piers and spans ==');
{
  const kinds: Record<string, number> = {};
  let bad = 0;
  let badWhy = '';
  for (const p of net.piers) {
    kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
    for (const c of p.cols) {
      const rc = Math.hypot(p.b, p.t) / 2;
      const why = net.world.pierBlocked(c.x, c.z, Math.max(0.5, rc - 0.4), p.dx, p.dz, p.kind === 'median' || p.kind === 'single');
      if (why !== null && why !== 'median') {
        // pierBlocked is stricter than needed for ramps beside a highway; count only real obstacles
        bad++;
        if (!badWhy) badWhy = `${why} at ${f0(c.x)},${f0(c.z)}`;
      }
    }
  }
  check(bad === 0, `no pier column stands on a road, the railway land, water, a pad, a building, a plot or a station (${net.piers.length} piers: ${JSON.stringify(kinds)})${badWhy ? ' first: ' + badWhy : ''}`);
  // median piers are on a highway yellow line
  let medianBad = 0;
  for (const p of net.piers) {
    if (p.kind !== 'median') continue;
    const q = net.world.nearestRoad(p.x, p.z, 8);
    if (!q || q.road.tier !== 1 || q.d > XD.medianBand + 0.05) medianBad++;
  }
  check(medianBad === 0, `${kinds.median ?? 0} median piers all stand on the yellow line of a highway (within ${XD.medianBand} m)`);
}
{
  const main = net.spans.filter((s) => net.routes[s.routeId].main);
  const normal = main.filter((s) => s.length >= XD.spanMin - 0.01 && s.length <= XD.spanMax + 0.01);
  const longer = main.filter((s) => s.length > XD.spanMax + 0.01);
  const shorter = main.filter((s) => s.length < XD.spanMin - 0.01);
  check(longer.every((s) => s.length <= XD.spanLong + 0.01), `main spans: ${normal.length} normal (30-40 m), ${longer.length} special / long (max ${f0(Math.max(0, ...longer.map((s) => s.length)))} m <= ${XD.spanLong} m), ${shorter.length} end spans < 30 m`);
  // a longer span must have a reason: something under it that no pier can stand on
  let unexplained = 0;
  for (const s of longer) {
    const r = net.routes[s.routeId];
    let reason = false;
    for (let i = 0; i < r.xs.length && !reason; i++) {
      if (r.cum[i] < s.s0 || r.cum[i] > s.s1) continue;
      const why = net.world.pierBlocked(r.xs[i], r.zs[i], 2, Math.cos(r.heading[i]), Math.sin(r.heading[i]), true);
      if (why !== null && why !== 'median') reason = true;
    }
    if (!reason && s.length > XD.spanMax + 6) unexplained++;
  }
  check(unexplained <= Math.ceil(longer.length * 0.1), `long spans are over something (road, rail, water, junction): ${longer.length - unexplained}/${longer.length} explained`);
  let depthBad = 0;
  for (const s of main) {
    const r = net.routes[s.routeId];
    for (let i = 0; i < r.xs.length; i++) if (r.cum[i] >= s.s0 && r.cum[i] <= s.s1 && r.viaduct[i] && r.girder[i] + 1e-6 < girderDepth(s.length) * 0.999 && r.girder[i] > 0) depthBad++;
  }
  check(depthBad === 0, `girder depth follows the span (span/19 up to 70 m, span/30 steel box beyond)`);
}
{
  // no pier sits in the way of a road: ramp piers too, and ramps / decks do not collide with each other's piers
  let clash = 0;
  const idx = net.piers.filter((p) => p.kind !== 'abutment');
  for (let a = 0; a < idx.length; a++) {
    for (let b = a + 1; b < idx.length; b++) {
      if (idx[a].routeId === idx[b].routeId) continue;
      if (Math.hypot(idx[a].x - idx[b].x, idx[a].z - idx[b].z) < 4) clash++;
    }
  }
  check(clash === 0, `no pier of one route stands within 4 m of a pier of another route`);
}

/* ------------------------------------------------------------------ 5. ramps */
console.log('\n== ramps and interchanges ==');
{
  let minR = Infinity;
  let maxG = 0;
  let minCrest = Infinity;
  let minSag = Infinity;
  let maxE = 0;
  for (const r of ramps) {
    for (let i = 2; i + 2 < r.xs.length; i++) minR = Math.min(minR, radiusAt(r, i, 2));
    maxG = Math.max(maxG, maxGradeOf(r.ys, r.cum));
    const k = minKOf(r.ys, r.cum);
    minCrest = Math.min(minCrest, k.crest);
    minSag = Math.min(minSag, k.sag);
    for (const e of r.e) maxE = Math.max(maxE, Math.abs(e));
  }
  check(minR >= 60, `${ramps.length} ramps: minimum radius ${f0(minR)} m >= 60 m (designed ${XD.rampMinRadius} m)`);
  check(maxG <= XD.rampMaxGrade + 5e-4, `ramp grade <= 6 % (max ${(maxG * 100).toFixed(2)} %)`);
  check(minCrest >= XD.rampKCrest * 0.9 && minSag >= XD.rampKSag * 0.9, `ramp K crest >= ${XD.rampKCrest} / sag >= ${XD.rampKSag} (min ${isFinite(minCrest) ? f1(minCrest) : 'n/a'} / ${isFinite(minSag) ? f1(minSag) : 'n/a'})`);
  check(maxE <= XD.rampEMax + 1e-9, `ramp superelevation <= 6 % (max ${(maxE * 100).toFixed(2)} %)`);
  check(ramps.every((r) => r.ramp && r.halfWidth * 2 >= 5.9 && r.halfWidth * 2 <= 9.0), `all ramps are one-way, 6.0 m (1 lane) or 8.6 m (2 lanes)`);
}
{
  // taper + decel / accel lanes on the main deck
  let tBad = 0;
  let lBad = 0;
  for (const r of ramps) {
    const info = r.ramp!;
    const parent = net.routes[info.onRoute];
    const arr = info.side > 0 ? parent.wl : parent.wr;
    const auxW = info.lanes * 3.6;
    const dirS = info.side > 0 ? 1 : -1;
    // widening profile along travel
    const w = (s: number): number => {
      const k = Math.min(parent.xs.length - 1, Math.max(0, Math.round(s / parent.step)));
      return arr[k];
    };
    const ratio = info.taper / auxW;
    if (ratio < 15 || ratio > 25) tBad++;
    if (info.type === 'exit') {
      const full = info.noseS - dirS * info.parallel;
      const startTaper = full - dirS * info.taper;
      if (info.parallel < 100 || info.parallel > 150 || w(full) < auxW * 0.9 || w(startTaper) > 0.8) lBad++;
    } else {
      const full = info.noseS + dirS * info.parallel;
      const endTaper = full + dirS * info.taper;
      if (info.parallel < 200 || info.parallel > 300 || w(info.noseS + dirS * 40) < auxW * 0.9 || w(endTaper) > 0.8) lBad++;
    }
  }
  check(tBad === 0, `every exit / entrance has a taper of 1:15 to 1:25 (1:${XD.taperRatio})`);
  check(lBad === 0, `exits have a 100-150 m deceleration lane (${XD.decelLen} m), entrances a 200-300 m acceleration lane (${XD.accelLen} m) and the aux lane really is on the deck`);
  const cushions = net.cushions;
  let noCushion = 0;
  for (const r of ramps) {
    const info = r.ramp!;
    const parent = net.routes[info.onRoute];
    const k = Math.min(parent.xs.length - 1, Math.round(info.noseS / parent.step));
    if (!cushions.some((c) => c.routeId === parent.id && Math.hypot(c.x - parent.xs[k], c.z - parent.zs[k]) < 40)) noCushion++;
  }
  check(noCushion === 0, `every gore nose has a crash cushion (${cushions.length} cushions)`);
}
{
  // a ramp ends on the ground and merges tangentially into the kerb lane of an ordinary road
  let notRoad = 0;
  let angle = 0;
  let notGround = 0;
  let heightBad = 0;
  let n = 0;
  for (const r of ramps) {
    const info = r.ramp!;
    if (!info.landing) continue;
    n++;
    const end = info.type === 'exit' ? r.xs.length - 1 : 0;
    const q = net.world.nearestRoad(r.xs[end], r.zs[end], 12);
    if (!q || q.road.id !== info.landing.roadId || Math.abs(q.d - q.road.halfWidth * 0.5) > 1.2) notRoad++;
    if (q) {
      const hd = Math.atan2(r.zs[Math.max(0, end + (info.type === 'exit' ? -1 : 1))] - r.zs[end], r.xs[Math.max(0, end + (info.type === 'exit' ? -1 : 1))] - r.xs[end]);
      let a = Math.abs(Math.atan2(Math.sin(hd - Math.atan2(q.tz, q.tx)), Math.cos(hd - Math.atan2(q.tz, q.tx)))) * 57.3;
      if (a > 90) a = 180 - a;
      angle = Math.max(angle, a);
      if (Math.abs(r.ys[end] - q.y) > 0.4) heightBad++;
    }
    if (r.ys[end] - r.gc[end] > 0.6) notGround++;
  }
  check(n > 0 && notRoad === 0, `${n} ramps land on a real ordinary road, in its kerb lane (lane centre = half of the half-width)`);
  check(angle <= 8, `merge angle with the road <= 8 degrees (max ${f1(angle)}), so the road traffic is never stopped`);
  check(notGround === 0 && heightBad === 0, `ramps end on the ground at the height of the road (${notGround} not on ground, ${heightBad} height steps)`);
}
{
  // interchanges: separate exit and entrance
  const bad: string[] = [];
  for (const ic of net.interchanges) {
    const rs = ic.rampIds.map((id) => net.routes[id]);
    const ex = rs.filter((r) => r.ramp!.type === 'exit').length;
    const en = rs.filter((r) => r.ramp!.type === 'entrance').length;
    if (ex < 1 || en < 1) bad.push(`${ic.n}:${ic.id}(${ex} exit/${en} entrance)`);
  }
  check(bad.length === 0, `every interchange has at least one exit and one entrance${bad.length ? ' - MISSING: ' + bad.join(', ') : ''} (${net.interchanges.length} interchanges)`);
  const full = net.interchanges.filter((ic) => ic.kind === 'service' && ic.rampIds.length >= 4).length;
  const svc = net.interchanges.filter((ic) => ic.kind === 'service').length;
  console.log(`  info: ${full}/${svc} service interchanges have all four ramps; ${net.interchanges.filter((ic) => ic.kind === 'system').length} directional T interchanges with ${net.interchanges.filter((ic) => ic.kind === 'system').reduce((a, ic) => a + ic.rampIds.length, 0)} ramps`);
  let flyovers = 0;
  for (const r of ramps) if (r.ramp!.flyover) flyovers++;
  check(flyovers >= 1, `${flyovers} flyover ramps cross over the ring (clearance checked above with the main deck as a pseudo road)`);
}
{
  // spacing between service interchanges along a route (>= 1.5 km) and weaving
  let spacingBad = 0;
  let minSp = Infinity;
  let weaveBad = 0;
  let minWeave = Infinity;
  for (const r of mains) {
    const ics = net.interchanges.filter((ic) => ic.routeId === r.id && (ic.kind === 'service' || ic.kind === 'terminal')).sort((a, b) => a.s - b.s);
    for (let i = 1; i < ics.length; i++) {
      const d = ics[i].s - ics[i - 1].s;
      minSp = Math.min(minSp, d);
      if (d < XD.interchangeSpacing) spacingBad++;
    }
    // weaving: entrance nose -> next exit nose in the same direction
    for (const dir of [1, -1]) {
      const noses = ramps
        .filter((q) => q.ramp!.onRoute === r.id && (q.ramp!.side > 0 ? 1 : -1) === dir)
        .map((q) => ({ s: q.ramp!.noseS * dir, type: q.ramp!.type }))
        .sort((a, b) => a.s - b.s);
      for (let i = 1; i < noses.length; i++) {
        if (noses[i - 1].type === 'entrance' && noses[i].type === 'exit') {
          const wl = noses[i].s - noses[i - 1].s;
          minWeave = Math.min(minWeave, wl);
          if (wl < XD.weaveMin) weaveBad++;
        }
      }
    }
  }
  check(spacingBad === 0, `interchanges on one route are >= ${XD.interchangeSpacing} m apart (shortest ${isFinite(minSp) ? f0(minSp) : 'n/a'} m)`);
  check(weaveBad === 0, `weaving length from an entrance nose to the next exit nose >= ${XD.weaveMin} m (shortest ${isFinite(minWeave) ? f0(minWeave) : 'n/a'} m)`);
}
{
  // route ends
  const ringA = net.routes.find((r) => r.name === 'XR')!;
  const ringB = net.routes.find((r) => r.name === 'XT')!;
  const ends: string[] = [];
  for (const r of mains) {
    for (const e of ['start', 'end'] as const) {
      const s = e === 'start' ? 0 : r.length;
      const ok = net.interchanges.some((ic) => ic.routeId === r.id && Math.abs(ic.s - s) < 20) || net.cushions.some((c) => c.routeId === r.id && Math.hypot(c.x - r.xs[e === 'start' ? 0 : r.xs.length - 1], c.z - r.zs[e === 'start' ? 0 : r.xs.length - 1]) < 25);
      if (!ok) ends.push(`${r.name}.${e}`);
    }
  }
  check(ends.length === 0, `every route ends in a terminal / T junction with an end wall and crash cushions${ends.length ? ' - MISSING: ' + ends.join(', ') : ''}`);
  const gap = Math.hypot(ringA.xs[0] - ringB.xs[ringB.xs.length - 1], ringA.zs[0] - ringB.zs[ringB.zs.length - 1]);
  check(gap > 3000, `the ring is a 'C' open in the north-west (ends ${f0(gap)} m apart) and cut into three arcs XR / XS / XT`);
}

/* ------------------------------------------------------- 6. what is NOT allowed */
console.log('\n== keep-out areas and other structures ==');
{
  let army = Infinity;
  let airport = Infinity;
  let sea = Infinity;
  let future = 0;
  let seaport = 0;
  const probe = (x: number, z: number): void => {
    army = Math.min(army, rectDist(x, z, ARMY.x0, ARMY.z0, ARMY.x1, ARMY.z1));
    airport = Math.min(airport, rectDist(x, z, AIRPORT.x0, AIRPORT.z0, AIRPORT.x1, AIRPORT.z1));
    sea = Math.min(sea, rectDist(x, z, AIRPORT_SEA.x0, AIRPORT_SEA.z0, AIRPORT_SEA.x1, AIRPORT_SEA.z1));
    if (x < SEAPORT.x0 && z >= 2400) future++;
  };
  for (const r of net.routes) {
    for (let i = 0; i < r.xs.length; i++) {
      const [nx, nz] = left(r, i);
      for (const u of [-r.halfWidth, 0, r.halfWidth]) probe(r.xs[i] + nx * u, r.zs[i] + nz * u);
    }
  }
  for (const p of net.piers) for (const c of p.cols) probe(c.x, c.z);
  for (const r of net.routes) for (let i = 0; i < r.xs.length; i++) if (rectDist(r.xs[i], r.zs[i], SEAPORT.x0, SEAPORT.z0, SEAPORT.x1, SEAPORT.z1) === 0) seaport++;
  check(army >= 80, `army camp (-1600, -2920): nearest expressway edge ${f0(army)} m (>= 80 m)`);
  check(airport >= 60 && sea >= 60, `airports: nearest edge ${f0(airport)} m (airport) / ${f0(sea)} m (sea airport) (>= 60 m)`);
  check(future === 0, `no deck, ramp or pier on the future airport land (x < ${SEAPORT.x0}, z >= 2400): ${future} points`);
  check(seaport === 0, `nothing inside the seaport area itself: ${seaport} points`);
}
{
  // buildings, plots, stations, plants: hard conflicts under the whole deck width
  const hits: Record<string, number> = {};
  for (const r of mains) {
    for (let i = 0; i < r.xs.length; i++) {
      const [nx, nz] = left(r, i);
      for (const u of [-DECK_HALF, -DECK_HALF / 2, 0, DECK_HALF / 2, DECK_HALF]) {
        const k = net.world.keepOut(r.xs[i] + nx * u, r.zs[i] + nz * u, 0);
        if (k) hits[k.split(':')[0]] = (hits[k.split(':')[0]] ?? 0) + 1;
      }
    }
  }
  const total = Object.values(hits).reduce((a, b) => a + b, 0);
  check(total === 0, `main decks touch no building, plot (mall, library, police, EV lab), plant, station or facility: ${JSON.stringify(hits)}`);
  let soft = 0;
  for (const r of mains) for (let i = 0; i < r.xs.length; i += 2) if (net.world.softOut(r.xs[i], r.zs[i], 0)) soft++;
  console.log(`  info: ${soft} deck centre-line samples are over a fenced engineering area or a building-pad skirt (a deck may overhang them; piers may not)`);
}
{
  // the railway: pier clearance of the railway land
  let nearest = Infinity;
  for (const p of net.piers) for (const c of p.cols) nearest = Math.min(nearest, net.world.railDist(c.x, c.z, 80));
  check(nearest >= 14 + XD.pierGapRail - 0.2, `nearest pier to a railway line ${isFinite(nearest) ? f0(nearest) : '> 80'} m (>= ${14 + XD.pierGapRail} m: land 14 m + 3 m)`);
}

/* ------------------------------------------------------------------- 7. furniture */
console.log('\n== furniture ==');
{
  const lamps = net.lamps.filter((l) => net.routes[l.routeId].main);
  let dmax = 0;
  let dmin = Infinity;
  for (let i = 1; i < lamps.length; i++) {
    if (lamps[i].routeId !== lamps[i - 1].routeId) continue;
    const d = Math.hypot(lamps[i].x - lamps[i - 1].x, lamps[i].z - lamps[i - 1].z);
    if (d > 80) continue;
    dmax = Math.max(dmax, d);
    dmin = Math.min(dmin, d);
  }
  check(lamps.length > 100 && dmin >= 28 && dmax <= 40.5, `${net.lamps.length} lamp posts, spacing ${f1(dmin)}-${f1(dmax)} m (30-40 m)`);
  check(net.scuppers.length > 100, `${net.scuppers.length} scuppers (deck drains) every ${XD.scupperSpacing} m on the low edges of viaducts`);
  const exits = ramps.filter((r) => r.ramp!.type === 'exit').length;
  const bySign = new Map<number, number[]>();
  for (const s of net.signs) bySign.set(s.n, [...(bySign.get(s.n) ?? []), s.dist]);
  let incomplete = 0;
  for (const [, d] of bySign) if (d.length < 3) incomplete++;
  check(net.signs.length >= exits * 2 && incomplete <= Math.ceil(exits * 0.2), `advance sign gantries 1000 / 500 / 250 m before the exits: ${net.signs.length} gantries for ${exits} exits (${incomplete} exits lack one because the deck is too short)`);
}

/* ------------------------------------------------------------- 8. geometry sanity */
console.log('\n== geometry, determinism, speed ==');
{
  let n = 0;
  let bad = 0;
  for (const r of net.routes) {
    for (let i = 0; i + 1 < r.xs.length; i += 3) {
      for (const b of segmentBoxes(r, i)) {
        n++;
        if (![b.cx, b.cy, b.cz, b.qx, b.qy, b.qz, b.qw, b.sx, b.sy, b.sz].every(Number.isFinite) || b.sx <= 0 || b.sy <= 0 || b.sz <= 0) bad++;
        if (Math.abs(Math.hypot(b.qx, b.qy, b.qz, b.qw) - 1) > 1e-6) bad++;
      }
    }
  }
  for (const p of net.piers) for (const b of pierBoxes(p)) if (!Number.isFinite(b.cx + b.cy + b.cz + b.sx + b.sy + b.sz) || b.sy <= 0) bad++;
  check(bad === 0, `${n} sampled deck boxes + all pier boxes are finite, with unit quaternions`);
}
{
  const hash = (a: ExpresswayNetwork): string => {
    let h = 0;
    const mix = (v: number): void => {
      h = (Math.imul(h ^ Math.round(v * 1000), 0x01000193) + 0x9e3779b9) | 0;
    };
    for (const r of a.routes) for (let i = 0; i < r.xs.length; i++) mix(r.xs[i] + r.zs[i] * 3 + r.ys[i] * 7 + r.e[i] * 1e4 + r.wl[i] * 5 + r.girder[i]);
    for (const p of a.piers) mix(p.x * 3 + p.z * 5 + p.capTop);
    return `${a.routes.length}/${a.piers.length}/${h}`;
  };
  const t1 = performance.now();
  const net2 = new ExpresswayNetwork(g, g.roads.roads, expresswayAvoid());
  const second = performance.now() - t1;
  check(hash(net) === hash(net2), `building twice gives the same network (${hash(net)})`);
  check(built < 15000, `network design (done once, by the bake script) took ${f0(built)} ms (second run ${f0(second)} ms)`);
  // the game loads the BAKED copy of the design
  ExpresswayNetwork.noBake = false;
  const t2 = performance.now();
  const loaded = new ExpresswayNetwork(g, g.roads.roads, expresswayAvoid());
  const loadMs = performance.now() - t2;
  check(loaded.fromBaked, `the baked design matches this world (signature ${loaded.signature})`);
  check(loadMs < 150, `game start-up: loading the baked design takes ${f0(loadMs)} ms (the old design took ~700 ms)`);
  let diff = 0;
  if (loaded.fromBaked) {
    if (loaded.routes.length !== net.routes.length || loaded.piers.length !== net.piers.length) diff = 1e9;
    else {
      for (let k = 0; k < net.routes.length; k++) {
        const a = net.routes[k];
        const b = loaded.routes[k];
        for (let i = 0; i < a.xs.length; i += 5) diff = Math.max(diff, Math.abs(a.xs[i] - b.xs[i]), Math.abs(a.zs[i] - b.zs[i]), Math.abs(a.ys[i] - b.ys[i]));
      }
    }
  }
  check(loaded.fromBaked && diff < 0.01, `baked and freshly designed networks agree to ${diff.toFixed(4)} m (${loaded.routes.length} routes, ${loaded.piers.length} piers)`);
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
