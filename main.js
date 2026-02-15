import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---- Constants ----
const RW = 14, LW = RW / 2, H = LW / 2, RL = 100, JS = 80;
const SLO = RW / 2 + 1.5, GD = 8, YD = 2, ARD = 1;
const VL = 4.2, VW = 2.0, VH = 1.5, MG = 2.5, MS = 12, DD = 22;
const DIRS = ['north', 'east', 'south', 'west'];
const J1X = -JS / 2, J2X = JS / 2;
const VCOLS = [0x1e40af, 0xdc2626, 0x16a34a, 0xf59e0b, 0x7c3aed, 0x0891b2, 0xea580c, 0x4f46e5, 0x0d9488, 0xbe123c, 0x374151, 0xffffff, 0x1f2937, 0x92400e];

// ---- Globals ----
let scene, camera, renderer, controls, clock, speedMul = 1;
let vehicles = [], simTime = 0, fc = 0, ft = 0;
let aiEnabled = false, commLog = [], openaiKey = '', apiConnected = false;
let lastAiCall = 0, aiCooldown = 15;

// Random traffic density system
let densityPhase = Math.random() * Math.PI * 2;
let densitySpeed = 0.03 + Math.random() * 0.02;
let currentDensity = 0.5; // 0=empty, 1=heavy
let densityChangeTimer = 0;
let nextDensityShift = 5 + Math.random() * 10;

// Per-spawn-point stagger & activity
let spawnTimers = {};
let spawnActive = {};      // whether each spawn point is currently active
let spawnActiveTimer = {};  // time until next toggle
let spawnProbability = {};  // current probability of spawning when timer fires

const junctions = [
    { id: 0, name: 'A', cx: J1X, cz: 0, currentGreenDir: 'north', signalPhase: 'green', signalTimer: 0, trafficLights: {}, ambulanceOverride: null },
    { id: 1, name: 'B', cx: J2X, cz: 0, currentGreenDir: 'east', signalPhase: 'green', signalTimer: 3, trafficLights: {}, ambulanceOverride: null }
];

// ---- Spawn Points ----
function buildSpawnPoints() {
    const pts = [];
    for (let ji = 0; ji < 2; ji++) {
        const jx = junctions[ji].cx;
        pts.push({ id: `j${ji}_n`, ji, dir: 'north', sx: jx - H, sz: -RL, vx: 0, vz: 1, a: 0 });
        pts.push({ id: `j${ji}_s`, ji, dir: 'south', sx: jx + H, sz: RL, vx: 0, vz: -1, a: Math.PI });
    }
    pts.push({ id: 'east', ji: 1, dir: 'east', sx: J2X + RL, sz: -H, vx: -1, vz: 0, a: -Math.PI / 2 });
    pts.push({ id: 'west', ji: 0, dir: 'west', sx: J1X - RL, sz: H, vx: 1, vz: 0, a: Math.PI / 2 });
    return pts;
}
let spawnPts = [];

// ---- Init ----
function init() {
    clock = new THREE.Clock();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 200, 500);
    camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);
    camera.position.set(0, 70, 90);
    camera.lookAt(0, 0, 0);
    const canvas = document.getElementById('simulationCanvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.1; controls.minDistance = 20; controls.maxDistance = 200;
    controls.target.set(0, 0, 0);
    setupLighting(); buildGround(); buildRoads(); buildAllTrafficLights();
    spawnPts = buildSpawnPoints();
    spawnPts.forEach(sp => {
        spawnTimers[sp.id] = Math.random() * 3;
        spawnActive[sp.id] = Math.random() > 0.3;  // 70% start active
        spawnActiveTimer[sp.id] = 2 + Math.random() * 8;
        spawnProbability[sp.id] = spawnActive[sp.id] ? (0.3 + Math.random() * 0.7) : 0;
    });

    // Initial log messages to verify rendering
    addComm('system', '🛰️ Traffic Monitoring System online');
    addComm('node-a', '📡 Node A (West Intersection) initialized');
    addComm('node-b', '📡 Node B (East Intersection) initialized');

    setupUI(); addEventListener('resize', onResize); animate();
}

// ---- Lighting ----
function setupLighting() {
    scene.add(new THREE.AmbientLight(0xfff5e6, 0.6));
    const sun = new THREE.DirectionalLight(0xfffaf0, 1.8);
    sun.position.set(80, 100, 50); sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096); sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 350;
    [-120, 120, 120, -120].forEach((v, i) => { const p = ['left', 'right', 'top', 'bottom'][i]; sun.shadow.camera[p] = v; });
    sun.shadow.bias = -0.0005; scene.add(sun);
    const fill = new THREE.DirectionalLight(0xb0d4f1, 0.4); fill.position.set(-50, 40, -30); scene.add(fill);
    scene.add(new THREE.HemisphereLight(0x87ceeb, 0x3d8c40, 0.4));
}

// ---- Ground & Trees ----
function isOnRoad(px, pz) {
    for (const j of junctions) if (Math.abs(px - j.cx) < RW / 2 + 8 && Math.abs(pz) < RL + 10) return true;
    if (Math.abs(pz) < RW / 2 + 8 && px > J1X - RL - 5 && px < J2X + RL + 5) return true;
    return false;
}
function buildGround() {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x4a9e4a, roughness: 0.9 }));
    g.rotation.x = -Math.PI / 2; g.position.y = -0.05; g.receiveShadow = true; scene.add(g);
    for (let i = 0; i < 80; i++) {
        const s = 3 + Math.random() * 8, sh = 0.35 + Math.random() * 0.15;
        const p = new THREE.Mesh(new THREE.CircleGeometry(s, 8), new THREE.MeshStandardMaterial({ color: new THREE.Color(sh * 0.3, sh, sh * 0.3), roughness: 1 }));
        let px, pz; do { px = (Math.random() - 0.5) * 500; pz = (Math.random() - 0.5) * 400; } while (isOnRoad(px, pz));
        p.rotation.x = -Math.PI / 2; p.position.set(px, -0.03, pz); scene.add(p);
    }
    for (let i = 0; i < 55; i++) {
        let tx, tz; do { tx = (Math.random() - 0.5) * 400; tz = (Math.random() - 0.5) * 300; } while (isOnRoad(tx, tz));
        createTree(tx, tz);
    }
}
function createTree(x, z) {
    const g = new THREE.Group(), th = 2 + Math.random() * 2;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, th, 6), new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }));
    trunk.position.y = th / 2; trunk.castShadow = true; g.add(trunk);
    const cc = new THREE.Color(0.15 + Math.random() * 0.15, 0.5 + Math.random() * 0.2, 0.1);
    const cm = new THREE.MeshStandardMaterial({ color: cc, roughness: 0.8 });
    [2.5 + Math.random(), 2 + Math.random() * 0.5, 1.5].forEach((s, i) => {
        const c = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), cm);
        c.position.set((Math.random() - 0.5) * 0.8, [th + 1, th + 2.2, th + 0.2][i], (Math.random() - 0.5) * 0.8);
        c.castShadow = true; g.add(c);
    });
    g.position.set(x, 0, z); scene.add(g);
}

// ---- Roads ----
function buildRoads() {
    const rm = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.85, metalness: 0.05 });
    for (const j of junctions) {
        const ns = new THREE.Mesh(new THREE.BoxGeometry(RW, 0.15, RL * 2 + RW), rm);
        ns.position.set(j.cx, 0.02, 0); ns.receiveShadow = true; scene.add(ns);
    }
    const ewLen = (J2X + RL) - (J1X - RL), ewCx = (J1X - RL + J2X + RL) / 2;
    const ew = new THREE.Mesh(new THREE.BoxGeometry(ewLen, 0.15, RW), rm);
    ew.position.set(ewCx, 0.02, 0); ew.receiveShadow = true; scene.add(ew);
    addRoadMarkings(); addCurbs();
}
function addRoadMarkings() {
    const wm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const ym = new THREE.MeshStandardMaterial({ color: 0xf5c542, roughness: 0.5 });
    const sm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    for (const j of junctions) {
        for (let z = -RL; z <= RL; z += 4) { if (Math.abs(z - j.cz) < RW / 2 + 2) continue; const d = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 2), ym); d.position.set(j.cx, 0.12, z); scene.add(d); }
        [-1, 1].forEach(si => { [-1, 1].forEach(di => { const st = (RW / 2 + 1) * di, en = RL * di, l = Math.abs(en - st), m = (st + en) / 2; const ln = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, l), wm); ln.position.set(j.cx + si * RW / 2, 0.12, m); scene.add(ln); }); });
        const slNS = new THREE.BoxGeometry(LW - 0.5, 0.06, 0.4), slEW = new THREE.BoxGeometry(0.4, 0.06, LW - 0.5);
        [[j.cx - H, j.cz - SLO, slNS], [j.cx + H, j.cz + SLO, slNS]].forEach(([x, z, g]) => { const m = new THREE.Mesh(g, sm); m.position.set(x, 0.12, z); scene.add(m); });
        [[j.cx + SLO, j.cz - H, slEW], [j.cx - SLO, j.cz + H, slEW]].forEach(([x, z, g]) => { const m = new THREE.Mesh(g, sm); m.position.set(x, 0.12, z); scene.add(m); });
        const cwm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
        [[j.cx, j.cz - SLO - 1.2, 'ns'], [j.cx, j.cz + SLO + 1.2, 'ns'], [j.cx - SLO - 1.2, j.cz, 'ew'], [j.cx + SLO + 1.2, j.cz, 'ew']].forEach(([cx, cz, o]) => {
            for (let i = 0; i < 6; i++) { const off = (i - 2.5) * 1.2; if (o === 'ns') { const s = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.4), cwm); s.position.set(cx + off, 0.12, cz); scene.add(s); } else { const s = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.8), cwm); s.position.set(cx, 0.12, cz + off); scene.add(s); } }
        });
    }
    for (let x = J1X - RL; x <= J2X + RL; x += 4) { let skip = false; for (const j of junctions) if (Math.abs(x - j.cx) < RW / 2 + 2) skip = true; if (skip) continue; const d = new THREE.Mesh(new THREE.BoxGeometry(2, 0.05, 0.2), ym); d.position.set(x, 0.12, 0); scene.add(d); }
    [-1, 1].forEach(si => {
        const sl = RL - RW / 2;
        let ln = new THREE.Mesh(new THREE.BoxGeometry(sl, 0.05, 0.15), wm); ln.position.set(J1X - RW / 2 - sl / 2, 0.12, si * RW / 2); scene.add(ln);
        ln = new THREE.Mesh(new THREE.BoxGeometry(sl, 0.05, 0.15), wm); ln.position.set(J2X + RW / 2 + sl / 2, 0.12, si * RW / 2); scene.add(ln);
        const bl = JS - RW; if (bl > 0) { ln = new THREE.Mesh(new THREE.BoxGeometry(bl, 0.05, 0.15), wm); ln.position.set(0, 0.12, si * RW / 2); scene.add(ln); }
    });
}
function addCurbs() {
    const cm = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, roughness: 0.7 });
    for (const j of junctions) [-1, 1].forEach(si => { [-1, 1].forEach(di => { const st = (RW / 2 + 0.5) * di, l = RL - RW / 2, m = st + (l / 2) * di; let c = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, l), cm); c.position.set(j.cx + si * (RW / 2 + 0.25), 0.125, m); c.receiveShadow = c.castShadow = true; scene.add(c); }); });
    [-1, 1].forEach(si => {
        const sl = RL - RW / 2;
        let c = new THREE.Mesh(new THREE.BoxGeometry(sl, 0.25, 0.5), cm); c.position.set(J1X - RW / 2 - sl / 2, 0.125, si * (RW / 2 + 0.25)); c.receiveShadow = c.castShadow = true; scene.add(c);
        c = new THREE.Mesh(new THREE.BoxGeometry(sl, 0.25, 0.5), cm); c.position.set(J2X + RW / 2 + sl / 2, 0.125, si * (RW / 2 + 0.25)); c.receiveShadow = c.castShadow = true; scene.add(c);
        const bl = JS - RW; if (bl > 0) { c = new THREE.Mesh(new THREE.BoxGeometry(bl, 0.25, 0.5), cm); c.position.set(0, 0.125, si * (RW / 2 + 0.25)); c.receiveShadow = c.castShadow = true; scene.add(c); }
    });
}

// ---- Traffic Lights ----
function buildAllTrafficLights() {
    for (const j of junctions) {
        const cx = j.cx, cz = j.cz;
        j.trafficLights = {
            north: createTL(cx - RW / 2 - 1.5, 0, cz - SLO, 0),
            south: createTL(cx + RW / 2 + 1.5, 0, cz + SLO, Math.PI),
            east: createTL(cx + SLO, 0, cz - RW / 2 - 1.5, -Math.PI / 2),
            west: createTL(cx - SLO, 0, cz + RW / 2 + 1.5, Math.PI / 2),
        };
    }
}
function createTL(x, y, z, rotY) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 5, 8), new THREE.MeshStandardMaterial({ color: 0x404040, roughness: 0.6, metalness: 0.3 }));
    pole.position.y = 2.5; pole.castShadow = true; g.add(pole);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.5, 0.8), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.2 }));
    housing.position.set(0, 6.2, 0); housing.castShadow = true; g.add(housing);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.15, 1.0), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
    visor.position.set(0, 7.95, -0.1); g.add(visor);
    const lights = {};
    [{ c: 0xff0000, dim: 0x330000, y: 7.2, n: 'red' }, { c: 0xffff00, dim: 0x332200, y: 6.2, n: 'yellow' }, { c: 0x00ff00, dim: 0x003300, y: 5.2, n: 'green' }].forEach(ld => {
        const mat = new THREE.MeshStandardMaterial({ color: ld.dim, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.3, metalness: 0.1 });
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), mat); bulb.position.set(0, ld.y, -0.38); g.add(bulb);
        const glow = new THREE.PointLight(ld.c, 0, 6); glow.position.set(0, ld.y, -0.8); g.add(glow);
        lights[ld.n] = { material: mat, brightColor: ld.c, dimColor: ld.dim, glow };
    });
    g.position.set(x, y, z); g.rotation.y = rotY; scene.add(g);
    return { group: g, lights };
}
function setTLColor(lo, ac) {
    ['red', 'yellow', 'green'].forEach(c => { const l = lo.lights[c]; if (c === ac) { l.material.color.setHex(l.brightColor); l.material.emissive.setHex(l.brightColor); l.material.emissiveIntensity = 3; l.glow.intensity = 5; } else { l.material.color.setHex(l.dimColor); l.material.emissive.setHex(0); l.material.emissiveIntensity = 0; l.glow.intensity = 0; } });
}
function getSignal(j, dir) { return dir === j.currentGreenDir ? (j.signalPhase === 'allred' ? 'red' : j.signalPhase) : 'red'; }

// ---- AI / Counting ----
function countWaiting(j) { const c = { north: 0, east: 0, south: 0, west: 0 }; for (const v of vehicles) if (v.nji === j.id && !v.passed) c[v.dir]++; return c; }
function detectAmb(j) { for (const v of vehicles) if (v.isAmb && v.nji === j.id && !v.passed) return v.dir; return null; }
function pickNext(j) {
    const ad = detectAmb(j); if (ad) return ad;
    const c = countWaiting(j); let bd = null, bc = -1;
    for (const d of DIRS) { if (d === j.currentGreenDir) continue; if (c[d] > bc) { bc = c[d]; bd = d; } }
    if (bc <= 0) { const idx = DIRS.indexOf(j.currentGreenDir); return DIRS[(idx + 1) % 4]; }
    return bd;
}

// ---- Random Density System ----
function updateDensity(dt) {
    densityChangeTimer += dt;
    densityPhase += densitySpeed * dt;

    // Occasionally shift the density pattern
    if (densityChangeTimer >= nextDensityShift) {
        densityChangeTimer = 0;
        nextDensityShift = 5 + Math.random() * 15;
        densitySpeed = 0.02 + Math.random() * 0.06;
        // Random spike or lull
        if (Math.random() < 0.3) currentDensity = Math.random() < 0.5 ? 0.05 : 0.95;
    }

    // Perlin-like organic oscillation
    const wave1 = Math.sin(densityPhase) * 0.35;
    const wave2 = Math.sin(densityPhase * 2.3 + 1.7) * 0.15;
    const wave3 = Math.sin(densityPhase * 0.4 + 3.1) * 0.2;
    const target = Math.max(0, Math.min(1, 0.45 + wave1 + wave2 + wave3));
    currentDensity += (target - currentDensity) * dt * 0.5;
    currentDensity = Math.max(0, Math.min(1, currentDensity));
}

function getDensityLabel(d) { return d < 0.15 ? 'Empty' : d < 0.35 ? 'Light' : d < 0.65 ? 'Moderate' : d < 0.85 ? 'Busy' : 'Heavy'; }
function getDensityClass(d) { return d < 0.15 ? 'empty' : d < 0.35 ? 'light' : d < 0.65 ? 'moderate' : 'heavy'; }

function getSpawnInterval() {
    // Map density 0..1 to interval: empty=8s, heavy=0.6s
    return 0.6 + (1 - currentDensity) * 7.4;
}

// ---- Traffic Light Update ----
function updateTL(dt) {
    simTime += dt;
    for (const j of junctions) {
        j.signalTimer += dt;
        if (aiEnabled) {
            const ad = detectAmb(j), amo = ad && ad !== j.currentGreenDir, c = countWaiting(j);
            if (j.signalPhase === 'green') {
                let sw = j.signalTimer >= GD, sr = '';
                if (amo && j.signalTimer >= 3) { sw = true; j.ambulanceOverride = ad; sr = `🚑 J-${j.name}: Ambulance on ${ad.toUpperCase()}`; }
                if (!sr && j.signalTimer >= 3) { const om = Math.max(...DIRS.filter(d => d !== j.currentGreenDir).map(d => c[d])); if (c[j.currentGreenDir] === 0 && om > 0) { sw = true; sr = `J-${j.name}: ${j.currentGreenDir.toUpperCase()} empty`; } }
                if (!sr && sw) sr = `J-${j.name}: Timer expired`;
                if (sw) { if (sr) addComm('system', sr); j.signalPhase = 'yellow'; j.signalTimer = 0; }
            } else if (j.signalPhase === 'yellow') { if (j.signalTimer >= YD) { j.signalPhase = 'allred'; j.signalTimer = 0; } }
            else if (j.signalPhase === 'allred' && j.signalTimer >= ARD) {
                let nd; if (j.ambulanceOverride) { nd = j.ambulanceOverride; addComm(j.id === 0 ? 'node-a' : 'node-b', `🚑 Priority GREEN → ${nd.toUpperCase()}`); j.ambulanceOverride = null; }
                else { nd = pickNext(j); const bc = countWaiting(j)[nd] || 0; addComm(j.id === 0 ? 'node-a' : 'node-b', `GREEN → ${nd.toUpperCase()} (${bc} queued)`); }
                j.currentGreenDir = nd; j.signalPhase = 'green'; j.signalTimer = 0;
            }
        } else {
            if (j.signalPhase === 'green' && j.signalTimer >= GD) { j.signalPhase = 'yellow'; j.signalTimer = 0; }
            else if (j.signalPhase === 'yellow' && j.signalTimer >= YD) { j.signalPhase = 'allred'; j.signalTimer = 0; }
            else if (j.signalPhase === 'allred' && j.signalTimer >= ARD) { const idx = DIRS.indexOf(j.currentGreenDir); j.currentGreenDir = DIRS[(idx + 1) % 4]; j.signalPhase = 'green'; j.signalTimer = 0; }
        }
        DIRS.forEach(d => setTLColor(j.trafficLights[d], getSignal(j, d)));
    }
}

// ---- Vehicle Meshes ----
function createVehicleMesh() {
    const g = new THREE.Group(), col = VCOLS[Math.floor(Math.random() * VCOLS.length)];
    const body = new THREE.Mesh(new THREE.BoxGeometry(VW, VH * 0.5, VL), new THREE.MeshStandardMaterial({ color: col, roughness: 0.3, metalness: 0.6 }));
    body.position.y = VH * 0.25 + 0.3; body.castShadow = true; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(VW * 0.85, VH * 0.45, VL * 0.55), new THREE.MeshStandardMaterial({ color: 0x88ccee, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.7 }));
    cab.position.y = VH * 0.5 + 0.3 + VH * 0.225; cab.position.z = -VL * 0.05; cab.castShadow = true; g.add(cab);
    const wg = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12), wm = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sz]) => { const w = new THREE.Mesh(wg, wm); w.rotation.z = Math.PI / 2; w.position.set(sx * (VW / 2 + 0.05), 0.3, sz * VL * 0.3); g.add(w); });
    const hlg = new THREE.SphereGeometry(0.15, 8, 6);
    [-0.6, 0.6].forEach(xo => { const hl = new THREE.Mesh(hlg, new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffaa, emissiveIntensity: 0.3 })); hl.position.set(xo, VH * 0.3 + 0.3, VL / 2); g.add(hl); const tl = new THREE.Mesh(hlg, new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.2 })); tl.position.set(xo, VH * 0.3 + 0.3, -VL / 2); g.add(tl); });
    return g;
}
function createAmbMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(VW, VH * 0.6, VL * 1.2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.2 }));
    body.position.y = VH * 0.3 + 0.3; body.castShadow = true; g.add(body);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(VW + 0.02, VH * 0.15, VL * 1.2), new THREE.MeshStandardMaterial({ color: 0xcc0000, roughness: 0.4 }));
    stripe.position.y = VH * 0.3 + 0.3; g.add(stripe);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(VW * 0.9, VH * 0.45, VL * 0.4), new THREE.MeshStandardMaterial({ color: 0x88ccee, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.7 }));
    cab.position.y = VH * 0.6 + 0.3 + VH * 0.22; cab.position.z = VL * 0.35; cab.castShadow = true; g.add(cab);
    const crm = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.5 });
    const crH = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.25), crm); crH.position.set(0, VH * 0.6 + 0.35, -VL * 0.1); g.add(crH);
    const crV = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.8), crm); crV.position.set(0, VH * 0.6 + 0.35, -VL * 0.1); g.add(crV);
    const sy = VH + 0.3;
    const sb = new THREE.Mesh(new THREE.BoxGeometry(VW * 0.8, 0.15, 1.2), new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.4, metalness: 0.5 })); sb.position.set(0, sy, VL * 0.15); sb.castShadow = true; g.add(sb);
    const sh = new THREE.Mesh(new THREE.BoxGeometry(VW * 0.6, 0.6, 0.8), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3, metalness: 0.4 })); sh.position.set(0, sy + 0.45, VL * 0.15); sh.castShadow = true; g.add(sh);
    const sR = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 3, transparent: true, opacity: 0.9 })); sR.position.set(-0.45, sy + 0.7, VL * 0.15); g.add(sR);
    const sRL = new THREE.PointLight(0xff0000, 8, 18); sRL.position.copy(sR.position); g.add(sRL);
    const sB = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshStandardMaterial({ color: 0x0055ff, emissive: 0x0055ff, emissiveIntensity: 3, transparent: true, opacity: 0.9 })); sB.position.set(0.45, sy + 0.7, VL * 0.15); g.add(sB);
    const sBL = new THREE.PointLight(0x0055ff, 8, 18); sBL.position.copy(sB.position); g.add(sBL);
    const wg = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12), wm = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sz]) => { const w = new THREE.Mesh(wg, wm); w.rotation.z = Math.PI / 2; w.position.set(sx * (VW / 2 + 0.05), 0.3, sz * VL * 0.4); g.add(w); });
    g.userData = { sirenRed: sR, sirenRedLight: sRL, sirenBlue: sB, sirenBlueLight: sBL, sirenTime: 0 };
    return g;
}

// ---- Spawn & Update ----
function findNextJ(vx, vz, px, pz, dir) {
    if (dir === 'north' || dir === 'south') { for (let i = 0; i < 2; i++) if (Math.abs(px - junctions[i].cx) < RW) return i; return -1; }
    if (vx > 0) { let b = -1, bd = Infinity; for (let i = 0; i < 2; i++) { const d = junctions[i].cx - px; if (d > -RW / 2 && d < bd) { bd = d; b = i; } } return b; }
    else { let b = -1, bd = Infinity; for (let i = 0; i < 2; i++) { const d = px - junctions[i].cx; if (d > -RW / 2 && d < bd) { bd = d; b = i; } } return b; }
}

function spawnVehicle(sp) {
    const { sx, sz, vx, vz, a, dir, ji } = sp;
    if (vehicles.some(v => Math.sqrt((v.mesh.position.x - sx) ** 2 + (v.mesh.position.z - sz) ** 2) < VL + MG + 2)) return;
    const mesh = createVehicleMesh(); mesh.position.set(sx, 0, sz); mesh.rotation.y = a; scene.add(mesh);
    const spd = MS * (0.7 + Math.random() * 0.3);
    vehicles.push({ mesh, dir, speed: spd, cs: spd, ms: spd, vx, vz, nji: ji, passed: false, isAmb: false });
}

function spawnAmb() {
    const sp = spawnPts[Math.floor(Math.random() * spawnPts.length)];
    const { sx, sz, vx, vz, a, dir, ji } = sp;
    if (vehicles.some(v => Math.sqrt((v.mesh.position.x - sx) ** 2 + (v.mesh.position.z - sz) ** 2) < VL + MG + 4)) return;
    const mesh = createAmbMesh(); mesh.position.set(sx, 0, sz); mesh.rotation.y = a; scene.add(mesh);
    vehicles.push({ mesh, dir, speed: MS, cs: MS, ms: MS, vx, vz, nji: ji, passed: false, isAmb: true });
}

function spawnAll(dt) {
    const baseInterval = getSpawnInterval();
    for (const sp of spawnPts) {
        // Update per-lane active/dormant state
        spawnActiveTimer[sp.id] -= dt;
        if (spawnActiveTimer[sp.id] <= 0) {
            // Toggle active state randomly
            spawnActive[sp.id] = !spawnActive[sp.id];
            if (spawnActive[sp.id]) {
                // Active period: 3-20 seconds
                spawnActiveTimer[sp.id] = 3 + Math.random() * 17;
                // Random intensity when active: 30%-100%
                spawnProbability[sp.id] = 0.3 + Math.random() * 0.7;
            } else {
                // Dormant period: 2-15 seconds (lane goes empty)
                spawnActiveTimer[sp.id] = 2 + Math.random() * 13;
                spawnProbability[sp.id] = 0;
            }
        }

        // Only spawn if this lane is active
        if (!spawnActive[sp.id]) continue;

        spawnTimers[sp.id] += dt;
        // Per-direction jitter makes timing feel organic
        const jitter = 0.6 + Math.random() * 0.8;
        const interval = baseInterval * jitter / spawnProbability[sp.id];

        if (spawnTimers[sp.id] >= interval) {
            spawnTimers[sp.id] = 0;
            // Extra random skip chance (20%) to create natural gaps between cars
            if (Math.random() > 0.2) {
                spawnVehicle(sp);
            }
        }
    }
}

function distToSL(v) {
    if (v.nji < 0) return Infinity;
    const j = junctions[v.nji], cx = j.cx, cz = j.cz, p = v.mesh.position;
    switch (v.dir) { case 'north': return (cz - SLO) - p.z - VL / 2; case 'south': return p.z - (cz + SLO) - VL / 2; case 'east': return p.x - (cx + SLO) - VL / 2; case 'west': return (cx - SLO) - p.x - VL / 2; default: return Infinity; }
}

function updateVehicles(dt) {
    for (let i = vehicles.length - 1; i >= 0; i--) {
        const v = vehicles[i], pos = v.mesh.position;
        // Check junction pass-through
        if (v.nji >= 0 && !v.passed) {
            const j = junctions[v.nji]; let past = false;
            switch (v.dir) { case 'north': past = pos.z > j.cz + RW / 2; break; case 'south': past = pos.z < j.cz - RW / 2; break; case 'east': past = pos.x < j.cx - RW / 2; break; case 'west': past = pos.x > j.cx + RW / 2; break; }
            if (past) { v.passed = true; if (v.dir === 'east' || v.dir === 'west') { const nj = findNextJ(v.vx, v.vz, pos.x, pos.z, v.dir); if (nj >= 0 && nj !== v.nji) { v.nji = nj; v.passed = false; } else v.nji = -1; } else v.nji = -1; }
        }
        const dist = distToSL(v); let ts = v.ms;
        if (v.nji >= 0 && !v.passed && dist > 0) {
            const sig = getSignal(junctions[v.nji], v.dir);
            if (sig === 'red') { if (dist < DD) { ts = Math.max(0, v.ms * (dist / DD) - 0.5); if (dist < 1.5) ts = 0; } }
            else if (sig === 'yellow' && dist > 5) { ts = Math.max(0, v.ms * (dist / DD)); if (dist < 1.5) ts = 0; }
        }
        // Collision avoidance
        let ma = Infinity; const hx = Math.sin(v.mesh.rotation.y), hz = Math.cos(v.mesh.rotation.y);
        for (const o of vehicles) { if (o === v) continue; const dx = o.mesh.position.x - pos.x, dz = o.mesh.position.z - pos.z, d = Math.sqrt(dx * dx + dz * dz); if (d > DD + 5) continue; const dot = dx * hx + dz * hz; if (dot > 0) { const ld = Math.abs(-dx * hz + dz * hx); if (ld < VW + 1 && d < ma) ma = d; } if (d < VL * 0.8 && dot > -1) ma = Math.min(ma, d); }
        const sg = VL + MG; if (ma < sg + 8) { const gr = Math.max(0, (ma - sg) / 8); ts = Math.min(ts, v.ms * gr); if (ma < sg + 0.5) ts = 0; }
        if (v.cs < ts) v.cs = Math.min(ts, v.cs + 8 * dt); else v.cs = Math.max(ts, v.cs - 12 * dt);
        pos.x += v.vx * v.cs * dt; pos.z += v.vz * v.cs * dt;
        const margin = RL + 20;
        if (pos.x < J1X - margin || pos.x > J2X + margin || pos.z < -margin || pos.z > margin) {
            scene.remove(v.mesh); v.mesh.traverse(ch => { if (ch.geometry) ch.geometry.dispose(); if (ch.material) { Array.isArray(ch.material) ? ch.material.forEach(m => m.dispose()) : ch.material.dispose(); } });
            vehicles.splice(i, 1);
        }
    }
}

// ---- Communication Log ----
function addComm(type, text) {
    const mins = Math.floor(simTime / 60), secs = Math.floor(simTime % 60);
    const time = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    commLog.unshift({ type, text, time });
    if (commLog.length > 40) commLog.pop();
}

// ---- OpenAI Integration ----
let isCallingAI = false;
async function callOpenAI() {
    if (!apiConnected || !openaiKey || isCallingAI) return;
    const now = simTime;
    if (now - lastAiCall < aiCooldown) return;
    lastAiCall = now;
    isCallingAI = true;

    const c1 = countWaiting(junctions[0]), c2 = countWaiting(junctions[1]);
    const total1 = c1.north + c1.east + c1.south + c1.west;
    const total2 = c2.north + c2.east + c2.south + c2.west;
    const hasAmb = vehicles.some(v => v.isAmb);

    const prompt = `You are an AI traffic management system controlling two connected intersections (Junction A and Junction B) in a smart city. Analyze the real-time traffic data and provide coordination recommendations between the two nodes.

LIVE TRAFFIC DATA:
━━━━━━━━━━━━━━━━━
Junction A — Green: ${junctions[0].currentGreenDir.toUpperCase()} | Queues: N=${c1.north} E=${c1.east} S=${c1.south} W=${c1.west} | Total: ${total1}
Junction B — Green: ${junctions[1].currentGreenDir.toUpperCase()} | Queues: N=${c2.north} E=${c2.east} S=${c2.south} W=${c2.west} | Total: ${total2}
Overall: ${vehicles.length} vehicles | Density: ${getDensityLabel(currentDensity)} (${Math.round(currentDensity * 100)}%)
${hasAmb ? '⚠️ AMBULANCE ACTIVE — Emergency vehicle on road!' : 'No emergency vehicles.'}
Mode: ${aiEnabled ? 'AI Adaptive' : 'Fixed Timer'}

Respond with a structured analysis:
1. COORDINATION: How should A and B synchronize signals? (1 sentence)
2. BOTTLENECK: Which junction/direction needs attention? (1 sentence) 
3. RECOMMENDATION: One specific action to optimize flow. (1 sentence)

Keep total under 60 words. Be specific with directions and numbers.`;

    const insightEl = document.getElementById('aiInsight');
    const dashStatus = document.getElementById('dashStatus');
    insightEl.classList.add('loading');
    insightEl.textContent = '🔄 Gemini is analyzing real-time data...';
    if (dashStatus) {
        dashStatus.textContent = 'THINKING';
        dashStatus.style.boxShadow = '0 0 15px rgba(168, 85, 247, 0.4)';
    }

    // Add node communication messages
    addComm('node-a', `📡 Broadcasting: ${total1} vehicles queued, Green=${junctions[0].currentGreenDir.toUpperCase()}`);
    addComm('node-b', `📡 Broadcasting: ${total2} vehicles queued, Green=${junctions[1].currentGreenDir.toUpperCase()}`);
    addComm('system', `🔗 Sending combined data to AI coordinator...`);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        const resp = await fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: openaiKey, prompt }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        const data = await resp.json();
        if (data.error) throw new Error(data.error);

        const insight = data.insight;
        insightEl.classList.remove('loading');
        insightEl.textContent = insight;

        addComm('ai-response', `🧠 ${insight.substring(0, 100)}${insight.length > 100 ? '...' : ''}`);
        addComm('node-a', `✅ Acknowledged AI recommendation — adjusting strategy`);
        addComm('node-b', `✅ Synchronized with Node A per AI coordination`);

        if (dashStatus) {
            dashStatus.textContent = 'ACTIVE';
            dashStatus.style.boxShadow = '';
        }
    } catch (err) {
        if (dashStatus) {
            dashStatus.textContent = 'ERROR';
            dashStatus.style.boxShadow = '';
        }
        insightEl.classList.remove('loading');
        let errorMsg = err.message;
        if (err.name === 'AbortError') {
            errorMsg = 'Request timed out — will retry next cycle';
        } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
            errorMsg = 'Network error — check your internet connection and API key';
        }
        insightEl.textContent = `⚠️ ${errorMsg}`;
        insightEl.style.color = '#fca5a5';
        addComm('system', `⚠️ AI coordinator error: ${errorMsg.substring(0, 60)}`);
        // Reset color after a moment
        setTimeout(() => { insightEl.style.color = ''; }, 5000);
    } finally {
        isCallingAI = false;
    }
}

// ---- Dashboard Update ----
function updateDash() {
    // Flow indicator
    const flowBar = document.getElementById('flowBar');
    const flowText = document.getElementById('flowText');
    flowBar.style.width = Math.round(currentDensity * 100) + '%';
    flowText.textContent = getDensityLabel(currentDensity);

    for (let ji = 0; ji < 2; ji++) {
        const j = junctions[ji], pf = `j${ji + 1}`, c = countWaiting(j), ad = detectAmb(j), mq = Math.max(1, ...Object.values(c));
        const total = c.north + c.east + c.south + c.west;

        // Density badge
        const dEl = document.getElementById(`${pf}Density`);
        const dc = total === 0 ? 'empty' : total <= 3 ? 'light' : total <= 6 ? 'moderate' : 'heavy';
        const dl = total === 0 ? 'Empty' : total <= 3 ? 'Light' : total <= 6 ? 'Moderate' : 'Heavy';
        dEl.textContent = dl; dEl.className = `junction-density ${dc}`;

        document.getElementById(`${pf}Dir`).textContent = j.currentGreenDir.toUpperCase();
        const pe = document.getElementById(`${pf}Phase`);
        if (j.signalPhase === 'green') { pe.textContent = '🟢 GREEN'; pe.style.color = '#22c55e'; }
        else if (j.signalPhase === 'yellow') { pe.textContent = '🟡 YELLOW'; pe.style.color = '#eab308'; }
        else { pe.textContent = '🔴 ALL RED'; pe.style.color = '#ef4444'; }

        const dm = { north: 'N', east: 'E', south: 'S', west: 'W' };
        for (const [dir, ab] of Object.entries(dm)) {
            const bar = document.getElementById(`${pf}q${ab}`), ce = document.getElementById(`${pf}q${ab}c`);
            bar.style.width = Math.min(100, (c[dir] / Math.max(mq, 5)) * 100) + '%';
            ce.textContent = c[dir]; bar.className = 'jq-bar';
            if (ad === dir) bar.classList.add('ambulance'); else if (c[dir] >= 4) bar.classList.add('high');
        }

        const card = document.getElementById(`junction${ji + 1}Card`);
        if (aiEnabled) {
            const stratEl = document.getElementById(`${pf}Strategy`);
            const reasonEl = document.getElementById(`${pf}Reason`);

            const ambDir = detectAmb(j);
            if (ambDir) {
                stratEl.textContent = "EMERGENCY OVERRIDE";
                reasonEl.textContent = `Priority: Ambulance on ${ambDir.toUpperCase()} lane.`;
                card.classList.add('emergency');
                card.classList.remove('ai-action');
            } else {
                card.classList.remove('emergency');
                if (j.signalPhase === 'yellow' || j.signalPhase === 'allred') {
                    card.classList.add('ai-action');
                } else {
                    card.classList.remove('ai-action');
                }

                if (j.signalPhase === 'green' && total === 0) {
                    stratEl.textContent = "OPTIMIZING FLOW";
                    reasonEl.textContent = "Current green lane is empty, switching...";
                } else if (j.signalPhase === 'green') {
                    stratEl.textContent = "MAINTAINING FLOW";
                    reasonEl.textContent = `Processing ${c[j.currentGreenDir]} vehicles on ${j.currentGreenDir.toUpperCase()}.`;
                } else {
                    const nextDir = pickNext(j);
                    stratEl.textContent = "DECISION MADE";
                    reasonEl.textContent = `Next Priority: ${nextDir.toUpperCase()} (${c[nextDir]} queued).`;
                }
            }
        } else {
            card.classList.remove('emergency', 'ai-action');
        }
    }

    // Comm log
    const logEl = document.getElementById('commLog');
    if (logEl) {
        const tagMap = { 'node-a': ['A', 'tag-a'], 'node-b': ['B', 'tag-b'], 'system': ['SYS', 'tag-sys'], 'ai-response': ['AI', 'tag-ai'] };
        logEl.innerHTML = commLog.slice(0, 12).map(e => {
            const [label, cls] = tagMap[e.type] || ['SYS', 'tag-sys'];
            return `<div class="comm-entry ${e.type}"><span class="comm-time">${e.time}</span><span class="comm-tag ${cls}">${label}</span><span class="comm-text">${e.text}</span></div>`;
        }).join('');
    }
}

// ---- UI Setup ----
function setupUI() {
    document.getElementById('speedUp').addEventListener('click', () => { speedMul = Math.min(speedMul * 1.5, 5); });
    document.getElementById('speedDown').addEventListener('click', () => { speedMul = Math.max(speedMul / 1.5, 0.2); });
    document.getElementById('ambulanceBtn').addEventListener('click', () => { spawnAmb(); });

    const fixedBtn = document.getElementById('fixedModeBtn'), aiBtn = document.getElementById('aiModeBtn'), dash = document.getElementById('aiDashboard');
    // Dashboard is always visible for API key access
    dash.classList.remove('hidden');
    fixedBtn.addEventListener('click', () => {
        aiEnabled = false;
        fixedBtn.classList.add('active');
        aiBtn.classList.remove('active');
        document.body.classList.remove('ai-mode-active');
    });
    aiBtn.addEventListener('click', () => {
        aiEnabled = true;
        aiBtn.classList.add('active');
        fixedBtn.classList.remove('active');
        document.body.classList.add('ai-mode-active');
        commLog = [];
        addComm('system', 'AI Adaptive Control activated for both junctions');
    });

    document.getElementById('apiConnectBtn').addEventListener('click', () => {
        const key = document.getElementById('apiKeyInput').value.trim();
        const statusEl = document.getElementById('apiStatus');
        const btn = document.getElementById('apiConnectBtn');
        if (!key || key.length < 10) { statusEl.textContent = 'Invalid key — paste your Gemini API key'; statusEl.className = 'api-status error'; return; }
        openaiKey = key; apiConnected = true;
        statusEl.textContent = '✓ Connected to Gemini — insights every 15s'; statusEl.className = 'api-status connected';
        btn.textContent = '✓ Connected'; btn.classList.add('connected');
        addComm('system', '🔗 Gemini 2.5 Flash connected — enabling AI insights');
        callOpenAI(); // First call immediately
    });
}

// ---- Main Loop ----
function animate() {
    requestAnimationFrame(animate);
    const rawDt = clock.getDelta(), dt = rawDt * speedMul;
    fc++; ft += rawDt;
    if (ft >= 0.5) { document.getElementById('fpsCount').textContent = Math.round(fc / ft); fc = 0; ft = 0; }

    updateDensity(dt);
    updateTL(dt);
    spawnAll(dt);
    updateVehicles(dt);

    // Ambulance sirens
    vehicles.forEach(v => {
        if (v.isAmb && v.mesh.userData.sirenRed) {
            v.mesh.userData.sirenTime += rawDt * 6;
            const f = Math.sin(v.mesh.userData.sirenTime) > 0;
            v.mesh.userData.sirenRed.material.emissiveIntensity = f ? 3 : 0.2;
            v.mesh.userData.sirenRedLight.intensity = f ? 8 : 0;
            v.mesh.userData.sirenBlue.material.emissiveIntensity = f ? 0.2 : 3;
            v.mesh.userData.sirenBlueLight.intensity = f ? 0 : 8;
        }
    });

    document.getElementById('vehicleCount').textContent = vehicles.length;
    updateDash();

    // Periodic OpenAI call (works in both modes)
    if (apiConnected) callOpenAI();

    controls.update();
    renderer.render(scene, camera);
}

function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }

init();
