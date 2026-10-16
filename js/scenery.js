import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from './util.js';

export const FOG = { color: new THREE.Color(0x2a0b47), near: 140, far: 720 };

const fogUniforms = () => ({
  uFogColor: { value: FOG.color },
  uFogNear: { value: FOG.near },
  uFogFar: { value: FOG.far },
});

const SKY_FRAG = /* glsl */`
  uniform vec3 uSunDir;
  uniform vec3 uFogColor;
  uniform float uTime;
  varying vec3 vDir;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    vec3 top = vec3(0.002, 0.0, 0.012);
    vec3 mid = vec3(0.045, 0.004, 0.11);
    vec3 hor = vec3(0.55, 0.06, 0.28);
    vec3 col = mix(mid, top, smoothstep(0.08, 0.65, y));
    col = mix(hor, col, smoothstep(0.0, 0.2, y));
    float sd = dot(d, uSunDir);
    col += vec3(1.0, 0.25, 0.2) * pow(max(sd, 0.0), 6.0) * 0.3 * (1.0 - smoothstep(0.0, 0.45, y));
    float ang = acos(clamp(sd, -1.0, 1.0));
    float R = 0.17;
    float disc = 1.0 - smoothstep(R - 0.004, R, ang);
    float sy = (y - uSunDir.y) / R;
    vec3 sunCol = mix(vec3(1.6, 0.08, 0.5), vec3(1.8, 1.1, 0.12), smoothstep(-0.9, 0.85, sy));
    float gap = clamp((-sy - 0.02) * 0.55, 0.0, 0.6);
    float stripes = step(gap, fract(sy * 7.0 + uTime * 0.12));
    disc *= mix(1.0, stripes, step(sy, 0.0));
    col = mix(col, sunCol, disc);
    col += vec3(1.0, 0.15, 0.45) * pow(smoothstep(R * 3.5, R, ang), 2.0) * 0.3 * (1.0 - disc);
    if (y > 0.06) {
      vec3 q = d * 420.0;
      vec3 g = floor(q);
      float h = hash(g);
      float tw = 0.55 + 0.45 * sin(uTime * 2.3 + h * 60.0);
      float pt = 1.0 - smoothstep(0.08, 0.3, length(fract(q) - 0.5));
      col += vec3(0.95, 0.85, 1.0) * step(0.997, h) * pt * tw * smoothstep(0.06, 0.4, y) * 1.4;
    }
    col = mix(col, uFogColor, 1.0 - smoothstep(-0.01, 0.035, y));
    gl_FragColor = vec4(col, 1.0);
  }`;

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

export function makeSkyMaterial(sunDir) {
  return new THREE.ShaderMaterial({
    uniforms: { uSunDir: { value: sunDir }, uTime: { value: 0 }, uFogColor: { value: FOG.color } },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

export function buildSky(sunDir) {
  const mat = makeSkyMaterial(sunDir);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return { mesh, mat };
}

export function buildGround() {
  const geo = new THREE.PlaneGeometry(5000, 5000);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...fogUniforms() },
    extensions: { derivatives: true },
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main() {
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      varying vec3 vW;
      void main() {
        vec2 p = vW.xz / 12.0;
        vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
        float line = 1.0 - min(min(g.x, g.y) / 1.6, 1.0);
        float d = length(vW.xz - cameraPosition.xz);
        float fade = 1.0 - smoothstep(80.0, 700.0, d);
        vec3 col = vec3(0.004, 0.001, 0.012) + vec3(1.0, 0.08, 0.75) * line * fade * 0.9;
        col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar * 1.5, d));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.06;
  return mesh;
}

export function buildMountains(sunDir, center) {
  const cols = 180, rows = 7, r0 = 820, r1 = 1120;
  const rng = makeRng(7);
  const rnd = [];
  for (let c = 0; c < cols; c++) { rnd.push([]); for (let r = 0; r <= rows; r++) rnd[c].push(rng()); }
  const sun = new THREE.Vector2(sunDir.x, sunDir.z).normalize();
  const V = [];
  for (let c = 0; c <= cols; c++) {
    V.push([]);
    const cc = c % cols;
    const a = (cc / cols) * Math.PI * 2;
    const sx = Math.cos(a), sz = Math.sin(a);
    const facing = Math.max(0, sx * sun.x + sz * sun.y);
    const dip = 1 - 0.82 * Math.pow(facing, 5);
    for (let r = 0; r <= rows; r++) {
      const rf = r / rows;
      const env = Math.sin(Math.PI * rf);
      const n = 0.45 + 0.25 * Math.sin(a * 3 + 1.3) + 0.15 * Math.sin(a * 7 + 0.4 + rf * 2) + 0.1 * Math.sin(a * 17 + rf * 5);
      const h = env * Math.max(0, n + rnd[cc][r] * 0.4) * 170 * dip;
      const R = r0 + (r1 - r0) * rf;
      V[c].push([center.x + sx * R, h - 3, center.z + sz * R]);
    }
  }
  const pos = [], bary = [];
  const tri = (a, b, c) => {
    pos.push(...a, ...b, ...c);
    bary.push(1, 0, 0, 0, 1, 0, 0, 0, 1);
  };
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const a = V[c][r], b = V[c + 1][r], d = V[c][r + 1], e = V[c + 1][r + 1];
      if ((c + r) % 2) { tri(a, b, e); tri(a, e, d); } else { tri(a, b, d); tri(b, e, d); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('bary', new THREE.Float32BufferAttribute(bary, 3));
  geo.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...fogUniforms() },
    extensions: { derivatives: true },
    vertexShader: /* glsl */`
      attribute vec3 bary;
      varying vec3 vBary;
      varying float vH;
      void main() {
        vBary = bary;
        vH = clamp(position.y / 170.0, 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uFogColor;
      varying vec3 vBary;
      varying float vH;
      void main() {
        float e = min(min(vBary.x, vBary.y), vBary.z);
        float w = fwidth(e);
        float line = 1.0 - smoothstep(0.0, w * 1.4, e);
        vec3 fill = mix(vec3(0.008, 0.0, 0.02), vec3(0.015, 0.001, 0.035), vH);
        vec3 lc = mix(vec3(1.0, 0.06, 0.6), vec3(0.2, 0.7, 1.4), vH) * (0.35 + vH * 0.8);
        vec3 col = fill + lc * line;
        col = mix(uFogColor * 0.9, col, smoothstep(0.0, 0.2, vH));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

function farFromTrack(track, x, z, minD) {
  const m2 = minD * minD;
  for (let i = 0; i < track.N; i += 3) {
    const dx = track.px[i] - x, dz = track.pz[i] - z;
    if (dx * dx + dz * dz < m2) return false;
  }
  return true;
}

export function buildCity(track) {
  const rng = makeRng(42);
  const count = 70;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...fogUniforms() },
    vertexShader: /* glsl */`
      varying vec3 vP;
      varying vec3 vN;
      varying vec3 vC;
      varying float vSeed;
      varying float vTop;
      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vP = wp.xyz;
        vN = normal;
        vSeed = instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.711;
        vTop = (modelMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0)).y;
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #else
          vC = vec3(1.0, 0.2, 0.8);
        #endif
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      varying vec3 vP;
      varying vec3 vN;
      varying vec3 vC;
      varying float vSeed;
      varying float vTop;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
      void main() {
        vec2 w = abs(vN.x) > 0.5 ? vec2(vP.z, vP.y) : vec2(vP.x, vP.y);
        vec2 cs = vec2(3.2, 4.2);
        vec2 cell = floor(w / cs);
        vec2 f = fract(w / cs);
        float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.78);
        float lit = step(0.62, hash(cell + vSeed));
        vec3 col = vec3(0.004, 0.001, 0.01) + vC * win * lit * 0.7;
        col += vC * 1.5 * smoothstep(vTop - 1.2, vTop - 0.2, vP.y);
        if (vN.y > 0.5) col = vC * 0.15;
        float d = length(vP - cameraPosition);
        col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar * 1.6, d) * 0.85);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const palette = [new THREE.Color(1.0, 0.18, 0.75), new THREE.Color(0.15, 0.85, 1.0), new THREE.Color(0.65, 0.3, 1.0), new THREE.Color(1.0, 0.75, 0.2)];
  const m = new THREE.Matrix4();
  const { cx, cz } = track.bounds;
  let placed = 0, tries = 0;
  while (placed < count && tries < 3000) {
    tries++;
    const a = rng() * Math.PI * 2;
    const r = 400 + rng() * 300;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.85;
    if (!farFromTrack(track, x, z, 45)) continue;
    const w = 12 + rng() * 18, d = 12 + rng() * 18, h = 30 + rng() * rng() * 120;
    m.makeScale(w, h, d);
    m.setPosition(x, 0, z);
    mesh.setMatrixAt(placed, m);
    mesh.setColorAt(placed, palette[Math.floor(rng() * palette.length)]);
    placed++;
  }
  mesh.count = placed;
  mesh.computeBoundingSphere();
  return mesh;
}

function palmGeometry() {
  const parts = [];
  const top = new THREE.Vector3(1.3, 9.5, 0);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.2, 5, 0), top);
  parts.push(new THREE.TubeGeometry(curve, 8, 0.3, 5, false));
  for (let k = 0; k < 8; k++) {
    const leaf = new THREE.PlaneGeometry(1.2, 5.6, 1, 6);
    leaf.translate(0, 2.8, 0);
    const p = leaf.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const taper = 1 - (y / 5.6) * 0.85;
      p.setX(i, p.getX(i) * taper);
      p.setZ(i, -y * y * 0.14);
    }
    leaf.rotateX(-Math.PI / 2 + 0.5);
    leaf.rotateY((k / 8) * Math.PI * 2 + (k % 2) * 0.2);
    leaf.translate(top.x, top.y, top.z);
    parts.push(leaf);
  }
  return mergeGeometries(parts);
}

export function buildPalms(track, avoid) {
  const rng = makeRng(99);
  const count = 80;
  const geo = palmGeometry();
  const mat = new THREE.MeshBasicMaterial({ color: 0x0c0218, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let placed = 0, tries = 0;
  while (placed < count && tries < 4000) {
    tries++;
    const i = Math.floor(rng() * track.N);
    const side = rng() < 0.5 ? -1 : 1;
    const lat = side * (track.hw + 5 + rng() * 16);
    const x = track.px[i] + track.nx[i] * lat, z = track.pz[i] + track.nz[i] * lat;
    if (!farFromTrack(track, x, z, track.hw + 3.5)) continue;
    let ok = true;
    for (const a of avoid) if (Math.hypot(a.x - x, a.z - z) < a.r) ok = false;
    if (!ok) continue;
    const sc = 0.8 + rng() * 0.6;
    s.set(sc, sc * (0.85 + rng() * 0.4), sc);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    p.set(x, 0, z);
    m.compose(p, q, s);
    mesh.setMatrixAt(placed++, m);
  }
  mesh.count = placed;
  mesh.computeBoundingSphere();
  return mesh;
}

// A tiny scene of sky + neon strips, pre-filtered once so the cars get shiny reflections.
export function buildEnvMap(renderer, sunDir) {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  const skyMat = makeSkyMaterial(sunDir);
  s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
  const strip = (color, angle, y, w, h) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    mesh.position.set(Math.cos(angle) * 30, y, Math.sin(angle) * 30);
    mesh.lookAt(0, y, 0);
    s.add(mesh);
  };
  strip(new THREE.Color(3, 0.3, 1.8), 0.4, 3, 40, 1.4);
  strip(new THREE.Color(0.3, 2.2, 3.2), 2.2, 4, 36, 1.2);
  strip(new THREE.Color(2.2, 0.6, 3.0), 3.9, 6, 30, 1.0);
  strip(new THREE.Color(3, 2.2, 0.6), 5.2, 2, 20, 0.8);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: 0x0a0215 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1;
  s.add(floor);
  const rt = pm.fromScene(s, 0.02, 0.1, 200);
  pm.dispose();
  return rt.texture;
}
