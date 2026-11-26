// Paraffin MPCM cooling loop: 3D model + simple physics.
// The wax beads you see ARE the simulation: each bead is one parcel of slurry
// carrying its own heat (enthalpy). Colour = how melted its wax is.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const $ = (s) => document.querySelector(s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- colours from CSS tokens ---------- */
const rootStyle = getComputedStyle(document.documentElement);
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function tok(name) {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = rootStyle.getPropertyValue(name).trim();
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return new THREE.Color().setRGB(d[0] / 255, d[1] / 255, d[2] / 255, THREE.SRGBColorSpace);
}
const C = {
  ground: tok('--scene-ground'), outside: tok('--scene-outside'),
  rule: tok('--color-rule'), rule2: tok('--color-rule-2'),
  metal: tok('--scene-metal'), metalDark: tok('--scene-metal-dark'),
  ink: tok('--color-ink'), muted: tok('--color-muted'),
  solid: tok('--scene-wax-solid'), liquid: tok('--scene-wax-liquid'),
  cool: tok('--color-cool'), amber: tok('--color-accent'), hot: tok('--scene-hot'),
  paper2: tok('--color-paper-2'),
};

/* ---------- physics constants (also listed in the page) ---------- */
const GPUS = 72, TRAYS = 18;
const N = 320;              // slurry parcels (= beads drawn)
const TAU = 40;             // seconds for one lap of the loop
const MDOT = 1.0;           // kg/s
const MCELL = MDOT * TAU / N;
const CP = 1900;            // J/kg.K slurry
const LPHI = 0.20 * 200000; // J/kg slurry: 20% paraffin x 200 kJ/kg
const HALF = 1.5;           // melting range half-width, K
const UA = 4000;            // W/K dry cooler
const RTH = 0.030;          // K/W chip above fluid
const THROTTLE = 85;
const HVAP = 2.26e6;        // J/kg water evaporation
const WAX = { c22: 44, c24: 51, c28: 61 };

const P = { perGpu: 700, ambient: 25, wax: 'c24', speed: 1, playing: !reduceMotion };

function stateOf(h, tm) {
  const h1 = CP * (tm - HALF), h2 = h1 + LPHI + CP * 2 * HALF;
  if (h <= h1) return [h / CP, 0];
  if (h < h2) { const m = (h - h1) / (h2 - h1); return [tm - HALF + 2 * HALF * m, m]; }
  return [tm + HALF + (h - h2) / CP, 1];
}

/* ---------- the loop path ---------- */
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const RACK = { x: -6, z: 0 }, MANI = { x: -6, z: -1.45 };
const TANK = { x: -1.5, z: 0, r: 0.9, y0: 0.35, y1: 3.35 };
const COOL = { x0: 4.0, x1: 8.0, y0: 0.95, y1: 2.65, z0: -1.0, z1: 1.0 };
const PUMP = V(0.6, 0.35, 2.4);
const WALL_X = 2.6, FLOOR = 0.35;

// [point, tag of the segment that starts here]
const raw = [];
const add = (p, tag = 'pipe') => raw.push({ p, tag });
add(V(MANI.x, FLOOR, MANI.z), 'gpu');
add(V(MANI.x, 4.75, MANI.z));
add(V(MANI.x, 5.5, MANI.z));
add(V(TANK.x, 5.5, MANI.z));
add(V(TANK.x, 5.5, TANK.z));
add(V(TANK.x, 3.25, TANK.z), 'tank');
{ // helix inside the tank
  const turns = 3, steps = 54, r = 0.55;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, a = t * turns * Math.PI * 2;
    add(V(TANK.x + r * Math.sin(a), 3.15 - t * 2.55, TANK.z + r * Math.cos(a)), i === steps ? 'pipe' : 'tank');
  }
}
add(V(TANK.x, FLOOR, TANK.z));
add(V(TANK.x, FLOOR, -0.6));
add(V(3.5, FLOOR, -0.6));
add(V(3.5, 2.4, -0.6), 'cooler');
add(V(4.2, 2.4, -0.6), 'cooler');
add(V(7.8, 2.4, -0.6), 'cooler');
add(V(7.8, 2.0, -0.2), 'cooler');
add(V(4.2, 2.0, -0.2), 'cooler');
add(V(4.2, 1.6, 0.2), 'cooler');
add(V(7.8, 1.6, 0.2), 'cooler');
add(V(7.8, 1.2, 0.6), 'cooler');
add(V(4.2, 1.2, 0.6));
add(V(3.5, 1.2, 0.6));
add(V(3.5, FLOOR, 0.6));
add(V(3.5, FLOOR, PUMP.z));
add(V(PUMP.x + 0.7, FLOOR, PUMP.z), 'pump');
add(V(PUMP.x - 0.7, FLOOR, PUMP.z));
add(V(-4.4, FLOOR, PUMP.z));
add(V(-4.4, FLOOR, MANI.z));
// closes back to the first point

// round the corners, then resample evenly
function buildPath(pts) {
  const n = pts.length, out = [];
  const R = 0.28;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n].p, cur = pts[i].p, next = pts[(i + 1) % n].p;
    const a = prev.clone().sub(cur), b = next.clone().sub(cur);
    const la = a.length(), lb = b.length();
    const r = Math.min(R, la * 0.45, lb * 0.45);
    if (a.angleTo(b) > Math.PI * 0.97 || r < 0.02) { out.push({ p: cur.clone(), tag: pts[i].tag, tagIn: pts[(i - 1 + n) % n].tag }); continue; }
    const p0 = cur.clone().add(a.normalize().multiplyScalar(r));
    const p2 = cur.clone().add(b.normalize().multiplyScalar(r));
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, u = 1 - t;
      const q = p0.clone().multiplyScalar(u * u).add(cur.clone().multiplyScalar(2 * u * t)).add(p2.clone().multiplyScalar(t * t));
      out.push({ p: q, tag: k < 3 ? pts[(i - 1 + n) % n].tag : pts[i].tag });
    }
  }
  // resample to spacing ~0.08
  const dense = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[i], b = out[(i + 1) % out.length];
    const len = a.p.distanceTo(b.p), k = Math.max(1, Math.ceil(len / 0.08));
    for (let j = 0; j < k; j++) dense.push({ p: a.p.clone().lerp(b.p, j / k), tag: a.tag });
  }
  const cum = new Float64Array(dense.length + 1);
  for (let i = 0; i < dense.length; i++) cum[i + 1] = cum[i] + dense[i].p.distanceTo(dense[(i + 1) % dense.length].p);
  return { dense, cum, total: cum[dense.length] };
}
const PATH = buildPath(raw);
const TAGS = ['pipe', 'gpu', 'tank', 'cooler', 'pump'];
const tagIdx = PATH.dense.map((d) => TAGS.indexOf(d.tag));

function sample(u, out) {
  const s = u * PATH.total, cum = PATH.cum;
  let lo = 0, hi = PATH.dense.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
  const a = PATH.dense[lo].p, b = PATH.dense[(lo + 1) % PATH.dense.length].p;
  const seg = cum[lo + 1] - cum[lo];
  out.copy(a).lerp(b, seg > 0 ? (s - cum[lo]) / seg : 0);
  return tagIdx[lo];
}

/* ---------- simulation state ---------- */
const S = {
  u: new Float64Array(N), h: new Float64Array(N), zone: new Int8Array(N), prevZone: new Int8Array(N),
  pos: Array.from({ length: N }, () => new THREE.Vector3()),
  time: 0, water: 0, fan: 0.5, meltOut: 0, frozenOut: 1, tReturn: 0, qAir: 0, gpuMax: 0, trayT: new Float64Array(TRAYS), warm: 0,
};
function resetSim() {
  for (let i = 0; i < N; i++) {
    S.u[i] = i / N;
    S.h[i] = CP * P.ambient;
    S.zone[i] = S.prevZone[i] = sample(S.u[i], S.pos[i]);
  }
  S.time = 0; S.water = 0; S.fan = 0.5; S.meltOut = 0; S.frozenOut = 1; S.tReturn = P.ambient; S.qAir = 0; S.warm = 0;
}

const Z_GPU = 1, Z_TANK = 2, Z_COOL = 3;
function stepSim(dt) {
  const tm = WAX[P.wax], Q = GPUS * P.perGpu;
  let nG = 0, nC = 0, nT = 0;
  for (let i = 0; i < N; i++) {
    S.u[i] = (S.u[i] + dt / TAU) % 1;
    S.prevZone[i] = S.zone[i];
    S.zone[i] = sample(S.u[i], S.pos[i]);
    if (S.zone[i] === Z_GPU) nG++; else if (S.zone[i] === Z_COOL) nC++; else if (S.zone[i] === Z_TANK) nT++;
  }
  // the tank stirs: parcels inside it share heat, which evens out hot and cold slugs
  if (nT) { let avg = 0; for (let i = 0; i < N; i++) if (S.zone[i] === Z_TANK) avg += S.h[i]; avg /= nT;
    const r = 1 - Math.exp(-dt / 6); for (let i = 0; i < N; i++) if (S.zone[i] === Z_TANK) S.h[i] += (avg - S.h[i]) * r; }
  const qCell = nG ? Q / nG : 0, ua = nC ? UA * S.fan / nC : 0;
  let qAir = 0;
  const k = 1 - Math.exp(-dt / 6); // smoothing for readings
  for (let i = 0; i < N; i++) {
    if (S.zone[i] === Z_GPU) S.h[i] += qCell * dt / MCELL;
    else if (S.zone[i] === Z_COOL) {
      const T = stateOf(S.h[i], tm)[0];
      const q = ua * (T - P.ambient);
      S.h[i] -= q * dt / MCELL; qAir += q;
    }
    if (S.prevZone[i] === Z_GPU && S.zone[i] !== Z_GPU) S.meltOut += (stateOf(S.h[i], tm)[1] - S.meltOut) * 0.25;
    if (S.prevZone[i] === Z_COOL && S.zone[i] !== Z_COOL) {
      const [T, m] = stateOf(S.h[i], tm);
      S.frozenOut += ((1 - m) - S.frozenOut) * 0.25;
      S.tReturn += (T - S.tReturn) * 0.25;
    }
  }
  S.qAir += (qAir - S.qAir) * k;
  // fan control: set from the known heat load (feed-forward), trimmed by the return temperature,
  // aiming to send slurry back about 6 °C below the melting point. Smoothed so it doesn't hunt.
  const want = Q / (UA * Math.max(1, tm - 2 - P.ambient)) * 1.15 + 0.03 * (S.tReturn - (tm - 6));
  S.fan += (Math.min(1, Math.max(0.1, want)) - S.fan) * (1 - Math.exp(-dt / 15));
  S.time += dt; S.warm += dt;
  S.water += Q * dt / HVAP;
}

// chip temperature for each tray = fluid under it + P x Rth
function trayTemps() {
  const tm = WAX[P.wax];
  let max = -Infinity;
  for (let t = 0; t < TRAYS; t++) {
    const y = trayY(t);
    let best = Infinity, T = P.ambient;
    for (let i = 0; i < N; i++) {
      if (S.zone[i] !== Z_GPU) continue;
      const d = Math.abs(S.pos[i].y - y);
      if (d < best) { best = d; T = stateOf(S.h[i], tm)[0]; }
    }
    S.trayT[t] = T + P.perGpu * RTH;
    if (S.trayT[t] > max) max = S.trayT[t];
  }
  S.gpuMax = max;
}
function trayY(t) { return 0.62 + t * 0.225; }

/* ---------- three.js scene ---------- */
const stage = $('#stage'), msg = $('#stage-msg');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  if (!renderer.getContext()) throw new Error('no context');
} catch (e) {
  msg.textContent = "This browser can't draw 3D graphics. Try Chrome or Edge with hardware acceleration turned on.";
  msg.dataset.state = 'error';
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(C.ground);
stage.prepend(renderer.domElement);
renderer.domElement.setAttribute('aria-hidden', 'true');

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(C.ground, 26, 48);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = !reduceMotion;
controls.minDistance = 4; controls.maxDistance = 34;
controls.maxPolarAngle = Math.PI * 0.49;

scene.add(new THREE.HemisphereLight(C.ink, C.ground, 1.4));
const sun = new THREE.DirectionalLight(C.ink, 1.6); sun.position.set(6, 12, 8); scene.add(sun);
const fill = new THREE.DirectionalLight(C.cool, 0.35); fill.position.set(-10, 4, -6); scene.add(fill);

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2, ...extra });

// floors: inside and outside
const floorIn = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), mat(C.ground, { roughness: 1 }));
floorIn.rotation.x = -Math.PI / 2; floorIn.position.set(WALL_X - 7, 0, 0.5); scene.add(floorIn);
const floorOut = new THREE.Mesh(new THREE.PlaneGeometry(9, 10), mat(C.outside, { roughness: 1 }));
floorOut.rotation.x = -Math.PI / 2; floorOut.position.set(WALL_X + 4.5, 0, 0.5); scene.add(floorOut);
const grid = new THREE.GridHelper(24, 24, C.rule, C.rule); grid.position.set(0.6, 0.002, 0.5);
grid.material.transparent = true; grid.material.opacity = 0.5; scene.add(grid);

// building wall (glass-like so you can see through)
const wall = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.2, 10), mat(C.rule2, { transparent: true, opacity: 0.18, depthWrite: false }));
wall.position.set(WALL_X, 1.6, 0.5); scene.add(wall);
const wallEdge = new THREE.LineSegments(new THREE.EdgesGeometry(wall.geometry), new THREE.LineBasicMaterial({ color: C.rule2 }));
wallEdge.position.copy(wall.position); scene.add(wallEdge);

// pipe
const curve = new THREE.CatmullRomCurve3(PATH.dense.filter((_, i) => i % 2 === 0).map((d) => d.p), true, 'catmullrom', 0.05);
const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 1400, 0.13, 12, true),
  new THREE.MeshStandardMaterial({ color: C.cool, transparent: true, opacity: 0.16, roughness: 0.2, metalness: 0, depthWrite: false }));
scene.add(tube);

// rack
const rack = new THREE.Group(); rack.position.set(RACK.x, 0, RACK.z); scene.add(rack);
const rackBox = new THREE.BoxGeometry(2.1, 5.0, 2.6);
const rackShell = new THREE.Mesh(rackBox, mat(C.metalDark, { transparent: true, opacity: 0.22, depthWrite: false }));
rackShell.position.y = 2.5; rack.add(rackShell);
const rackEdges = new THREE.LineSegments(new THREE.EdgesGeometry(rackBox), new THREE.LineBasicMaterial({ color: C.rule2 }));
rackEdges.position.y = 2.5; rack.add(rackEdges);
const trayGeo = new THREE.BoxGeometry(1.9, 0.11, 2.3), trayMat = mat(C.metalDark, { metalness: 0.5 });
const chipGeo = new THREE.BoxGeometry(0.34, 0.05, 0.34);
const chipMats = [];
const stripGeo = new THREE.BoxGeometry(1.5, 0.05, 0.02);
const branchGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6);
for (let t = 0; t < TRAYS; t++) {
  const y = trayY(t);
  const tray = new THREE.Mesh(trayGeo, trayMat); tray.position.set(0, y, 0); rack.add(tray);
  const cm = new THREE.MeshStandardMaterial({ color: C.metalDark, emissive: C.cool, emissiveIntensity: 0.6, roughness: 0.5 });
  chipMats.push(cm);
  for (let g = 0; g < 4; g++) {
    const chip = new THREE.Mesh(chipGeo, cm);
    chip.position.set(-0.6 + g * 0.4, y + 0.08, 0.55);
    rack.add(chip);
  }
  const strip = new THREE.Mesh(stripGeo, cm); strip.position.set(0, y, 1.16); rack.add(strip);
  const br = new THREE.Mesh(branchGeo, mat(C.metal)); br.rotation.x = Math.PI / 2;
  br.position.set(0, y, -1.25); rack.add(br);
}

// tank
const tankGeo = new THREE.CylinderGeometry(TANK.r, TANK.r, TANK.y1 - TANK.y0 + 0.2, 40, 1, true);
const tankMesh = new THREE.Mesh(tankGeo, new THREE.MeshStandardMaterial({ color: C.cool, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, roughness: 0.1 }));
tankMesh.position.set(TANK.x, (TANK.y0 + TANK.y1) / 2, TANK.z); scene.add(tankMesh);
for (const y of [TANK.y0 - 0.1, TANK.y1 + 0.1]) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(TANK.r, 0.04, 8, 48), mat(C.metal, { metalness: 0.6 }));
  ring.rotation.x = Math.PI / 2; ring.position.set(TANK.x, y, TANK.z); scene.add(ring);
}
const lid = new THREE.Mesh(new THREE.CircleGeometry(TANK.r, 40), mat(C.metalDark, { side: THREE.DoubleSide }));
lid.rotation.x = -Math.PI / 2; lid.position.set(TANK.x, TANK.y1 + 0.1, TANK.z); scene.add(lid);

// dry cooler
const cooler = new THREE.Group(); scene.add(cooler);
const cw = COOL.x1 - COOL.x0 + 0.6, ch = COOL.y1 - COOL.y0, cd = COOL.z1 - COOL.z0 + 0.4;
const cBox = new THREE.BoxGeometry(cw, ch, cd);
const cEdges = new THREE.LineSegments(new THREE.EdgesGeometry(cBox), new THREE.LineBasicMaterial({ color: C.rule2 }));
const cCenter = V((COOL.x0 + COOL.x1) / 2, (COOL.y0 + COOL.y1) / 2, 0);
cEdges.position.copy(cCenter); cooler.add(cEdges);
const finCount = 46;
const fins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.015, ch * 0.96, cd * 0.96), mat(C.metal, { metalness: 0.7, roughness: 0.4, transparent: true, opacity: 0.55 }), finCount);
const m4 = new THREE.Matrix4();
for (let i = 0; i < finCount; i++) { m4.makeTranslation(COOL.x0 - 0.2 + (i + 0.5) * (cw - 0.2) / finCount, cCenter.y, 0); fins.setMatrixAt(i, m4); }
cooler.add(fins);
for (const [x, z] of [[COOL.x0 - 0.2, COOL.z0 - 0.1], [COOL.x1 + 0.2, COOL.z0 - 0.1], [COOL.x0 - 0.2, COOL.z1 + 0.1], [COOL.x1 + 0.2, COOL.z1 + 0.1]]) {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, COOL.y0, 0.1), mat(C.metal)); leg.position.set(x, COOL.y0 / 2, z); cooler.add(leg);
}
const top = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.06, cd), mat(C.metalDark)); top.position.set(cCenter.x, COOL.y1 + 0.03, 0); cooler.add(top);
const fans = [];
for (let f = 0; f < 3; f++) {
  const fan = new THREE.Group(); fan.position.set(COOL.x0 + 0.5 + f * 1.5, COOL.y1 + 0.12, 0);
  const shroud = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 8, 40), mat(C.metal, { metalness: 0.6 }));
  shroud.rotation.x = Math.PI / 2; fan.add(shroud);
  for (let b = 0; b < 5; b++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.02, 0.16), mat(C.muted));
    blade.position.x = 0.3; const holder = new THREE.Group(); holder.rotation.y = b * Math.PI * 2 / 5; blade.rotation.x = 0.35;
    holder.add(blade); fan.add(holder);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 16), mat(C.metalDark)); fan.add(hub);
  cooler.add(fan); fans.push(fan);
}

// pump
const pump = new THREE.Group(); pump.position.copy(PUMP); scene.add(pump);
const pBody = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 28), mat(C.metal, { metalness: 0.6, roughness: 0.4 }));
pBody.rotation.x = Math.PI / 2; pBody.position.y = 0.12; pump.add(pBody);
const motor = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.5), mat(C.metalDark)); motor.position.set(0, 0.12, 0.55); pump.add(motor);
const impeller = new THREE.Group(); impeller.position.set(0, 0.12, -0.27); pump.add(impeller);
for (let b = 0; b < 4; b++) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.02), mat(C.ink)); v.rotation.z = b * Math.PI / 4; impeller.add(v); }

// beads
const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0 }), N);
beads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(beads);

// warm air leaving the cooler
const AIR = 70;
const air = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: C.liquid, transparent: true, opacity: 0.4, depthWrite: false }), AIR);
const airP = Array.from({ length: AIR }, () => ({ x: 0, y: 0, z: 0, v: 0 }));
function seedAir(a, init) {
  a.x = COOL.x0 + Math.random() * (COOL.x1 - COOL.x0); a.z = (Math.random() - 0.5) * 1.6;
  a.y = COOL.y1 + 0.2 + (init ? Math.random() * 3 : 0); a.v = 0.6 + Math.random() * 0.6;
}
airP.forEach((a) => seedAir(a, true));
scene.add(air);

/* ---------- labels projected from 3D ---------- */
const anchors = {
  1: V(RACK.x, 5.35, 1.3), 2: V(TANK.x, TANK.y1 + 0.6, 0.9), 3: V(cCenter.x, COOL.y1 + 0.9, 1.1), 4: V(PUMP.x, 1.2, PUMP.z + 0.5),
  inside: V(-2.5, 0.05, 5.0), outside: V(6.5, 0.05, 5.0), wall: V(WALL_X, 3.45, 5.2),
};
const markerEls = [...document.querySelectorAll('.marker, .place')];
const tmpV = new THREE.Vector3();
function placeLabels(w, h) {
  for (const el of markerEls) {
    const a = anchors[el.dataset.step || el.dataset.at];
    tmpV.copy(a).project(camera);
    const vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1;
    el.style.visibility = vis ? 'visible' : 'hidden';
    el.style.transform = `translate(${((tmpV.x + 1) / 2 * w).toFixed(1)}px, ${((1 - tmpV.y) / 2 * h).toFixed(1)}px)`;
  }
}

/* ---------- camera views and steps ---------- */
const VIEWS = {
  0: { pos: V(3.2, 10.5, 17.5), at: V(0.6, 1.6, 0.4) },
  1: { pos: V(-3.2, 3.4, 7.8), at: V(-6, 2.5, 0) },
  2: { pos: V(2.2, 4.4, 6.4), at: V(-1.5, 1.8, 0) },
  3: { pos: V(10.5, 6.2, 7.2), at: V(6, 1.7, 0) },
  4: { pos: V(3.4, 2.8, 7.6), at: V(0.3, 0.5, 2.2) },
};
const TEXT = {
  0: 'The fluid carries tiny beads of paraffin wax, each sealed in a plastic shell. Melting a bead takes a lot of heat, so the fluid can carry heat away without getting much hotter. Pick a step to look closer.',
  1: 'Each of the 72 GPUs sits on a metal cold plate. As the slurry flows past, the solid wax beads melt and soak up the heat. The chip colour shows its temperature: blue is cool, red is near the 85 °C limit.',
  2: 'The tank holds a store of slurry. When an AI job suddenly needs more power, the extra heat melts more beads here instead of overheating the chips.',
  3: 'Outside, fans blow air across thin metal fins around the pipes. The beads freeze again and give their heat to the air. Nothing evaporates, so no water is used. If the air is too warm, the wax cannot refreeze.',
  4: 'The pump pushes the slurry, now full of frozen beads, back to the chips to melt again. The loop runs all day without stopping, which a plain block of wax cannot do.',
};
let current = 0, fly = null;
function goTo(step, { userAction = true } = {}) {
  current = step;
  document.querySelectorAll('[data-step]').forEach((el) => {
    if (+el.dataset.step === step) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
  });
  $('#step-text').textContent = TEXT[step];
  const v = VIEWS[step];
  if (reduceMotion) { camera.position.copy(v.pos); controls.target.copy(v.at); controls.update(); fly = null; }
  else fly = { t: 0, fromP: camera.position.clone(), fromT: controls.target.clone(), toP: v.pos, toT: v.at };
  if (userAction && tourOn && !tourDriving) stopTour();
}
document.querySelectorAll('.step, .marker').forEach((el) => el.addEventListener('click', () => goTo(+el.dataset.step)));
$('#overview').addEventListener('click', () => goTo(0));

let tourOn = false, tourTimer = 0, tourDriving = false;
const tourBox = $('#tour');
function stopTour() { tourOn = false; tourBox.checked = false; }
tourBox.addEventListener('change', () => { tourOn = tourBox.checked; tourTimer = 0; if (tourOn) { tourDriving = true; goTo(current === 4 || current === 0 ? 1 : current + 1); tourDriving = false; } });
controls.addEventListener('start', () => { fly = null; if (tourOn) stopTour(); });

/* ---------- controls ---------- */
const fmt = (n, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
function syncInputs() {
  $('#power-out').textContent = `${fmt(P.perGpu)} W`;
  $('#rack-kw').textContent = `${fmt(GPUS * P.perGpu / 1000, 1)} kW`;
  $('#ambient-out').textContent = `${P.ambient} °C`;
  $('#w-day').textContent = `${fmt(Math.round(GPUS * P.perGpu * 86400 / HVAP / 10) * 10)} L`;
}
$('#power').addEventListener('input', (e) => { P.perGpu = +e.target.value; syncInputs(); });
$('#ambient').addEventListener('input', (e) => { P.ambient = +e.target.value; syncInputs(); });
document.querySelectorAll('input[name="wax"]').forEach((r) => r.addEventListener('change', () => { P.wax = r.value; }));
document.querySelectorAll('input[name="speed"]').forEach((r) => r.addEventListener('change', () => { P.speed = +r.value; }));
const playBtn = $('#play');
function setPlaying(on) { P.playing = on; playBtn.textContent = on ? 'Pause' : 'Play'; playBtn.setAttribute('aria-pressed', String(on)); }
playBtn.addEventListener('click', () => setPlaying(!P.playing));
$('#reset').addEventListener('click', () => { resetSim(); updateReadings(true); });
setPlaying(P.playing);

/* ---------- readings ---------- */
function clock(s) { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = Math.floor(s) % 60; return [h, m, x].map((v) => String(v).padStart(2, '0')).join(':'); }
const statusEl = $('#r-status'), warnEl = $('#warn');
let lastText = 0;
function updateReadings(force) {
  const now = performance.now();
  if (!force && now - lastText < 200) return;
  lastText = now;
  $('#r-gpu').textContent = `${fmt(S.gpuMax, 1)} °C`;
  $('#r-melt').textContent = `${fmt(S.meltOut * 100)} %`;
  $('#r-frozen').textContent = `${fmt(S.frozenOut * 100)} %`;
  $('#r-return').textContent = `${fmt(S.tReturn, 1)} °C`;
  $('#r-air').textContent = `${fmt(Math.max(0, S.qAir) / 1000, 1)} kW`;
  $('#r-fan').textContent = `${fmt(S.fan * 100)} %`;
  $('#r-time').textContent = clock(S.time);
  $('#w-tower').textContent = `${fmt(S.water, S.water < 100 ? 1 : 0)} L`;
  if (S.warm < TAU * 1.5) { statusEl.textContent = 'Warming up'; statusEl.dataset.state = ''; }
  else if (S.gpuMax > THROTTLE) { statusEl.textContent = 'Too hot, the chips slow down'; statusEl.dataset.state = 'bad'; }
  else { statusEl.textContent = `Safe, below the ${THROTTLE} °C limit`; statusEl.dataset.state = 'ok'; }
  let warn = '';
  if (S.warm > TAU * 1.5) {
    if (S.frozenOut < 0.9 && P.ambient > WAX[P.wax] - 12) warn = 'The outside air is too warm to freeze this wax again. Try a wax that melts at a higher temperature.';
    else if (S.gpuMax > THROTTLE) warn = 'The chips are too hot. Try less power per GPU, or a wax that melts at a lower temperature.';
  }
  warnEl.hidden = !warn; warnEl.textContent = warn;
}

/* ---------- colours ---------- */
const col = new THREE.Color();
function heatColour(T, out) {
  if (T <= 45) return out.copy(C.cool);
  if (T <= 68) return out.copy(C.cool).lerp(C.amber, (T - 45) / 23);
  return out.copy(C.amber).lerp(C.hot, Math.min(1, (T - 68) / 17));
}

/* ---------- frame loop ---------- */
let lastT = performance.now();
const dummy = new THREE.Object3D();
let first = true;
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

function frame() {
  const nowT = performance.now(); const dt = Math.min((nowT - lastT) / 1000, 0.1); lastT = nowT;
  if (P.playing) {
    let sim = dt * P.speed;
    while (sim > 0) { const d = Math.min(sim, 0.1); stepSim(d); sim -= d; }
  }
  trayTemps();
  const tm = WAX[P.wax];

  for (let i = 0; i < N; i++) {
    dummy.position.copy(S.pos[i]); dummy.updateMatrix(); beads.setMatrixAt(i, dummy.matrix);
    const m = stateOf(S.h[i], tm)[1];
    beads.setColorAt(i, col.copy(C.solid).lerp(C.liquid, m));
  }
  beads.instanceMatrix.needsUpdate = true; beads.instanceColor.needsUpdate = true;

  for (let t = 0; t < TRAYS; t++) heatColour(S.trayT[t], chipMats[t].emissive);

  if (P.playing && !reduceMotion) {
    const spin = dt * P.speed;
    fans.forEach((f, i) => { f.rotation.y += spin * (9 + i * 0.4) * S.fan; });
    impeller.rotation.z += spin * 12;
    const airRate = Math.max(0, Math.min(1, S.qAir / 60000));
    air.material.opacity = 0.1 + 0.3 * airRate;
    airP.forEach((a, i) => {
      a.y += a.v * spin * (0.6 + airRate); a.x += Math.sin(a.y * 2 + i) * 0.002;
      if (a.y > COOL.y1 + 3.4) seedAir(a, false);
      dummy.position.set(a.x, a.y, a.z); dummy.updateMatrix(); air.setMatrixAt(i, dummy.matrix);
    });
    air.instanceMatrix.needsUpdate = true;
  }

  if (tourOn) {
    tourTimer += dt;
    if (tourTimer > 9) { tourTimer = 0; tourDriving = true; goTo(current >= 4 ? 1 : current + 1); tourDriving = false; }
  }
  if (fly) {
    fly.t = Math.min(1, fly.t + dt / 1.4);
    const e = 1 - Math.pow(1 - fly.t, 3);
    camera.position.lerpVectors(fly.fromP, fly.toP, e);
    controls.target.lerpVectors(fly.fromT, fly.toT, e);
    if (fly.t >= 1) fly = null;
  }
  controls.update();
  renderer.render(scene, camera);
  placeLabels(stage.clientWidth, stage.clientHeight);
  updateReadings(false);
  if (first) { first = false; msg.hidden = true; }
  requestAnimationFrame(frame);
}

air.count = AIR;
airP.forEach((a, i) => { dummy.position.set(a.x, a.y, a.z); dummy.updateMatrix(); air.setMatrixAt(i, dummy.matrix); });
resetSim();
for (let i = 0; i < N; i++) beads.setColorAt(i, C.solid);
camera.position.copy(VIEWS[0].pos); controls.target.copy(VIEWS[0].at); controls.update();
syncInputs();
resize();
goTo(0, { userAction: false });
// stays put on reduced motion; on normal motion the opening view is the same, so no fly
fly = null;
requestAnimationFrame(frame);
globalThis.__pcm = { S, P, stateOf, WAX, PATH, TAGS };
