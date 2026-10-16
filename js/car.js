import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, wrapAngle } from './util.js';

export const CAR_COLORS = [
  { name: '粉色', hex: 0xff2ea6 },
  { name: '青色', hex: 0x18e0ff },
  { name: '绿色', hex: 0x7dff3a },
  { name: '橙色', hex: 0xff8a1c },
  { name: '紫色', hex: 0x9a4dff },
  { name: '金色', hex: 0xffd92e },
];

export const AI_NAMES = ['火焰', '彗星', '像素', '飞飞', '闪闪'];

let shared = null;

function coloredBox(w, h, d, x, y, z, r, g, b) {
  const geo = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  geo.translate(x, y, z);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

function getShared() {
  if (shared) return shared;
  const s = new THREE.Shape();
  s.moveTo(-2.15, 0.28);
  s.lineTo(2.05, 0.28);
  s.quadraticCurveTo(2.32, 0.3, 2.25, 0.52);
  s.lineTo(1.0, 0.78);
  s.lineTo(-1.6, 0.86);
  s.lineTo(-2.2, 0.92);
  s.quadraticCurveTo(-2.3, 0.6, -2.15, 0.28);
  const body = new THREE.ExtrudeGeometry(s, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 3, curveSegments: 10 });
  body.translate(0, 0, -0.85);
  body.rotateY(-Math.PI / 2);
  const wing = new THREE.BoxGeometry(2.05, 0.07, 0.5).toNonIndexed();
  wing.translate(0, 1.22, -2.0);
  const st1 = new THREE.BoxGeometry(0.08, 0.34, 0.22).toNonIndexed();
  st1.translate(0.62, 1.03, -1.95);
  const st2 = st1.clone();
  st2.translate(-1.24, 0, 0);
  const bodyGeo = mergeGeometries([body, wing, st1, st2]);
  bodyGeo.computeVertexNormals();

  const c = new THREE.Shape();
  c.moveTo(0.9, 0.74);
  c.quadraticCurveTo(0.15, 1.34, -0.55, 1.32);
  c.quadraticCurveTo(-1.35, 1.28, -1.75, 0.84);
  c.lineTo(0.9, 0.74);
  const cabinGeo = new THREE.ExtrudeGeometry(c, { depth: 1.36, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2, curveSegments: 10 });
  cabinGeo.translate(0, 0, -0.68);
  cabinGeo.rotateY(-Math.PI / 2);

  const lightsGeo = mergeGeometries([
    coloredBox(1.75, 0.11, 0.08, 0, 0.8, -2.36, 2.6, 0.08, 0.3),
    coloredBox(0.5, 0.1, 0.08, 0.62, 0.47, 2.33, 2.0, 2.0, 2.3),
    coloredBox(0.5, 0.1, 0.08, -0.62, 0.47, 2.33, 2.0, 2.0, 2.3),
    coloredBox(0.22, 0.12, 0.08, 0.45, 0.38, -2.33, 0.5, 1.6, 3.0),
    coloredBox(0.22, 0.12, 0.08, -0.45, 0.38, -2.33, 0.5, 1.6, 3.0),
  ]);
  const stripeGeo = mergeGeometries([
    new THREE.BoxGeometry(0.04, 0.06, 3.7).translate(1.075, 0.42, 0.05),
    new THREE.BoxGeometry(0.04, 0.06, 3.7).translate(-1.075, 0.42, 0.05),
    new THREE.BoxGeometry(2.0, 0.035, 0.04).translate(0, 1.255, -1.76),
  ]);

  const wheelGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.42, 0.42, 0.34, 18).rotateZ(Math.PI / 2),
  ]);
  const hubGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.36, 10).rotateZ(Math.PI / 2);

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 128;
  const g = glowCanvas.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  const glowGeo = new THREE.PlaneGeometry(3.8, 6.6).rotateX(-Math.PI / 2);

  shared = {
    bodyGeo, cabinGeo, lightsGeo, stripeGeo, wheelGeo, hubGeo, glowGeo, glowTex,
    glassMat: new THREE.MeshStandardMaterial({ color: 0x0b0716, metalness: 0.9, roughness: 0.08, envMapIntensity: 1.6 }),
    lightsMat: new THREE.MeshBasicMaterial({ vertexColors: true }),
    wheelMat: new THREE.MeshStandardMaterial({ color: 0x0d0d14, metalness: 0.3, roughness: 0.7 }),
    hubMat: new THREE.MeshStandardMaterial({ color: 0xc8c8dc, metalness: 1.0, roughness: 0.25 }),
  };
  return shared;
}

const WHEELS = [[0.93, 1.38], [-0.93, 1.38], [0.93, -1.35], [-0.93, -1.35]];

export class Car {
  constructor(scene, colorHex, name, isPlayer) {
    const S = getShared();
    this.name = name;
    this.isPlayer = isPlayer;
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.4, roughness: 0.3, envMapIntensity: 1.5 });
    this.body.add(new THREE.Mesh(S.bodyGeo, this.bodyMat));
    this.body.add(new THREE.Mesh(S.cabinGeo, S.glassMat));
    this.body.add(new THREE.Mesh(S.lightsGeo, S.lightsMat));
    this.stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.body.add(new THREE.Mesh(S.stripeGeo, this.stripeMat));
    this.glowMat = new THREE.MeshBasicMaterial({ map: S.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Mesh(S.glowGeo, this.glowMat);
    glow.position.y = 0.04;
    glow.renderOrder = 2;
    this.group.add(glow);
    this.wheels = [];
    for (const [x, z] of WHEELS) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.42, z);
      const w = new THREE.Group();
      w.add(new THREE.Mesh(S.wheelGeo, S.wheelMat));
      const hub = new THREE.Mesh(S.hubGeo, S.hubMat);
      w.add(hub);
      pivot.add(w);
      this.group.add(pivot);
      this.wheels.push({ pivot, w, front: z > 0 });
    }
    scene.add(this.group);
    this.setColor(colorHex);
    this.input = { gas: false, brake: false, left: false, right: false, boost: false, steer: 0 };
    this.proj = { idx: 0, prog: 0, lat: 0, nx: 1, nz: 0, tx: 0, tz: 1 };
    this.skid = [{ x: 0, z: 0, on: false }, { x: 0, z: 0, on: false }];
    this.reset();
  }

  setColor(hex) {
    this.colorHex = hex;
    this.color = new THREE.Color(hex);
    this.bodyMat.color.set(hex);
    this.bodyMat.emissive.copy(this.color).multiplyScalar(0.12);
    this.stripeMat.color.copy(this.color).multiplyScalar(1.8);
    this.glowMat.color.copy(this.color).multiplyScalar(0.55);
    this.trailColor = this.color.clone().multiplyScalar(0.55);
  }

  reset() {
    this.x = 0; this.z = 0; this.h = 0;
    this.vx = 0; this.vz = 0; this.vf = 0; this.vr = 0;
    this.steer = 0; this.drift = 0; this.speedFrac = 0;
    this.boostMeter = 0; this.boosting = false;
    this.idx = -1; this.prog = 0; this.lastRaw = 0;
    this.lapsDone = 0; this.finished = false; this.finishTime = 0; this.lapStart = 0;
    this.wallHit = 0; this.wallX = 0; this.wallZ = 0;
    this.lane = 0; this.laneTarget = 0; this.laneT = 0; this.aiBoostT = 0;
    this.stars = 0; this.spin = 0;
    this.smokeAcc = 0; this.flameAcc = 0;
    this.skid[0].on = this.skid[1].on = false;
    for (const k in this.input) this.input[k] = k === 'steer' ? 0 : false;
  }

  place(track, idx, lat) {
    const N = track.N;
    idx = ((idx % N) + N) % N;
    this.x = track.px[idx] + track.nx[idx] * lat;
    this.z = track.pz[idx] + track.nz[idx] * lat;
    this.h = track.head[idx];
    this.vx = this.vz = this.vf = this.vr = 0;
    this.idx = idx;
    track.project(this.x, this.z, idx, this.proj);
    this.lastRaw = this.proj.prog;
    this.prog = this.proj.prog > N / 2 ? this.proj.prog - N : this.proj.prog;
    this.lane = lat; this.laneTarget = lat;
  }

  step(dt, track, P) {
    const inp = this.input;
    const steerIn = clamp((inp.right ? 1 : 0) - (inp.left ? 1 : 0) + inp.steer, -1, 1);
    this.steer += (steerIn - this.steer) * Math.min(1, dt * (this.isPlayer ? 9 : 6));
    this.boosting = inp.boost && this.boostMeter > 0.01;
    if (this.boosting) this.boostMeter = Math.max(0, this.boostMeter - dt * 0.32);

    let fx = Math.sin(this.h), fz = Math.cos(this.h);
    let vf = this.vx * fx + this.vz * fz;
    const sf = Math.min(1, Math.abs(vf) / P.maxSpeed);
    const auth = clamp(Math.abs(vf) / 9, 0, 1) * (1 - 0.4 * sf);
    const dir = vf >= -0.5 ? 1 : -1;
    let driftT = clamp((Math.abs(this.steer) * sf - 0.62) / 0.25, 0, 1);
    if (inp.brake && Math.abs(this.steer) > 0.3 && sf > 0.45) driftT = 1;
    this.drift += (driftT - this.drift) * Math.min(1, dt * 4);
    this.h -= this.steer * P.turnRate * (1 + this.drift * 0.35) * auth * dir * dt;

    // Gentle steering help: keeps the car in its lane through curves when no steering is pressed.
    if (P.assist > 0 && Math.abs(steerIn) < 0.1 && vf > 4) {
      const ahead = this.idx + Math.round((6 + vf * 0.3) / track.seg);
      const N = track.N, ti = ((ahead % N) + N) % N;
      const lat = clamp(this.proj.lat, -track.hw * 0.55, track.hw * 0.55);
      const tx = track.px[ti] + track.nx[ti] * lat, tz = track.pz[ti] + track.nz[ti] * lat;
      const err = wrapAngle(Math.atan2(tx - this.x, tz - this.z) - this.h);
      if (Math.abs(err) < 1.4) this.h += err * Math.min(1, P.assist * dt);
    }

    fx = Math.sin(this.h); fz = Math.cos(this.h);
    const rx = -fz, rz = fx;
    vf = this.vx * fx + this.vz * fz;
    let vr = this.vx * rx + this.vz * rz;
    const maxS = P.maxSpeed * (this.boosting ? 1.4 : 1);
    if (inp.gas || this.boosting) {
      const a = P.accel * (this.boosting ? 1.9 : 1);
      if (vf < maxS) vf += a * dt * (1 - (Math.max(0, vf) / maxS) * 0.8);
    }
    if (inp.brake) {
      if (vf > 0.5) vf -= P.brake * dt;
      else if (!inp.gas) vf = Math.max(vf - P.accel * 0.6 * dt, -P.reverseMax);
    }
    if (vf > maxS) vf += (maxS - vf) * Math.min(1, dt * 1.2);
    if (!inp.gas && !this.boosting && !inp.brake) vf -= vf * 0.35 * dt;
    const grip = P.grip + (P.driftGrip - P.grip) * this.drift;
    vr *= Math.exp(-grip * dt);
    this.vx = fx * vf + rx * vr;
    this.vz = fz * vf + rz * vr;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.vf = vf; this.vr = vr;
    this.speedFrac = Math.min(1.5, Math.abs(vf) / P.maxSpeed);
    if (this.drift > 0.5 && vf > 14) this.boostMeter = Math.min(1, this.boostMeter + dt * 0.1);

    const pr = track.project(this.x, this.z, this.idx, this.proj);
    this.idx = pr.idx;
    let d = pr.prog - this.lastRaw;
    const N = track.N;
    if (d < -N / 2) d += N; else if (d > N / 2) d -= N;
    this.prog += d;
    this.lastRaw = pr.prog;

    const limit = track.hw - 1.05;
    if (Math.abs(pr.lat) > limit) {
      const s = Math.sign(pr.lat);
      const over = Math.abs(pr.lat) - limit;
      this.x -= pr.nx * s * over;
      this.z -= pr.nz * s * over;
      const vn = (this.vx * pr.nx + this.vz * pr.nz) * s;
      if (vn > 0) {
        this.vx -= pr.nx * s * vn * 1.25;
        this.vz -= pr.nz * s * vn * 1.25;
        const keep = 1 - (1 - P.wallKeep) * clamp(vn / 18, 0, 1);
        this.vx *= keep; this.vz *= keep;
        if (vn > this.wallHit) {
          this.wallHit = vn;
          this.wallX = this.x + pr.nx * s * 1.0;
          this.wallZ = this.z + pr.nz * s * 1.0;
        }
      }
      const along = fx * pr.tx + fz * pr.tz;
      if (along > 0.2) {
        const th = Math.atan2(pr.tx, pr.tz);
        this.h += wrapAngle(th - this.h) * Math.min(1, dt * 2.5);
      }
    }
  }

  sync(dt, time) {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.h;
    const roll = clamp(-this.steer * this.speedFrac * 0.07 - this.vr * 0.006, -0.12, 0.12);
    this.body.rotation.z += (roll - this.body.rotation.z) * Math.min(1, dt * 8);
    const pitch = this.boosting ? -0.035 : (this.input.brake && this.vf > 3 ? 0.03 : 0);
    this.body.rotation.x += (pitch - this.body.rotation.x) * Math.min(1, dt * 6);
    this.body.position.y = Math.sin(time * 31 + this.x) * 0.008 * this.speedFrac;
    this.spin += (this.vf * dt) / 0.42;
    for (const wh of this.wheels) {
      wh.w.rotation.x = this.spin;
      if (wh.front) wh.pivot.rotation.y = -this.steer * 0.42;
    }
    this.glowMat.opacity = 0.8 + 0.2 * Math.sin(time * 6 + this.x * 0.1) + (this.boosting ? 0.3 : 0);
  }

  // Local car point (lx, lz) to world, written into out.
  local(lx, lz, out) {
    const c = Math.cos(this.h), s = Math.sin(this.h);
    out.x = this.x + lx * c + lz * s;
    out.z = this.z - lx * s + lz * c;
    return out;
  }
}

const tmp = { x: 0, z: 0 };

// Computer driver: follows a lane along the racing line, slows for corners, dodges cars ahead.
export function aiDrive(car, track, dt, targetMul, cars, P) {
  const N = track.N;
  const v = Math.max(car.vf, 8);
  const look = Math.round((5 + v * 0.34) / track.seg);
  car.laneT -= dt;
  if (car.laneT <= 0) {
    car.laneT = 2 + Math.random() * 4;
    car.laneTarget = (Math.random() * 2 - 1) * track.hw * 0.45;
  }
  const sc = track.scurv[(car.idx + Math.round(28 / track.seg)) % N];
  let lane = car.laneTarget * 0.6 + clamp(sc * 35, -1, 1) * track.hw * 0.4;
  for (const o of cars) {
    if (o === car) continue;
    const dp = (o.prog - car.prog) * track.seg;
    if (dp > 0 && dp < 16 && Math.abs(o.proj.lat - car.proj.lat) < 2.8) {
      lane = o.proj.lat + (car.proj.lat >= o.proj.lat ? 3.4 : -3.4);
    }
  }
  lane = clamp(lane, -track.hw + 2.2, track.hw - 2.2);
  car.lane += (lane - car.lane) * Math.min(1, dt * 1.3);
  track.pointAt(car.idx + look, car.lane, tmp);
  const err = wrapAngle(Math.atan2(tmp.x - car.x, tmp.z - car.z) - car.h);
  car.input.steer = clamp(-err * 2.8, -1, 1);
  car.input.left = car.input.right = false;
  let maxC = 0;
  const stp = Math.max(1, Math.round(3 / track.seg));
  const range = Math.round((10 + v * 0.9) / track.seg);
  for (let k = 2; k < range; k += stp) maxC = Math.max(maxC, track.curv[(car.idx + k) % N]);
  const cornerV = 1.2 / Math.max(maxC, 1e-4) + 6;
  const target = Math.min(P.maxSpeed * targetMul, cornerV);
  car.input.gas = car.vf < target;
  car.input.brake = car.vf > target + 5;
  if (car.boostMeter > 0.35 && maxC < 0.006 && car.aiBoostT <= 0 && Math.random() < dt * 0.6) car.aiBoostT = 1.0 + Math.random() * 1.2;
  car.aiBoostT -= dt;
  car.input.boost = car.aiBoostT > 0 && maxC < 0.012;
}
