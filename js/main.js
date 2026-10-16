import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Track } from './track.js';
import { FOG, buildSky, buildGround, buildMountains, buildCity, buildPalms, buildEnvMap } from './scenery.js';
import { Car, CAR_COLORS, AI_NAMES, aiDrive } from './car.js';
import { Particles, SkidMarks, FinalShader } from './fx.js';
import { AudioSys } from './audio.js';
import { Hud, Minimap, Confetti, TouchControls } from './ui.js';
import { clamp, wrapAngle, store, ordinal, fmtTime } from './util.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const IS_TOUCH = params.get('touch') === '1' ||
  (params.get('touch') !== '0' && ((navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window));
if (IS_TOUCH) document.body.classList.add('touch');

const $ = (id) => document.getElementById(id);
const show = (el, on) => el.classList.toggle('hidden', !on);

// ---------- renderer and post-processing ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setClearColor(0x05000c, 1);
renderer.info.autoReset = false;
const MAX_PR = Math.min(window.devicePixelRatio || 1, 2);
let pixelRatio = MAX_PR;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(FOG.color, FOG.near, FOG.far);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 4000);

const samples = renderer.capabilities.isWebGL2 && MAX_PR < 1.75 ? 4 : 0;
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples }));
composer.addPass(new RenderPass(scene, camera));
// Bloom at half the usual size: it is blurry anyway, and this keeps iPads fast.
class HalfBloom extends UnrealBloomPass {
  setSize(w, h) { super.setSize(Math.max(2, Math.round(w * 0.5)), Math.max(2, Math.round(h * 0.5))); }
}
const bloom = new HalfBloom(new THREE.Vector2(256, 256), 0.85, 0.25, 0.7);
composer.addPass(bloom);
const finalPass = new ShaderPass(FinalShader);
composer.addPass(finalPass);

// ---------- world ----------
const track = new Track();
const N = track.N;
const sunDir = new THREE.Vector3(track.tx[0], 0.17, track.tz[0]).normalize();
const sky = buildSky(sunDir);
scene.add(sky.mesh);
scene.add(buildGround());
scene.add(buildMountains(sunDir, { x: track.bounds.cx, z: track.bounds.cz }));
scene.add(buildCity(track));
scene.add(track.buildMeshes());
const SHOW_IDX = Math.round(N * 0.035);
const showPos = track.pointAt(SHOW_IDX, -(track.hw + 13), { x: 0, z: 0 });
scene.add(buildPalms(track, [{ x: showPos.x, z: showPos.z, r: 16 }]));
scene.environment = buildEnvMap(renderer, sunDir);
scene.add(new THREE.HemisphereLight(0x9a6bff, 0x1a0630, 1.1));
const sunLight = new THREE.DirectionalLight(0xff7ac8, 2.2);
sunLight.position.copy(sunDir).multiplyScalar(100);
scene.add(sunLight);
const rimLight = new THREE.DirectionalLight(0x40c8ff, 1.3);
rimLight.position.set(-sunDir.x * 100, 60, -sunDir.z * 100);
scene.add(rimLight);

// ---------- settings ----------
const DIFF = {
  easy: { ai: 0.8, assist: 2.2, wallKeep: 0.93, band: 0.14 },
  normal: { ai: 0.9, assist: 0.8, wallKeep: 0.82, band: 0.08 },
  hard: { ai: 0.985, assist: 0, wallKeep: 0.7, band: 0.04 },
};
function loadSettings() {
  const c = parseInt(store.get('neonRacer.color'), 10);
  const d = store.get('neonRacer.diff');
  const l = parseInt(store.get('neonRacer.laps'), 10);
  const g = store.get('neonRacer.autoGas');
  return {
    color: c >= 0 && c < CAR_COLORS.length ? c : 0,
    diff: DIFF[d] ? d : 'easy',
    laps: [1, 3, 5].includes(l) ? l : 3,
    autoGas: g == null ? IS_TOUCH : g === '1',
  };
}
const settings = loadSettings();
const BASE = { maxSpeed: 50, accel: 21, brake: 40, turnRate: 2.2, grip: 8, driftGrip: 2.3, reverseMax: 14 };
const AI_P = { ...BASE, assist: 0, wallKeep: 0.85 };
let PP = { ...BASE, assist: DIFF[settings.diff].assist, wallKeep: DIFF[settings.diff].wallKeep };

// ---------- cars ----------
const player = new Car(scene, CAR_COLORS[settings.color].hex, '你', true);
const ais = [0, 1, 2].map((k) => new Car(scene, 0xffffff, AI_NAMES[k], false));
const cars = [player, ...ais];
function recolorAIs() {
  const idx = CAR_COLORS.map((_, i) => i).filter((i) => i !== settings.color);
  ais.forEach((c, k) => c.setColor(CAR_COLORS[idx[k]].hex));
}
recolorAIs();

// ---------- effects ----------
const smoke = new Particles(600, false);
const sparks = new Particles(900, true);
const skids = new SkidMarks(1600, 5);
scene.add(skids.mesh, smoke.points, sparks.points);

// ---------- pickups ----------
const pickups = [];
{
  const tmp = { x: 0, z: 0 };
  const mk = (type, i, lat) => {
    track.pointAt(i, lat, tmp);
    pickups.push({ type, x: tmp.x, z: tmp.z, active: true, t: 0, phase: Math.random() * 6.28 });
  };
  for (let k = 0; k < 6; k++) {
    const i = Math.floor((N * (k + 0.15)) / 6);
    for (const l of [-0.55, 0, 0.55]) mk('boost', i, l * track.hw);
  }
  const step = Math.round(7 / track.seg);
  for (let k = 0; k < 6; k++) {
    const i0 = Math.floor((N * (k + 0.6)) / 6);
    const side = k % 2 ? 1 : -1;
    for (let s = 0; s < 5; s++) mk('star', i0 + s * step, side * track.hw * 0.55 * Math.sin((s / 4) * Math.PI));
  }
}
const boostItems = pickups.filter((p) => p.type === 'boost');
const starItems = pickups.filter((p) => p.type === 'star');
const boostMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.85, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1.7, 3.2) }), boostItems.length);
const starShape = new THREE.Shape();
for (let k = 0; k < 10; k++) {
  const r = k % 2 ? 0.45 : 1.05, a = (k / 10) * Math.PI * 2 + Math.PI / 2;
  if (k) starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r); else starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
}
const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 1 });
starGeo.center();
const starMesh = new THREE.InstancedMesh(starGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.3, 0.35) }), starItems.length);
for (const m of [boostMesh, starMesh]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; scene.add(m); }

// ---------- UI ----------
const hud = new Hud();
const minimap = new Minimap($('minimap'), track);
const confetti = new Confetti($('confetti'));
const touch = new TouchControls($('touch'));
const audio = new AudioSys();
const ui = {
  title: $('title'), hud: $('hud'), touch: $('touch'), pause: $('pause'), results: $('results'),
  btnPause: $('btn-pause'), btnMute: $('btn-mute'), gasBtn: $('tbtn-gas'),
};

// ---------- game state ----------
const G = {
  mode: 'title', paused: false, time: 0, raceTime: 0, countdownT: 0, stage: -1,
  finishOrder: 0, resultsT: 0, best: parseFloat(store.get('neonRacer.bestLap')) || Infinity,
  raceBest: Infinity, lastLap: 0, newRecord: false, wrongT: 0, stuckT: 0, flash: 0, boostVis: 0, shake: 0,
  orbit: 0, camBlend: 1, prevBoost: false, bump: 0, bumpX: 0, bumpZ: 0, perfAcc: 0, perfN: 0,
};
const cam = { yaw: 0, intro: new THREE.Vector3(), fov: 62 };
const keys = { gas: false, brake: false, left: false, right: false, boost: false };

function resetPickups() { for (const p of pickups) { p.active = true; p.t = 0; } }
function clearFx() { smoke.clear(); sparks.clear(); skids.clear(); }

function setGantry(stage) {
  const L = track.gantryLights;
  for (let k = 0; k < 4; k++) {
    let c = [0.12, 0.02, 0.05];
    if (stage === 0) c = [0.2, 2.2, 0.5];
    else if (stage > 0 && k < 4 - stage) c = [2.4, 0.08, 0.15];
    L[k].color.setRGB(c[0], c[1], c[2]);
  }
}

function applyViewOffset() {
  const w = window.innerWidth, h = window.innerHeight;
  if (G.mode === 'title') {
    if (w >= h) camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
    else camera.setViewOffset(w, h, 0, h * 0.17, w, h);
  } else camera.clearViewOffset();
}

function enterTitle() {
  G.mode = 'title';
  G.paused = false;
  show(ui.title, true); show(ui.hud, false); show(ui.touch, false); show(ui.pause, false); show(ui.results, false);
  show(ui.btnPause, false);
  confetti.stop();
  touch.reset();
  recolorAIs();
  ais.forEach((c, k) => {
    c.reset();
    c.place(track, Math.floor(N * (0.25 + k * 0.27)), (k - 1) * 3);
    c.vx = Math.sin(c.h) * 30; c.vz = Math.cos(c.h) * 30;
    c.boostMeter = 0.6;
  });
  player.reset();
  player.x = showPos.x; player.z = showPos.z; player.h = track.head[SHOW_IDX] + 2.4;
  clearFx();
  resetPickups();
  setGantry(-1);
  updateTitleUI();
  applyViewOffset();
  audio.setMusicLevel(0.3);
  audio.stopLoops();
}

function startRace() {
  audio.unlock();
  audio.startMusic();
  audio.setMusicLevel(0.24);
  G.mode = 'countdown';
  G.paused = false;
  show(ui.title, false); show(ui.results, false); show(ui.pause, false);
  show(ui.hud, true); show(ui.touch, IS_TOUCH); show(ui.btnPause, true);
  show(ui.gasBtn, !settings.autoGas);
  confetti.stop();
  touch.reset();
  requestAnimationFrame(() => { touch.layout(); minimap.resize(); });
  applyViewOffset();
  PP = { ...BASE, assist: DIFF[settings.diff].assist, wallKeep: DIFF[settings.diff].wallKeep };
  const slot = (k) => ({ idx: N - Math.round((7 + k * 7) / track.seg), lat: (k % 2 ? -1 : 1) * 3.3 });
  ais.forEach((c, k) => { c.reset(); const s = slot(k); c.place(track, s.idx, s.lat); c.boostMeter = 0.3; });
  player.reset();
  const s = slot(3);
  player.place(track, s.idx, s.lat);
  player.boostMeter = 0.3;
  G.countdownT = 4.0; G.stage = -1; G.raceTime = 0; G.finishOrder = 0; G.lastLap = 0; G.raceBest = Infinity;
  G.newRecord = false; G.wrongT = 0; G.stuckT = 0; G.flash = 0; G.boostVis = 0; G.shake = 0;
  cam.yaw = player.h;
  cam.intro.set(player.x - Math.sin(player.h) * 34 + Math.cos(player.h) * 10, 20, player.z - Math.cos(player.h) * 34 - Math.sin(player.h) * 10);
  G.camBlend = 0;
  clearFx();
  resetPickups();
  setGantry(-1);
  hud.cache = {};
}

function ranking() {
  return [...cars].sort((a, b) => {
    if (a.finished && b.finished) return a.finishOrder - b.finishOrder;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.prog - a.prog;
  });
}

function onPlayerLap() {
  const lt = G.raceTime - player.lapStart;
  player.lapStart = G.raceTime;
  G.lastLap = lt;
  G.raceBest = Math.min(G.raceBest, lt);
  let best = false;
  if (lt < G.best) { G.best = lt; store.set('neonRacer.bestLap', lt.toFixed(3)); best = true; G.newRecord = true; }
  if (player.lapsDone >= settings.laps) return;
  audio.lapDing();
  const final = player.lapsDone === settings.laps - 1;
  if (best) hud.toast('新的最快一圈！', 'gold');
  if (final) {
    if (best) setTimeout(() => { if (G.mode === 'race') hud.toast('最后一圈！', 'cyan'); }, 1500);
    else hud.toast('最后一圈！', 'cyan');
  } else if (!best) hud.toast('第 ' + (player.lapsDone + 1) + ' 圈', 'cyan');
}

function onPlayerFinish() {
  G.mode = 'finished';
  G.resultsT = 2.4;
  G.flash = 0.6;
  const place = player.finishOrder;
  hud.toast(place === 1 ? '你赢了！' : '到终点啦！', 'gold');
  audio.fanfare(place);
  show(ui.touch, false);
  touch.reset();
}

function showResults() {
  G.mode = 'results';
  show(ui.hud, false);
  show(ui.btnPause, false);
  const place = player.finishOrder;
  $('res-place').innerHTML = '第' + place + '<sup>' + ordinal(place) + '</sup>';
  const msgs = ['你赢了！开得太棒了！', '就差一点点！比赛真精彩！', '真棒！你登上领奖台了！', '不错的尝试！再来一局？'];
  $('res-msg').textContent = msgs[Math.min(place, 4) - 1];
  const rows = ranking().map((c, i) => {
    let t = c.finishTime;
    if (!c.finished) {
      const rate = Math.max(1, c.prog / Math.max(1, G.raceTime));
      t = G.raceTime + (settings.laps * N - c.prog) / rate;
    }
    const col = '#' + c.color.getHexString();
    return '<div class="trow' + (c === player ? ' me' : '') + '"><span>第' + (i + 1) + ordinal(i + 1) +
      '</span><span class="dot" style="background:' + col + ';color:' + col + '"></span><span>' + c.name +
      '</span><span class="t">' + fmtTime(t) + '</span></div>';
  });
  $('res-table').innerHTML = rows.join('');
  const stats = [
    '比赛用时 ' + fmtTime(player.finishTime),
    '最快一圈 ' + fmtTime(G.raceBest) + (G.newRecord ? ' — 新纪录！' : ''),
    '★ 收集到的星星：' + player.stars,
  ];
  $('res-stats').innerHTML = stats.join('<br>');
  show(ui.results, true);
  confetti.start();
}

function pause() {
  if (G.paused || (G.mode !== 'race' && G.mode !== 'countdown')) return;
  G.paused = true;
  show(ui.pause, true);
  audio.stopLoops();
  audio.setMusicLevel(0.1);
  touch.reset();
  for (const k in keys) keys[k] = false;
}
function resume() {
  if (!G.paused) return;
  G.paused = false;
  show(ui.pause, false);
  audio.setMusicLevel(0.24);
  last = performance.now();
}

function rescuePlayer() {
  const lat = clamp(player.proj.lat, -track.hw * 0.5, track.hw * 0.5);
  const idx = player.idx;
  const prog = player.prog;
  player.place(track, idx, lat);
  player.prog = prog;
  G.flash = 0.4;
  G.wrongT = 0; G.stuckT = 0;
  hud.toast('回到赛道啦！', 'cyan');
}

// ---------- per-frame logic ----------
function setPlayerInput() {
  const t = touch.state, inp = player.input;
  inp.left = keys.left || t.left;
  inp.right = keys.right || t.right;
  inp.brake = keys.brake || t.brake;
  inp.gas = keys.gas || t.gas || (settings.autoGas && !inp.brake);
  inp.boost = keys.boost || t.boost;
  inp.steer = 0;
}

function aiMul(c) {
  const d = DIFF[settings.diff];
  const gap = (player.prog - c.prog) / N;
  return clamp(d.ai + clamp(gap * 1.2, -d.band, d.band), 0.55, 1.02);
}

function collide(list) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
      if (d2 >= 9 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, push = (3 - d) * 0.5;
      a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
      const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rv < 0) {
        const imp = -rv * 0.65;
        a.vx -= nx * imp; a.vz -= nz * imp; b.vx += nx * imp; b.vz += nz * imp;
        if ((a === player || b === player) && -rv > G.bump) { G.bump = -rv; G.bumpX = (a.x + b.x) / 2; G.bumpZ = (a.z + b.z) / 2; }
      }
    }
  }
}

function lapLogic() {
  for (const c of cars) {
    if (c.finished) continue;
    const done = Math.floor(c.prog / N);
    if (done > c.lapsDone && c.prog > 0) {
      c.lapsDone = done;
      if (c === player && G.mode === 'race') onPlayerLap();
      if (done >= settings.laps) {
        c.finished = true;
        c.finishTime = G.raceTime;
        c.finishOrder = ++G.finishOrder;
        if (c === player) onPlayerFinish();
      }
    }
  }
}

const W = { x: 0, z: 0 };
function carEffects(c, dt) {
  const near = Math.hypot(c.x - camera.position.x, c.z - camera.position.z) < 150;
  const slip = Math.abs(c.vr);
  const drifting = slip > 4.5 && Math.abs(c.vf) > 6;
  for (let k = 0; k < 2; k++) {
    const sk = c.skid[k];
    if (!drifting) { sk.on = false; continue; }
    c.local(k ? -0.93 : 0.93, -1.35, W);
    if (sk.on) {
      const dx = W.x - sk.x, dz = W.z - sk.z;
      if (dx * dx + dz * dz > 0.3) { skids.add(sk.x, sk.z, W.x, W.z, 0.14, c.trailColor, G.time); sk.x = W.x; sk.z = W.z; }
    } else { sk.on = true; sk.x = W.x; sk.z = W.z; }
  }
  if (drifting && near) {
    c.smokeAcc += dt * 38 * Math.min(1, slip / 8);
    const cr = 0.65 + c.color.r * 0.3, cg = 0.6 + c.color.g * 0.3, cb = 0.7 + c.color.b * 0.3;
    while (c.smokeAcc >= 1) {
      c.smokeAcc -= 1;
      c.local(Math.random() < 0.5 ? 0.93 : -0.93, -1.45, W);
      smoke.spawn(W.x, 0.3, W.z, c.vx * 0.15 + (Math.random() - 0.5) * 2.5, 0.8 + Math.random(), c.vz * 0.15 + (Math.random() - 0.5) * 2.5,
        0.9 + Math.random() * 0.5, 1.2, 4.8, cr, cg, cb, 0.32, 1.6, -0.5);
    }
  }
  if (c.boosting && near) {
    c.flameAcc += dt * 70;
    const fx = Math.sin(c.h), fz = Math.cos(c.h);
    while (c.flameAcc >= 1) {
      c.flameAcc -= 1;
      for (const ex of [0.45, -0.45]) {
        c.local(ex, -2.45, W);
        const sp = 9 + Math.random() * 6;
        sparks.spawn(W.x, 0.38 + Math.random() * 0.08, W.z, c.vx - fx * sp + (Math.random() - 0.5) * 1.5, Math.random() * 0.6, c.vz - fz * sp + (Math.random() - 0.5) * 1.5,
          0.16 + Math.random() * 0.12, 0.95, 0.2, 3.0, 1.0, 0.25, 1, 3, 0);
        sparks.spawn(W.x, 0.38, W.z, c.vx - fx * 5, 0, c.vz - fz * 5, 0.09, 0.55, 0.15, 0.6, 1.4, 3.4, 1, 2, 0);
      }
    }
  }
  if (c.wallHit > 2.5) {
    if (near) {
      const n = Math.min(26, 6 + c.wallHit * 1.2);
      for (let i = 0; i < n; i++) {
        sparks.spawn(c.wallX, 0.5 + Math.random() * 0.6, c.wallZ, c.vx * 0.5 + (Math.random() - 0.5) * 14, 2 + Math.random() * 6, c.vz * 0.5 + (Math.random() - 0.5) * 14,
          0.35 + Math.random() * 0.3, 0.35, 0.1, 3.0, 2.0, 0.5, 1, 1.5, 14);
      }
    }
    if (c === player && G.mode === 'race') {
      audio.bump(c.wallHit);
      G.shake = Math.max(G.shake, Math.min(0.6, c.wallHit * 0.03));
    }
  }
  c.wallHit = 0;
}

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
function updatePickups(dt) {
  for (const p of pickups) {
    if (!p.active) { p.t -= dt; if (p.t <= 0) { p.active = true; p.pop = 0; } continue; }
    p.pop = Math.min(1, (p.pop ?? 1) + dt * 3);
    for (const c of cars) {
      if (p.type === 'star' && c !== player) continue;
      if (c === player && G.mode !== 'race') continue;
      if (G.mode === 'countdown') continue;
      const dx = c.x - p.x, dz = c.z - p.z;
      if (dx * dx + dz * dz < 6.8) { collect(p, c); break; }
    }
  }
  const setM = (mesh, list, spin) => {
    list.forEach((p, i) => {
      const s = p.active ? p.pop : 0.0001;
      E.set(spin ? 0 : 0.5, G.time * 2 + p.phase, 0);
      Q.setFromEuler(E);
      V.set(p.x, 1.5 + Math.sin(G.time * 3 + p.phase) * 0.25, p.z);
      S.set(s, s, s);
      M.compose(V, Q, S);
      mesh.setMatrixAt(i, M);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  setM(boostMesh, boostItems, false);
  setM(starMesh, starItems, true);
}

function collect(p, c) {
  p.active = false;
  p.t = p.type === 'boost' ? 5 : 8;
  const col = p.type === 'boost' ? [0.4, 1.8, 3.2] : [3.2, 2.4, 0.4];
  if (Math.hypot(p.x - camera.position.x, p.z - camera.position.z) < 150) {
    for (let i = 0; i < 26; i++) {
      sparks.spawn(p.x, 1.5, p.z, (Math.random() - 0.5) * 12, Math.random() * 9, (Math.random() - 0.5) * 12,
        0.5 + Math.random() * 0.3, 0.7, 0.1, col[0], col[1], col[2], 1, 2, 6);
    }
  }
  if (p.type === 'boost') c.boostMeter = Math.min(1, c.boostMeter + 0.4);
  if (c !== player) return;
  if (p.type === 'boost') { audio.boostPickup(); G.flash = Math.max(G.flash, 0.18); }
  else { player.stars++; audio.starPickup(); }
}

function updateCountdown(dt) {
  G.countdownT -= dt;
  const stage = G.countdownT <= 0 ? 0 : G.countdownT <= 3 ? Math.ceil(G.countdownT) : -1;
  if (stage !== G.stage) {
    G.stage = stage;
    setGantry(stage);
    if (stage > 0) { hud.countdown(String(stage), false); audio.countBeep(false); }
    if (stage === 0) {
      hud.countdown('出发！', true);
      audio.countBeep(true);
      G.mode = 'race';
      G.raceTime = 0;
      for (const c of cars) c.lapStart = 0;
      setTimeout(() => { if (G.mode !== 'title') setGantry(-1); }, 2500);
    }
  }
}

function update(dt) {
  G.time += dt;
  if (G.mode === 'countdown') updateCountdown(dt);
  if (G.mode === 'race' || G.mode === 'finished') G.raceTime += dt;
  if (G.mode === 'race' || G.mode === 'countdown') setPlayerInput();

  for (const c of ais) aiDrive(c, track, dt, G.mode === 'title' ? 0.85 : aiMul(c), cars, AI_P);
  if (G.mode === 'finished' || G.mode === 'results') aiDrive(player, track, dt, 0.6, cars, AI_P);

  const moving = G.mode === 'title' ? ais : G.mode === 'countdown' ? null : cars;
  G.bump = 0;
  if (moving) {
    const n = Math.min(8, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      for (const c of moving) c.step(h, track, c === player && G.mode === 'race' ? PP : AI_P);
      collide(moving);
    }
  }
  if (G.bump > 3 && G.mode === 'race') {
    audio.bump(G.bump);
    G.shake = Math.max(G.shake, Math.min(0.5, G.bump * 0.04));
    for (let i = 0; i < 12; i++) {
      sparks.spawn(G.bumpX, 0.7, G.bumpZ, (Math.random() - 0.5) * 10, 2 + Math.random() * 5, (Math.random() - 0.5) * 10, 0.4, 0.35, 0.1, 3, 2.2, 0.8, 1, 1.5, 12);
    }
  }
  if (G.mode !== 'title' && G.mode !== 'countdown') lapLogic();

  for (const c of cars) { carEffects(c, dt); c.sync(dt, G.time); }
  updatePickups(dt);
  smoke.update(dt);
  sparks.update(dt);
  skids.update(G.time);

  if (G.mode === 'race') {
    const p = player.proj;
    const facing = Math.sin(player.h) * p.tx + Math.cos(player.h) * p.tz;
    const along = player.vx * p.tx + player.vz * p.tz;
    if (facing < -0.3 && (along < -2 || Math.abs(player.vf) < 3)) G.wrongT += dt; else G.wrongT = Math.max(0, G.wrongT - dt * 2);
    if (player.input.gas && Math.abs(player.vf) < 2) G.stuckT += dt; else G.stuckT = 0;
    if (G.wrongT > 4 || G.stuckT > 3) rescuePlayer();
  } else G.wrongT = 0;

  if (G.mode === 'finished') {
    G.resultsT -= dt;
    if (G.resultsT <= 0) showResults();
  }

  // audio
  const live = G.mode === 'race' || G.mode === 'countdown' || G.mode === 'finished';
  const boosting = live && player.boosting;
  audio.setEngine(player.speedFrac, player.input.gas ? 1 : 0, boosting ? 1 : 0, live || G.mode === 'results');
  audio.setDrift(G.mode === 'race' && player.vf > 8 ? clamp((Math.abs(player.vr) - 3) / 6, 0, 1) : 0);
  audio.setBoost(boosting ? 1 : 0);
  if (boosting && !G.prevBoost) { audio.whoosh(); G.shake = Math.max(G.shake, 0.3); }
  G.prevBoost = boosting;

  updateCamera(dt);

  if (G.mode !== 'title') {
    const order = ranking();
    hud.update({
      pos: order.indexOf(player) + 1, total: cars.length,
      lap: clamp(player.lapsDone + 1, 1, settings.laps), laps: settings.laps, stars: player.stars,
      time: G.raceTime, best: G.best, last: G.lastLap,
      speed: Math.round(Math.abs(player.vf) * 4), boost: player.boostMeter, boosting: player.boosting,
      wrong: G.wrongT > 1,
    });
    minimap.draw(cars, player);
  }

  G.boostVis += ((boosting ? 1 : 0) - G.boostVis) * Math.min(1, dt * 4);
  G.flash *= Math.exp(-dt * 5);
  G.shake *= Math.exp(-dt * 5);
  const fu = finalPass.uniforms;
  fu.uBoost.value = G.boostVis;
  fu.uSpeed.value = G.mode === 'race' ? player.speedFrac : 0;
  fu.uTime.value = G.time;
  fu.uFlash.value = G.flash;
  sky.mat.uniforms.uTime.value = G.time;
}

const tv = new THREE.Vector3();
function updateCamera(dt) {
  const portrait = camera.aspect < 1;
  let fov;
  if (G.mode === 'title') {
    G.orbit += dt * 0.16;
    const r = portrait ? 11.5 : 8.6;
    camera.position.set(showPos.x + Math.sin(G.orbit) * r, portrait ? 3.4 : 2.5, showPos.z + Math.cos(G.orbit) * r);
    camera.lookAt(showPos.x, 0.9, showPos.z);
    fov = portrait ? 60 : 48;
  } else if (G.mode === 'results' || G.mode === 'finished') {
    G.orbit += dt * 0.35;
    const a = player.h + Math.PI + G.orbit;
    camera.position.set(player.x + Math.sin(a) * 9, 3.2, player.z + Math.cos(a) * 9);
    camera.lookAt(player.x, 1, player.z);
    fov = portrait ? 70 : 58;
  } else {
    const c = player;
    let target = c.h;
    if (Math.hypot(c.vx, c.vz) > 4 && c.vf > 0) target = c.h + wrapAngle(Math.atan2(c.vx, c.vz) - c.h) * 0.55;
    cam.yaw += wrapAngle(target - cam.yaw) * Math.min(1, dt * 5);
    const sf = Math.min(1.4, c.speedFrac);
    const dist = (portrait ? 11.5 : 8.6) + sf * 1.6 + G.boostVis * 1.2;
    const height = (portrait ? 5.0 : 3.4) + sf * 0.3;
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
    tv.set(c.x - fx * dist, height, c.z - fz * dist);
    if (G.camBlend < 1) {
      G.camBlend = Math.min(1, G.camBlend + dt / 2.6);
      const e = G.camBlend * G.camBlend * (3 - 2 * G.camBlend);
      tv.lerpVectors(cam.intro, tv, e);
    }
    camera.position.copy(tv);
    const sh = Math.max(G.shake, G.boostVis * 0.06, G.mode === 'race' && sf > 0.92 ? 0.015 : 0);
    if (sh > 0.001) {
      camera.position.x += (Math.random() - 0.5) * sh;
      camera.position.y += (Math.random() - 0.5) * sh;
      camera.position.z += (Math.random() - 0.5) * sh;
    }
    const la = portrait ? 6 : 5;
    camera.lookAt(c.x + fx * la, portrait ? 1.8 : 1.3, c.z + fz * la);
    fov = (portrait ? 70 + (1 - camera.aspect) * 18 : 62) + sf * 10 + G.boostVis * 12;
  }
  cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
  if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  const scale = (window.innerHeight * pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  smoke.uniforms.uScale.value = sparks.uniforms.uScale.value = scale;
}

// ---------- title screen UI ----------
function buildTitleUI() {
  const sw = $('swatches');
  CAR_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    const hex = '#' + c.hex.toString(16).padStart(6, '0');
    b.style.background = 'radial-gradient(circle at 35% 30%, #fff 0%, ' + hex + ' 35%, ' + hex + ' 70%, #000 140%)';
    b.style.setProperty('--c', hex);
    b.setAttribute('aria-label', c.name);
    b.addEventListener('click', (e) => {
      settings.color = i;
      store.set('neonRacer.color', i);
      player.setColor(c.hex);
      recolorAIs();
      audio.click();
      updateTitleUI();
      e.currentTarget.blur();
    });
    sw.appendChild(b);
  });
  for (const [id, key, parse] of [['seg-diff', 'diff', (v) => v], ['seg-laps', 'laps', (v) => parseInt(v, 10)]]) {
    $(id).querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', (e) => {
        settings[key] = parse(b.dataset.v);
        store.set('neonRacer.' + key, settings[key]);
        audio.click();
        updateTitleUI();
        e.currentTarget.blur();
      });
    });
  }
  $('btn-autogas').addEventListener('click', (e) => {
    settings.autoGas = !settings.autoGas;
    store.set('neonRacer.autoGas', settings.autoGas ? '1' : '0');
    audio.click();
    updateTitleUI();
    e.currentTarget.blur();
  });
  $('help').innerHTML = IS_TOUCH
    ? '点箭头转方向。按住<b>油门</b>往前开（也可以打开自动油门）。点<b>加速</b>会冲得飞快！过弯时漂移可以攒加速能量。'
    : '<b>方向键</b>或 <b>WASD</b> 开车 &middot; <b>空格</b>加速 &middot; <b>P</b> 暂停 &middot; <b>M</b> 声音开关。过弯时漂移可以攒加速能量！';
}

function updateTitleUI() {
  $('swatches').querySelectorAll('.swatch').forEach((b, i) => b.classList.toggle('on', i === settings.color));
  $('seg-diff').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.diff));
  $('seg-laps').querySelectorAll('button').forEach((b) => b.classList.toggle('on', parseInt(b.dataset.v, 10) === settings.laps));
  $('btn-autogas').classList.toggle('on', settings.autoGas);
  $('title-best').textContent = isFinite(G.best) ? '你的最快一圈：' + fmtTime(G.best) : '';
}

function toggleMute() {
  audio.unlock();
  audio.setMuted(!audio.muted);
  ui.btnMute.classList.toggle('muted', audio.muted);
}

// ---------- events ----------
const KEYMAP = {
  ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'brake', KeyS: 'brake', ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right', Space: 'boost', ShiftLeft: 'boost', ShiftRight: 'boost',
};
window.addEventListener('keydown', (e) => {
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); }
  if (e.repeat) return;
  if (e.code === 'Escape' || e.code === 'KeyP') { if (G.paused) resume(); else pause(); }
  else if (e.code === 'KeyM') toggleMute();
  else if (e.code === 'Enter') {
    if (G.mode === 'title' || G.mode === 'results') startRace();
    else if (G.paused) resume();
  }
});
window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; touch.reset(); });

const unlock = () => {
  audio.unlock();
  if (audio.ready) audio.startMusic();
};
for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlock, { passive: true });

document.addEventListener('touchmove', (e) => { if (!e.target.closest || !e.target.closest('.panel, .card')) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

const click = (id, fn) => $(id).addEventListener('click', (e) => { fn(); e.currentTarget.blur(); });
click('btn-start', startRace);
click('btn-again', startRace);
click('btn-menu', enterTitle);
click('btn-resume', resume);
click('btn-restart', startRace);
click('btn-quit', enterTitle);
click('btn-pause', pause);
click('btn-mute', toggleMute);
ui.btnMute.classList.toggle('muted', audio.muted);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pause(); audio.suspend(); } else audio.resume();
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  finalPass.uniforms.uAspect.value = w / h;
  applyViewOffset();
  minimap.resize();
  touch.layout();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 300));

// Lower the resolution if the device cannot keep up.
function perfCheck(raw) {
  if (G.mode !== 'race' || G.paused || raw > 0.25) { G.perfAcc = 0; G.perfN = 0; return; }
  G.perfAcc += raw;
  G.perfN++;
  if (G.perfN < 120) return;
  const avg = G.perfAcc / G.perfN;
  G.perfAcc = 0; G.perfN = 0;
  if (avg > 1 / 45) {
    if (pixelRatio > 0.86) { pixelRatio = Math.max(0.85, pixelRatio - 0.25); resize(); }
    else if (bloom.enabled) bloom.enabled = false;
  }
}

let dbg = null;
if (DEBUG) {
  dbg = document.createElement('div');
  dbg.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;font:12px monospace;background:rgba(0,0,0,.6);padding:4px 6px;pointer-events:none;white-space:pre';
  document.body.appendChild(dbg);
}
let fpsAcc = 0, fpsN = 0;

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.max(0, (now - last) / 1000);
  last = now;
  const dt = Math.min(raw, 1 / 20);
  if (G.paused) return;
  update(dt);
  renderer.info.reset();
  sky.mesh.position.copy(camera.position);
  composer.render(dt);
  perfCheck(raw);
  if (dbg) {
    fpsAcc += raw; fpsN++;
    if (fpsN >= 30) {
      dbg.textContent = 'fps ' + (fpsN / fpsAcc).toFixed(0) + '  calls ' + renderer.info.render.calls + '  tris ' + renderer.info.render.triangles + '  pr ' + pixelRatio + '  N ' + N + '  minR ' + track.minRadius.toFixed(1);
      fpsAcc = 0; fpsN = 0;
    }
  }
}

// ---------- start ----------
buildTitleUI();
resize();
enterTitle();
updateCamera(0.016);
renderer.compile(scene, camera);
$('loading').remove();
requestAnimationFrame(frame);

window.__game = { G, cars, player, track, keys, settings, startRace, enterTitle, renderer, camera, audio, touch };
