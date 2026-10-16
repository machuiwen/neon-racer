import * as THREE from 'three';
import { clamp, wrapAngle } from './util.js';
import { FOG } from './scenery.js';

const CONTROL = [
  [0, -150], [120, -160], [200, -110], [225, -20], [175, 40], [110, 45],
  [80, 95], [120, 160], [60, 215], [-40, 205], [-110, 150], [-200, 145],
  [-235, 60], [-180, -10], [-215, -90], [-140, -155],
];

export class Track {
  constructor() {
    const S = 1.3;
    const pts = CONTROL.map(([x, z]) => new THREE.Vector3(x * S, 0, z * S));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const N = Math.round(curve.getLength() / 1.6);
    const sp = curve.getSpacedPoints(N);
    this.N = N;
    this.hw = 9.5;
    const f = () => new Float32Array(N);
    const px = (this.px = f()), pz = (this.pz = f());
    const tx = (this.tx = f()), tz = (this.tz = f());
    const nx = (this.nx = f()), nz = (this.nz = f());
    const head = (this.head = f()), dist = (this.dist = f());
    const curv = (this.curv = f()), scurv = (this.scurv = f());
    for (let i = 0; i < N; i++) { px[i] = sp[i].x; pz[i] = sp[i].z; }
    let L = 0;
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      const dx = px[b] - px[a], dz = pz[b] - pz[a];
      const l = Math.hypot(dx, dz) || 1;
      tx[i] = dx / l; tz[i] = dz / l;
      // n points to the driver's left
      nx[i] = tz[i]; nz[i] = -tx[i];
      head[i] = Math.atan2(tx[i], tz[i]);
      dist[i] = L;
      const c = (i + 1) % N;
      L += Math.hypot(px[c] - px[i], pz[c] - pz[i]);
    }
    this.L = L;
    this.seg = L / N;
    const K = 6;
    for (let i = 0; i < N; i++) {
      const j = (i + K) % N;
      const d = wrapAngle(head[j] - head[i]) / (K * this.seg);
      scurv[(i + K / 2) % N] = d;
    }
    let minR = Infinity;
    for (let i = 0; i < N; i++) { curv[i] = Math.abs(scurv[i]); minR = Math.min(minR, 1 / Math.max(curv[i], 1e-6)); }
    this.minRadius = minR;
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < N; i++) {
      minx = Math.min(minx, px[i]); maxx = Math.max(maxx, px[i]);
      minz = Math.min(minz, pz[i]); maxz = Math.max(maxz, pz[i]);
    }
    this.bounds = { minx, maxx, minz, maxz, cx: (minx + maxx) / 2, cz: (minz + maxz) / 2 };
  }

  nearest(x, z, hint) {
    const { px, pz, N } = this;
    let best = 0, bd = Infinity;
    if (hint == null || hint < 0) {
      for (let i = 0; i < N; i++) {
        const dx = px[i] - x, dz = pz[i] - z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }
    for (let k = -28; k <= 28; k++) {
      const i = (hint + k + N) % N;
      const dx = px[i] - x, dz = pz[i] - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // Projects a world point onto the centre line. Writes into `out` to avoid garbage.
  project(x, z, hint, out) {
    const N = this.N;
    const { px, pz, tx, tz, nx, nz } = this;
    const i = this.nearest(x, z, hint);
    let i0 = i, i1 = (i + 1) % N;
    if ((x - px[i]) * tx[i] + (z - pz[i]) * tz[i] < 0) { i0 = (i - 1 + N) % N; i1 = i; }
    const sx = px[i1] - px[i0], sz = pz[i1] - pz[i0];
    const l2 = sx * sx + sz * sz || 1;
    const f = clamp(((x - px[i0]) * sx + (z - pz[i0]) * sz) / l2, 0, 1);
    const cx = px[i0] + sx * f, cz = pz[i0] + sz * f;
    let ex = nx[i0] + (nx[i1] - nx[i0]) * f, ez = nz[i0] + (nz[i1] - nz[i0]) * f;
    const el = Math.hypot(ex, ez) || 1;
    ex /= el; ez /= el;
    out.idx = i;
    out.prog = i0 + f;
    out.lat = (x - cx) * ex + (z - cz) * ez;
    out.nx = ex; out.nz = ez;
    out.tx = -ez; out.tz = ex;
    return out;
  }

  pointAt(i, lat, target) {
    const N = this.N;
    i = ((i % N) + N) % N;
    target.x = this.px[i] + this.nx[i] * lat;
    target.z = this.pz[i] + this.nz[i] * lat;
    return target;
  }

  buildMeshes() {
    const group = new THREE.Group();
    group.add(this._road());
    group.add(this._walls());
    group.add(this._arches());
    const g = this._gantry();
    group.add(g.group);
    this.gantryLights = g.lights;
    return group;
  }

  _road() {
    const { N, px, pz, nx, nz, dist, hw, L } = this;
    const pos = new Float32Array((N + 1) * 6), uv = new Float32Array((N + 1) * 4), idx = [];
    for (let i = 0; i <= N; i++) {
      const j = i % N, v = i === N ? L : dist[j];
      pos.set([px[j] + nx[j] * hw, 0, pz[j] + nz[j] * hw, px[j] - nx[j] * hw, 0, pz[j] - nz[j] * hw], i * 6);
      uv.set([0, v, 1, v], i * 4);
      if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uLen: { value: L }, uWidth: { value: hw * 2 } }]),
      fog: true,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform float uLen;
        uniform float uWidth;
        varying vec2 vUv;
        #include <fog_pars_fragment>
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          float u = vUv.x;
          float v = vUv.y;
          vec3 col = vec3(0.007, 0.004, 0.018);
          col += (hash(floor(vec2(u * 90.0, v * 3.0))) - 0.5) * 0.004;
          float grid = 1.0 - smoothstep(0.0, 0.03, abs(fract(v / 6.0) - 0.5) - 0.47);
          col += vec3(0.25, 0.05, 0.4) * grid * 0.12;
          float dash = step(0.45, fract(v / 9.0));
          float lane = (1.0 - smoothstep(0.004, 0.009, abs(u - 0.3333))) + (1.0 - smoothstep(0.004, 0.009, abs(u - 0.6667)));
          col += vec3(0.9, 0.85, 1.2) * lane * dash * 0.7;
          float kL = 1.0 - smoothstep(0.035, 0.042, u);
          float kR = smoothstep(0.958, 0.965, u);
          float stripe = step(0.5, fract(v / 3.0));
          col = mix(col, mix(vec3(1.1, 0.06, 0.5), vec3(0.55, 0.5, 0.65), stripe), kL);
          col = mix(col, mix(vec3(0.06, 0.7, 1.1), vec3(0.55, 0.5, 0.65), stripe), kR);
          col += vec3(1.0, 0.1, 0.6) * pow(1.0 - u, 14.0) * 0.25 + vec3(0.1, 0.7, 1.0) * pow(u, 14.0) * 0.25;
          // checkered start line
          if (v > 0.5 && v < 4.5) {
            float cell = uWidth / 12.0;
            float ch = mod(floor(u * 12.0) + floor((v - 0.5) / cell * 1.0), 2.0);
            col = mix(vec3(0.004), vec3(0.45), ch);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.01;
    return mesh;
  }

  _walls() {
    const { N, px, pz, nx, nz, dist, hw, L } = this;
    const off = hw + 0.25, H = 1.15;
    const pos = [], uv = [], side = [], idx = [];
    let base = 0;
    for (const s of [1, -1]) {
      for (let i = 0; i <= N; i++) {
        const j = i % N, v = i === N ? L : dist[j];
        const x = px[j] + nx[j] * off * s, z = pz[j] + nz[j] * off * s;
        pos.push(x, 0, z, x, H, z);
        uv.push(v, 0, v, 1);
        side.push(s > 0 ? 0 : 1, s > 0 ? 0 : 1);
        if (i < N) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      base += (N + 1) * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('side', new THREE.Float32BufferAttribute(side, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uFar: { value: FOG.far } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute float side;
        varying vec2 vUv;
        varying float vSide;
        varying float vFade;
        uniform float uFar;
        void main() {
          vUv = uv; vSide = side;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vFade = 1.0 - smoothstep(uFar * 0.25, uFar * 0.9, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        varying float vSide;
        varying float vFade;
        void main() {
          vec3 c = mix(vec3(1.0, 0.12, 0.65), vec3(0.1, 0.8, 1.0), vSide);
          float h = vUv.y;
          float top = smoothstep(0.82, 0.97, h) * (1.0 - smoothstep(0.97, 1.0, h) * 0.3);
          float base = (1.0 - smoothstep(0.0, 0.18, h)) * 0.35;
          float bars = 1.0 - smoothstep(0.0, 0.06, abs(fract(vUv.x / 5.0) - 0.5) - 0.44);
          float a = 0.03 + top * 0.9 + base * 0.35 + bars * 0.12;
          gl_FragColor = vec4(c * a * vFade, 1.0);
        }`,
    });
    return new THREE.Mesh(geo, mat);
  }

  _arches() {
    const { N, hw } = this;
    const count = 10;
    const geo = new THREE.TorusGeometry(hw + 1.6, 0.24, 6, 40, Math.PI);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const cols = [new THREE.Color(2.0, 0.15, 1.1), new THREE.Color(0.15, 1.4, 2.2), new THREE.Color(1.4, 0.4, 2.2)];
    for (let k = 0; k < count; k++) {
      const i = Math.floor((N * (k + 0.5)) / count);
      p.set(this.px[i], 0, this.pz[i]);
      q.setFromAxisAngle(up, this.head[i]);
      m.compose(p, q, sc);
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, cols[k % cols.length]);
    }
    mesh.computeBoundingSphere();
    return mesh;
  }

  _gantry() {
    const group = new THREE.Group();
    const i0 = 2;
    group.position.set(this.px[i0], 0, this.pz[i0]);
    group.rotation.y = this.head[i0];
    const w = this.hw + 1.4;
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a0b2e, metalness: 0.7, roughness: 0.35 });
    const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.4, 2.0) });
    for (const s of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1, 8, 1), dark);
      pillar.position.set(s * w, 4, 0);
      group.add(pillar);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 8, 1.05), neon);
      strip.position.set(s * (w - 0.55), 4, 0);
      group.add(strip);
    }
    const cvs = document.createElement('canvas');
    cvs.width = 1024; cvs.height = 128;
    const g = cvs.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 1024, 0);
    grd.addColorStop(0, '#2a0040'); grd.addColorStop(0.5, '#120024'); grd.addColorStop(1, '#2a0040');
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 128);
    g.font = 'italic 900 84px "Avenir Next", Futura, "Trebuchet MS", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#ff2ea6'; g.shadowBlur = 24;
    g.fillStyle = '#ffd6f2';
    g.fillText('NEON  RACER', 512, 68);
    g.strokeStyle = '#18e0ff'; g.lineWidth = 6; g.strokeRect(6, 6, 1012, 116);
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const signMat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.9, 0.9, 0.9) });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 1, 2.0, 0.8), [dark, dark, dark, dark, signMat, signMat]);
    beam.position.set(0, 8, 0);
    group.add(beam);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(6, 1.3, 0.3), dark);
    panel.position.set(0, 6.3, 0);
    group.add(panel);
    const lights = [];
    const lg = new THREE.CircleGeometry(0.42, 20);
    for (let k = 0; k < 4; k++) {
      const lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.02, 0.05) });
      const l = new THREE.Mesh(lg, lm);
      l.position.set(-2.1 + k * 1.4, 6.3, -0.17);
      l.rotation.y = Math.PI;
      group.add(l);
      lights.push(lm);
    }
    return { group, lights };
  }
}
