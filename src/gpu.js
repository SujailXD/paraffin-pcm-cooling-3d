// Single GPU paraffin cooling: GPU + cold plate, sealed paraffin container with chimney,
// external dry cooler. Each bead is one parcel of slurry with its own heat.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { addFloorWatermark } from './watermark.js';

const $ = (s) => document.querySelector(s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- colours from CSS tokens ---------- */
const rootStyle = getComputedStyle(document.documentElement);
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function tok(name) {
  probe.clearRect(0, 0, 1, 1); probe.fillStyle = '#000';
  probe.fillStyle = rootStyle.getPropertyValue(name).trim(); probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return new THREE.Color().setRGB(d[0] / 255, d[1] / 255, d[2] / 255, THREE.SRGBColorSpace);
}
const C = {
  ground: tok('--scene-ground'), rule: tok('--color-rule'), rule2: tok('--color-rule-2'),
  metal: tok('--scene-metal'), metalDark: tok('--scene-metal-dark'), ink: tok('--color-ink'), muted: tok('--color-muted'),
  solid: tok('--scene-wax-solid'), liquid: tok('--scene-wax-liquid'), cool: tok('--color-cool'), amber: tok('--color-accent'),
  hot: tok('--scene-hot'), copper: tok('--scene-copper'), pcb: tok('--scene-pcb'),
};

/* ---------- physics ---------- */
const N = 240, TAU = 20, MDOT = 0.02, MCELL = MDOT * TAU / N;
const CP = 1900, LPHI = 0.20 * 200000, HALF = 1.5;
const WAX_KG = 4, WAX_CP = 2200, WAX_L = 200000;
const UA_COIL = 150, UA_CHIM = 4, UA_COOL = 50, RTH = 0.025, THROTTLE = 85, HVAP = 2.26e6;
const WAX = { c22: 44, c24: 51, c28: 61 };
const P = { power: 700, ambient: 25, wax: 'c24', speed: 20, playing: !reduceMotion, fanBroken: false, burst: 0 };

function slurry(h, tm) {
  const h1 = CP * (tm - HALF), h2 = h1 + LPHI + CP * 2 * HALF;
  if (h <= h1) return [h / CP, 0];
  if (h < h2) { const m = (h - h1) / (h2 - h1); return [tm - HALF + 2 * HALF * m, m]; }
  return [tm + HALF + (h - h2) / CP, 1];
}
const BHALF = 0.5; // bulk wax melts over a narrower range than the beads
function block(h, tm) {
  const h1 = WAX_CP * (tm - BHALF), h2 = h1 + WAX_L + WAX_CP * 2 * BHALF;
  if (h <= h1) return [h / WAX_CP, 0];
  if (h < h2) { const m = (h - h1) / (h2 - h1); return [tm - BHALF + 2 * BHALF * m, m]; }
  return [tm + BHALF + (h - h2) / WAX_CP, 1];
}

/* ---------- layout ---------- */
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PLATE = { x0: -3.9, x1: -2.1, y: 1.24, z0: 0.85, z1: 2.15 };
const BOX = { x: 0.5, z: -0.5, s: 2.2, y0: 0.1 };
const BOXC = V(BOX.x, BOX.y0 + BOX.s / 2, BOX.z);
const CHIM = { r: 0.42, y1: 6.4 };
const COOL = { x0: 4.4, x1: 6.6, y0: 0.7, y1: 2.7, z0: -2.5, z1: -1.1 };
const F = 0.5;

const raw = [];
const add = (p, tag = 'pipe') => raw.push({ p, tag });
// cool supply to the cold plate
add(V(3.3, F, 2.6), 'supply');
add(V(1.9, F, 2.6), 'supply');
add(V(-1.2, F, 2.6), 'supply');
add(V(-1.2, PLATE.y, 2.6), 'supply');
add(V(PLATE.x1, PLATE.y, 2.6), 'supply');
// serpentine across the cold plate
const rows = [2.05, 1.7, 1.35, 1.0];
rows.forEach((z, i) => {
  const a = i % 2 === 0 ? PLATE.x1 - 0.1 : PLATE.x0 + 0.1, b = i % 2 === 0 ? PLATE.x0 + 0.1 : PLATE.x1 - 0.1;
  add(V(a, PLATE.y, z), 'gpu'); add(V(b, PLATE.y, z), 'gpu');
});
// to the sealed container, then a coil inside it
add(V(PLATE.x1 - 0.1, PLATE.y, 0.45));
add(V(-1.1, PLATE.y, 0.45));
add(V(-1.1, 0.45, BOX.z));
add(V(BOX.x - 0.75, 0.45, BOX.z), 'box');
{
  const turns = 4, steps = 72, r = 0.72;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, a = Math.PI * 1.5 + t * turns * Math.PI * 2;
    add(V(BOX.x + r * Math.cos(a), 0.45 + t * 1.6, BOX.z + r * Math.sin(a)), 'box');
  }
}
add(V(BOX.x + 1.4, 2.05, BOX.z), 'return');
// warm return to the dry cooler
add(V(2.7, 2.05, BOX.z), 'return');
add(V(2.7, 2.35, -1.8), 'return');
add(V(COOL.x0 + 0.15, 2.35, -1.8), 'cooler');
[2.35, 1.95, 1.55, 1.15].forEach((y, i) => {
  const a = i % 2 === 0 ? COOL.x0 + 0.15 : COOL.x1 - 0.15, b = i % 2 === 0 ? COOL.x1 - 0.15 : COOL.x0 + 0.15;
  if (i > 0) add(V(a, y, -1.8), 'cooler');
  add(V(b, y, -1.8), i === 3 ? 'pipe' : 'cooler');
});
add(V(4.0, 1.15, -1.8), 'supply');
add(V(4.0, F, -1.8), 'supply');
add(V(4.0, F, 2.6), 'supply');

function buildPath(pts) {
  const n = pts.length, out = [], R = 0.22;
  for (let i = 0; i < n; i++) {
    const pi = (i - 1 + n) % n, prev = pts[pi].p, cur = pts[i].p, next = pts[(i + 1) % n].p;
    const a = prev.clone().sub(cur), b = next.clone().sub(cur);
    const r = Math.min(R, a.length() * 0.45, b.length() * 0.45);
    if (a.angleTo(b) > Math.PI * 0.97 || r < 0.02) { out.push({ p: cur.clone(), tag: pts[i].tag }); continue; }
    const p0 = cur.clone().add(a.normalize().multiplyScalar(r)), p2 = cur.clone().add(b.normalize().multiplyScalar(r));
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, u = 1 - t;
      out.push({ p: p0.clone().multiplyScalar(u * u).add(cur.clone().multiplyScalar(2 * u * t)).add(p2.clone().multiplyScalar(t * t)), tag: k < 3 ? pts[pi].tag : pts[i].tag });
    }
  }
  const dense = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[i], b = out[(i + 1) % out.length], k = Math.max(1, Math.ceil(a.p.distanceTo(b.p) / 0.06));
    for (let j = 0; j < k; j++) dense.push({ p: a.p.clone().lerp(b.p, j / k), tag: a.tag });
  }
  const cum = new Float64Array(dense.length + 1);
  for (let i = 0; i < dense.length; i++) cum[i + 1] = cum[i] + dense[i].p.distanceTo(dense[(i + 1) % dense.length].p);
  return { dense, cum, total: cum[dense.length] };
}
const PATH = buildPath(raw);
const TAGS = ['pipe', 'gpu', 'box', 'cooler', 'supply', 'return'];
const Z_GPU = 1, Z_BOX = 2, Z_COOL = 3;
const tagIdx = PATH.dense.map((d) => TAGS.indexOf(d.tag));
function sample(u, out) {
  const s = u * PATH.total, cum = PATH.cum;
  let lo = 0, hi = PATH.dense.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
  const a = PATH.dense[lo].p, b = PATH.dense[(lo + 1) % PATH.dense.length].p, seg = cum[lo + 1] - cum[lo];
  out.copy(a).lerp(b, seg > 0 ? (s - cum[lo]) / seg : 0);
  return tagIdx[lo];
}

/* ---------- state ---------- */
const S = {
  phase: 0, h: new Float64Array(N), zone: new Int8Array(N), prevZone: new Int8Array(N),
  pos: Array.from({ length: N }, () => new THREE.Vector3()),
  hw: 0, time: 0, water: 0, fan: 0.5, meltOut: 0, tSupply: 25, qCool: 0, qChim: 0, gpu: 25, warm: 0,
};
const uOf = (i) => (i / N + S.phase) % 1;
function resetSim() {
  S.phase = 0;
  // start near normal running: slurry about 6 °C and the wax box 2 °C below the melting point
  const tm = WAX[P.wax], t0 = Math.max(P.ambient, tm - 6);
  for (let i = 0; i < N; i++) { S.h[i] = CP * t0; S.zone[i] = S.prevZone[i] = sample(uOf(i), S.pos[i]); }
  S.hw = WAX_CP * Math.max(P.ambient, tm - 2); S.time = 0; S.water = 0; S.fan = 0.5; S.meltOut = 0; S.tSupply = t0;
  S.qCool = 0; S.qChim = 0; S.warm = 0; P.burst = 0;
}
const power = () => (P.burst > 0 ? 1200 : P.power);

function stepSim(dt) {
  const tm = WAX[P.wax], Q = power();
  S.phase = (S.phase + dt / TAU) % 1;
  let nG = 0, nB = 0, nC = 0;
  for (let i = 0; i < N; i++) {
    S.prevZone[i] = S.zone[i]; S.zone[i] = sample(uOf(i), S.pos[i]);
    if (S.zone[i] === Z_GPU) nG++; else if (S.zone[i] === Z_BOX) nB++; else if (S.zone[i] === Z_COOL) nC++;
  }
  const Tw = block(S.hw, tm)[0];
  let qCoil = 0, qCool = 0;
  const fanUA = P.fanBroken ? UA_COOL * 0.06 : UA_COOL * S.fan; // a stopped fan still loses a little heat
  for (let i = 0; i < N; i++) {
    const z = S.zone[i];
    if (z === Z_GPU) S.h[i] += (Q / nG) * dt / MCELL;
    else if (z === Z_BOX) { const q = (UA_COIL / nB) * (slurry(S.h[i], tm)[0] - Tw); S.h[i] -= q * dt / MCELL; qCoil += q; }
    else if (z === Z_COOL) { const q = (fanUA / nC) * (slurry(S.h[i], tm)[0] - P.ambient); S.h[i] -= q * dt / MCELL; qCool += q; }
    if (S.prevZone[i] === Z_GPU && z !== Z_GPU) S.meltOut += (slurry(S.h[i], tm)[1] - S.meltOut) * 0.2;
    if (S.prevZone[i] === Z_COOL && z !== Z_COOL) S.tSupply += (slurry(S.h[i], tm)[0] - S.tSupply) * 0.2;
  }
  const qChim = UA_CHIM * (Tw - P.ambient);
  S.hw += (qCoil - qChim) * dt / WAX_KG;
  const k = 1 - Math.exp(-dt / 4);
  S.qCool += (qCool - S.qCool) * k; S.qChim += (qChim - S.qChim) * k;
  const want = Q / (UA_COOL * Math.max(1, tm - 2 - P.ambient)) * 1.1 + 0.03 * (S.tSupply - (tm - 6));
  S.fan += (Math.min(1, Math.max(0.1, want)) - S.fan) * (1 - Math.exp(-dt / 10));
  if (P.burst > 0) P.burst = Math.max(0, P.burst - dt);
  S.time += dt; S.warm += dt; S.water += Q * dt / HVAP;
}
function chipTemp() {
  const tm = WAX[P.wax]; let max = -Infinity;
  for (let i = 0; i < N; i++) if (S.zone[i] === Z_GPU) max = Math.max(max, slurry(S.h[i], tm)[0]);
  S.gpu = (max === -Infinity ? P.ambient : max) + power() * RTH;
}

/* ---------- scene ---------- */
const stage = $('#stage'), msg = $('#stage-msg');
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true }); if (!renderer.getContext()) throw new Error('no context'); }
catch (e) { msg.textContent = "This browser can't draw 3D graphics. Try Chrome or Edge with hardware acceleration turned on."; msg.dataset.state = 'error'; throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(C.ground);
stage.prepend(renderer.domElement); renderer.domElement.setAttribute('aria-hidden', 'true');

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(C.ground, 24, 44);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = !reduceMotion; controls.minDistance = 3; controls.maxDistance = 30; controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new THREE.HemisphereLight(C.ink, C.ground, 1.4));
const sun = new THREE.DirectionalLight(C.ink, 1.7); sun.position.set(5, 12, 9); scene.add(sun);
const fill = new THREE.DirectionalLight(C.cool, 0.35); fill.position.set(-8, 4, -6); scene.add(fill);
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2, ...extra });
const glass = (opacity = 0.14) => new THREE.MeshStandardMaterial({ color: C.cool, transparent: true, opacity, roughness: 0.1, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
const edges = (geo, pos) => { const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: C.rule2 })); l.position.copy(pos); scene.add(l); return l; };

const grid = new THREE.GridHelper(22, 22, C.rule, C.rule); grid.material.transparent = true; grid.material.opacity = 0.45; scene.add(grid);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat(C.ground, { roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; scene.add(floor);
addFloorWatermark(scene, { x: -5.2, z: -6.8, width: 6.2, opacity: 0.45 });

// GPU card
const card = new THREE.Group(); scene.add(card);
const pcb = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.1, 2.4), mat(C.pcb, { roughness: 0.6 })); pcb.position.set(-3.0, 0.75, 1.5); card.add(pcb);
for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.5), mat(C.metalDark)); m.position.set(-4.7 + (i % 4) * 0.42 + (i < 4 ? 0 : 2.9), 0.83, i < 4 ? 0.55 : 2.45); if (i >= 4) m.position.x = -4.7 + (i % 4) * 0.42 + 2.9; card.add(m); }
const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 2.4), mat(C.metal, { metalness: 0.7, roughness: 0.35 })); bracket.position.set(-5.33, 0.95, 1.5); card.add(bracket);
for (let i = 0; i < 4; i++) { const port = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.36), mat(C.metalDark)); port.position.set(-5.37, 0.95, 0.75 + i * 0.5); card.add(port); }
const edge = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.08), mat(C.amber, { metalness: 0.6 })); edge.position.set(-2.6, 0.62, 2.72); card.add(edge);
const dieMat = new THREE.MeshStandardMaterial({ color: C.metalDark, emissive: C.cool, emissiveIntensity: 0.9, roughness: 0.4 });
const die = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.9), dieMat); die.position.set(-3.0, 0.84, 1.5); card.add(die);
// cold plate: copper base with a clear lid so the serpentine shows
const plate = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.22, 1.6), mat(C.copper, { metalness: 0.75, roughness: 0.35 })); plate.position.set(-3.0, 0.99, 1.5); scene.add(plate);
const lid = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.32, 1.6), glass(0.12)); lid.position.set(-3.0, 1.26, 1.5); scene.add(lid);
edges(lid.geometry, lid.position);
for (const [x, z] of [[-3.95, 0.8], [-2.05, 0.8], [-3.95, 2.2], [-2.05, 2.2]]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 10), mat(C.metal, { metalness: 0.8 })); s.position.set(x, 1.05, z); scene.add(s); }

// sealed paraffin container
const boxGeo = new THREE.BoxGeometry(BOX.s, BOX.s, BOX.s);
const boxMesh = new THREE.Mesh(boxGeo, glass(0.1)); boxMesh.position.copy(BOXC); scene.add(boxMesh); edges(boxGeo, BOXC);
const waxSolid = new THREE.Mesh(new THREE.BoxGeometry(BOX.s - 0.12, 1, BOX.s - 0.12), mat(C.solid, { transparent: true, opacity: 0.35, depthWrite: false, roughness: 0.9 }));
const waxLiquid = new THREE.Mesh(new THREE.BoxGeometry(BOX.s - 0.12, 1, BOX.s - 0.12), mat(C.liquid, { transparent: true, opacity: 0.45, depthWrite: false, roughness: 0.2 }));
scene.add(waxSolid, waxLiquid);
const FILL = BOX.s - 0.35; // wax fill height, leaving headspace for expansion
function setWax(m) {
  const hL = Math.max(0.001, FILL * m), hS = Math.max(0.001, FILL * (1 - m));
  waxSolid.scale.y = hS; waxSolid.position.set(BOX.x, BOX.y0 + 0.06 + hS / 2, BOX.z);
  waxLiquid.scale.y = hL; waxLiquid.position.set(BOX.x, BOX.y0 + 0.06 + hS + hL / 2, BOX.z);
}
const finCount = 9;
const fins = new THREE.InstancedMesh(new THREE.BoxGeometry(BOX.s - 0.3, 0.02, BOX.s - 0.3), mat(C.metal, { metalness: 0.7, roughness: 0.4, transparent: true, opacity: 0.45, depthWrite: false }), finCount);
const m4 = new THREE.Matrix4();
for (let i = 0; i < finCount; i++) { m4.makeTranslation(BOX.x, 0.35 + i * 0.2, BOX.z); fins.setMatrixAt(i, m4); }
scene.add(fins);
// chimney
const chimH = CHIM.y1 - (BOX.y0 + BOX.s);
const chim = new THREE.Mesh(new THREE.CylinderGeometry(CHIM.r, CHIM.r, chimH, 40, 1, true), glass(0.12));
chim.position.set(BOX.x, BOX.y0 + BOX.s + chimH / 2, BOX.z); scene.add(chim);
for (const y of [BOX.y0 + BOX.s, CHIM.y1]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(CHIM.r, 0.03, 8, 40), mat(C.metal, { metalness: 0.6 })); ring.rotation.x = Math.PI / 2; ring.position.set(BOX.x, y, BOX.z); scene.add(ring); }

// dry cooler
const cw = COOL.x1 - COOL.x0, ch = COOL.y1 - COOL.y0, cd = COOL.z1 - COOL.z0;
const cc = V((COOL.x0 + COOL.x1) / 2, (COOL.y0 + COOL.y1) / 2, (COOL.z0 + COOL.z1) / 2);
edges(new THREE.BoxGeometry(cw, ch, cd), cc);
const cfCount = 26;
const cfins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.014, ch * 0.96, cd * 0.96), mat(C.metal, { metalness: 0.75, roughness: 0.35, transparent: true, opacity: 0.3, depthWrite: false }), cfCount);
for (let i = 0; i < cfCount; i++) { m4.makeTranslation(COOL.x0 + (i + 0.5) * cw / cfCount, cc.y, cc.z); cfins.setMatrixAt(i, m4); }
scene.add(cfins);
const shroud = new THREE.Mesh(new THREE.BoxGeometry(cw + 0.2, ch + 0.2, 0.22), mat(C.metalDark)); shroud.position.set(cc.x, cc.y, COOL.z0 - 0.15); scene.add(shroud);
const fan = new THREE.Group(); fan.position.set(cc.x, cc.y, COOL.z0 - 0.3); scene.add(fan);
for (let b = 0; b < 7; b++) { const h = new THREE.Group(); h.rotation.z = b * Math.PI * 2 / 7; const blade = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.24, 0.02), mat(C.muted)); blade.position.x = 0.48; blade.rotation.x = 0.4; h.add(blade); fan.add(h); }
const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 20), mat(C.metal)); hub.rotation.x = Math.PI / 2; fan.add(hub);
for (const [x, z] of [[COOL.x0, COOL.z0], [COOL.x1, COOL.z0], [COOL.x0, COOL.z1], [COOL.x1, COOL.z1]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, COOL.y0, 0.08), mat(C.metal)); leg.position.set(x, COOL.y0 / 2, z); scene.add(leg); }

// pipe: one tube, coloured along its length by the slurry temperature inside
const curve = new THREE.CatmullRomCurve3(PATH.dense.filter((_, i) => i % 2 === 0).map((d) => d.p), true, 'catmullrom', 0.05);
const RINGS = 1600, RADIAL = 10;
const tubeGeo = new THREE.TubeGeometry(curve, RINGS, 0.1, RADIAL, true);
const tubeCol = new Float32Array(tubeGeo.attributes.position.count * 3);
tubeGeo.setAttribute('color', new THREE.BufferAttribute(tubeCol, 3));
const tube = new THREE.Mesh(tubeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.38, roughness: 0.25, metalness: 0, depthWrite: false }));
scene.add(tube);

// beads
const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 12, 8), new THREE.MeshStandardMaterial({ roughness: 0.35 }), N);
beads.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(beads);

// air: warm air up the chimney, and through the dry cooler
function airCloud(n, size) {
  const m = new THREE.InstancedMesh(new THREE.SphereGeometry(size, 8, 6), new THREE.MeshBasicMaterial({ color: C.liquid, transparent: true, opacity: 0.4, depthWrite: false }), n);
  scene.add(m); return { m, p: Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0, v: 0, a: 0 })) };
}
const chimAir = airCloud(40, 0.05), coolAir = airCloud(50, 0.04);
function seedChim(a, init) { const r = Math.random() * (CHIM.r - 0.08), t = Math.random() * 6.28; a.x = BOX.x + r * Math.cos(t); a.z = BOX.z + r * Math.sin(t); a.y = BOX.y0 + BOX.s + (init ? Math.random() * chimH : 0); a.v = 0.6 + Math.random() * 0.5; a.a = t; }
function seedCool(a, init) { a.x = COOL.x0 + Math.random() * cw; a.y = COOL.y0 + Math.random() * ch; a.z = COOL.z0 - 0.3 + (init ? Math.random() * 1.6 : 0); a.v = 0.8 + Math.random() * 0.6; }
chimAir.p.forEach((a) => seedChim(a, true)); coolAir.p.forEach((a) => seedCool(a, true));

/* ---------- labels ---------- */
const anchors = {
  1: V(-3.0, 1.9, 2.5), 2: V(BOX.x - 0.3, BOX.y0 + BOX.s + 0.35, BOX.z + 1.4), 3: V(BOX.x, CHIM.y1 + 0.4, BOX.z), 4: V(cc.x, COOL.y1 + 0.5, cc.z),
  supply: V(0.4, F + 0.35, 2.6), return: V(2.7, 2.6, -1.1),
};
const labelEls = [...document.querySelectorAll('.tag, .place')];
const tv = new THREE.Vector3();
function placeLabels(w, h) {
  for (const el of labelEls) {
    tv.copy(anchors[el.dataset.step || el.dataset.at]).project(camera);
    const vis = tv.z < 1 && Math.abs(tv.x) < 1.05 && Math.abs(tv.y) < 1.05;
    el.style.visibility = vis ? 'visible' : 'hidden';
    el.style.transform = `translate(${((tv.x + 1) / 2 * w).toFixed(1)}px, ${((1 - tv.y) / 2 * h).toFixed(1)}px)`;
  }
}

/* ---------- views and steps ---------- */
const VIEWS = {
  0: { pos: V(6.0, 9.5, 14.0), at: V(1.0, 2.2, 0) },
  1: { pos: V(-1.2, 4.0, 6.2), at: V(-3.0, 1.0, 1.5) },
  2: { pos: V(3.6, 3.6, 4.4), at: V(0.5, 1.2, -0.5) },
  3: { pos: V(4.5, 5.2, 6.0), at: V(0.5, 4.0, -0.5) },
  4: { pos: V(8.6, 5.4, 3.4), at: V(5.3, 1.5, -1.9) },
};
const TEXT = {
  0: 'A fluid full of tiny paraffin wax beads flows around a closed loop. The beads melt where it is hot and freeze where it is cool, carrying heat away. Pick a step to look closer.',
  1: 'The cold plate is a copper block sitting on the GPU chip, with a winding channel inside. Solid wax beads flow through and melt, soaking up the chip\'s heat. The chip colour shows its temperature.',
  2: 'A sealed box holds 4 kg of paraffin around a copper coil with fins. Normally it stays solid. When the GPU makes extra heat, or the cooler fails, this wax melts and stores the heat so the chip stays safe.',
  3: 'Warm air rises out of the clear chimney above the wax box, letting a little heat escape to the outside on its own, with no fan and no water.',
  4: 'Outside, a fan blows air through thin metal fins around the pipe. The melted beads freeze again and give their heat to the air, then flow back to the cold plate as the cool supply. No water evaporates.',
};
let current = 0, fly = null, tourOn = false, tourTimer = 0, tourDriving = false;
function goTo(step) {
  current = step;
  document.querySelectorAll('[data-step]').forEach((el) => { if (+el.dataset.step === step) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current'); });
  $('#step-text').textContent = TEXT[step];
  const v = VIEWS[step];
  if (reduceMotion) { camera.position.copy(v.pos); controls.target.copy(v.at); controls.update(); fly = null; }
  else fly = { t: 0, fromP: camera.position.clone(), fromT: controls.target.clone(), toP: v.pos, toT: v.at };
  if (tourOn && !tourDriving) stopTour();
}
document.querySelectorAll('.step, .tag').forEach((el) => el.addEventListener('click', () => goTo(+el.dataset.step)));
$('#overview').addEventListener('click', () => goTo(0));
const tourBox = $('#tour');
function stopTour() { tourOn = false; tourBox.checked = false; }
tourBox.addEventListener('change', () => { tourOn = tourBox.checked; tourTimer = 0; if (tourOn) { tourDriving = true; goTo(current >= 4 || current === 0 ? 1 : current + 1); tourDriving = false; } });
controls.addEventListener('start', () => { fly = null; if (tourOn) stopTour(); });

/* ---------- controls ---------- */
const fmt = (n, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
$('#power').addEventListener('input', (e) => { P.power = +e.target.value; $('#power-out').textContent = `${fmt(P.power)} W`; });
$('#ambient').addEventListener('input', (e) => { P.ambient = +e.target.value; $('#ambient-out').textContent = `${P.ambient} °C`; });
document.querySelectorAll('input[name="wax"]').forEach((r) => r.addEventListener('change', () => { P.wax = r.value; }));
document.querySelectorAll('input[name="speed"]').forEach((r) => r.addEventListener('change', () => { P.speed = +r.value; }));
$('#fanoff').addEventListener('change', (e) => { P.fanBroken = e.target.checked; });
const burstBtn = $('#burst');
burstBtn.addEventListener('click', () => { P.burst = 120; });
const playBtn = $('#play');
function setPlaying(on) { P.playing = on; playBtn.textContent = on ? 'Pause' : 'Play'; playBtn.setAttribute('aria-pressed', String(on)); }
playBtn.addEventListener('click', () => setPlaying(!P.playing));
$('#reset').addEventListener('click', () => { resetSim(); });
setPlaying(P.playing);

/* ---------- readings ---------- */
const clock = (s) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, Math.floor(s) % 60].map((v) => String(v).padStart(2, '0')).join(':');
const statusEl = $('#r-status'), warnEl = $('#warn');
let lastText = 0;
function updateReadings() {
  const now = performance.now(); if (now - lastText < 200) return; lastText = now;
  const tm = WAX[P.wax], bm = block(S.hw, tm)[1];
  $('#r-gpu').textContent = `${fmt(S.gpu, 1)} °C`;
  $('#r-block').textContent = `${fmt(bm * 100)} %`;
  $('#r-melt').textContent = `${fmt(S.meltOut * 100)} %`;
  $('#r-supply').textContent = `${fmt(S.tSupply, 1)} °C`;
  $('#r-cooler').textContent = `${fmt(Math.max(0, S.qCool))} W`;
  $('#r-chim').textContent = `${fmt(Math.max(0, S.qChim))} W`;
  $('#r-fan').textContent = P.fanBroken ? 'Broken' : `${fmt(S.fan * 100)} %`;
  $('#r-time').textContent = clock(S.time);
  $('#w-tower').textContent = `${fmt(S.water, S.water < 100 ? 2 : 0)} L`;
  burstBtn.disabled = P.burst > 0;
  burstBtn.textContent = P.burst > 0 ? `Burst running, ${Math.ceil(P.burst)} s left` : 'AI burst, 1,200 W for 2 min';
  if (S.warm < TAU * 2) { statusEl.textContent = 'Warming up'; statusEl.dataset.state = ''; }
  else if (S.gpu > THROTTLE) { statusEl.textContent = 'Too hot, the chip slows down'; statusEl.dataset.state = 'bad'; }
  else { statusEl.textContent = `Safe, below the ${THROTTLE} °C limit`; statusEl.dataset.state = 'ok'; }
  let warn = '';
  if (P.fanBroken && bm < 0.98) warn = `The fan is broken. The wax in the box is melting to soak up the heat: ${fmt(bm * 100)}% melted so far.`;
  else if (P.fanBroken) warn = 'The wax in the box has fully melted, so it can\'t store any more heat. Fix the fan.';
  else if (S.warm > TAU * 2 && S.gpu > THROTTLE && P.ambient > tm - 12) warn = 'The outside air is too warm to freeze this wax again. Try a wax that melts at a higher temperature.';
  else if (S.warm > TAU * 2 && S.gpu > THROTTLE) warn = 'The chip is too hot. Try less power or a wax that melts at a lower temperature.';
  warnEl.hidden = !warn; warnEl.textContent = warn;
}

/* ---------- frame ---------- */
const col = new THREE.Color(), dummy = new THREE.Object3D();
function heatColour(T, out) {
  if (T <= 45) return out.copy(C.cool);
  if (T <= 68) return out.copy(C.cool).lerp(C.amber, (T - 45) / 23);
  return out.copy(C.amber).lerp(C.hot, Math.min(1, (T - 68) / 17));
}
function pipeColour(T, tm, out) { return out.copy(C.cool).lerp(C.hot, Math.min(1, Math.max(0, (T - (tm - 9)) / 14))); }
function resize() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(stage);

let lastT = performance.now(), first = true;
const cellT = new Float32Array(N);
function frame() {
  const now = performance.now(), dt = Math.min((now - lastT) / 1000, 0.1); lastT = now;
  if (P.playing) { let sim = dt * P.speed; while (sim > 0) { const d = Math.min(sim, 0.05); stepSim(d); sim -= d; } }
  chipTemp();
  const tm = WAX[P.wax];
  for (let i = 0; i < N; i++) {
    const [T, m] = slurry(S.h[i], tm); cellT[i] = T;
    dummy.position.copy(S.pos[i]); dummy.updateMatrix(); beads.setMatrixAt(i, dummy.matrix);
    beads.setColorAt(i, col.copy(C.solid).lerp(C.liquid, m));
  }
  beads.instanceMatrix.needsUpdate = true; beads.instanceColor.needsUpdate = true;
  // tube colour by the temperature of the parcel at each ring
  const per = RADIAL + 1;
  for (let r = 0; r <= RINGS; r++) {
    const u = (r / RINGS) % 1;
    const i = Math.floor((((u - S.phase) % 1 + 1) % 1) * N) % N;
    pipeColour(cellT[i], tm, col);
    for (let k = 0; k < per; k++) { const v = (r * per + k) * 3; tubeCol[v] = col.r; tubeCol[v + 1] = col.g; tubeCol[v + 2] = col.b; }
  }
  tubeGeo.attributes.color.needsUpdate = true;
  heatColour(S.gpu, dieMat.emissive);
  setWax(block(S.hw, tm)[1]);

  const run = P.playing && !reduceMotion;
  if (run) {
    const spin = dt * Math.min(P.speed, 5);
    if (!P.fanBroken) fan.rotation.z += spin * 10 * S.fan;
    const chimRate = Math.max(0, Math.min(1, S.qChim / 150)), coolRate = P.fanBroken ? 0 : Math.max(0, Math.min(1, S.qCool / 900));
    chimAir.m.material.opacity = 0.08 + 0.5 * chimRate; coolAir.m.material.opacity = 0.05 + 0.4 * coolRate;
    chimAir.p.forEach((a, i) => { a.y += a.v * spin * 0.5; if (a.y > CHIM.y1 + 1.2) seedChim(a, false); dummy.position.set(a.x + Math.sin(a.y * 3 + i) * 0.04, a.y, a.z); dummy.updateMatrix(); chimAir.m.setMatrixAt(i, dummy.matrix); });
    coolAir.p.forEach((a, i) => { a.z += a.v * spin * (0.3 + coolRate); a.y += spin * 0.15; if (a.z > COOL.z1 + 1.2) seedCool(a, false); dummy.position.set(a.x, a.y, a.z); dummy.updateMatrix(); coolAir.m.setMatrixAt(i, dummy.matrix); });
    chimAir.m.instanceMatrix.needsUpdate = true; coolAir.m.instanceMatrix.needsUpdate = true;
  }
  if (tourOn) { tourTimer += dt; if (tourTimer > 9) { tourTimer = 0; tourDriving = true; goTo(current >= 4 ? 1 : current + 1); tourDriving = false; } }
  if (fly) {
    fly.t = Math.min(1, fly.t + dt / 1.4); const e = 1 - Math.pow(1 - fly.t, 3);
    camera.position.lerpVectors(fly.fromP, fly.toP, e); controls.target.lerpVectors(fly.fromT, fly.toT, e);
    if (fly.t >= 1) fly = null;
  }
  controls.update();
  renderer.render(scene, camera);
  placeLabels(stage.clientWidth, stage.clientHeight);
  updateReadings();
  if (first) { first = false; msg.hidden = true; }
  requestAnimationFrame(frame);
}

resetSim();
for (let i = 0; i < N; i++) beads.setColorAt(i, C.solid);
chimAir.p.forEach((a, i) => { dummy.position.set(a.x, a.y, a.z); dummy.updateMatrix(); chimAir.m.setMatrixAt(i, dummy.matrix); });
coolAir.p.forEach((a, i) => { dummy.position.set(a.x, a.y, a.z); dummy.updateMatrix(); coolAir.m.setMatrixAt(i, dummy.matrix); });
camera.position.copy(VIEWS[0].pos); controls.target.copy(VIEWS[0].at); controls.update();
resize();
goTo(0); fly = null;
requestAnimationFrame(frame);
globalThis.__gpu = { S, P };
