import * as THREE from 'three';

// Pooled point particles. Live particles are kept packed at the front so drawRange stays small.
export class Particles {
  constructor(max, additive) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    const mk = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = mk(this.pos, 3);
    this.aCol = mk(this.col, 3);
    this.aSize = mk(this.size, 1);
    this.aAlpha = mk(this.alpha, 1);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('pcolor', this.aCol);
    geo.setAttribute('psize', this.aSize);
    geo.setAttribute('palpha', this.aAlpha);
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.uniforms = { uScale: { value: 500 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute vec3 pcolor;
        attribute float psize;
        attribute float palpha;
        uniform float uScale;
        varying vec3 vC;
        varying float vA;
        void main() {
          vC = pcolor; vA = palpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(psize * uScale / max(0.5, -mv.z), 320.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = 1.0 - smoothstep(0.2, 1.0, d);
          gl_FragColor = vec4(vC, a * vA);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a0, drag = 1, grav = 0) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.life[i] = 0; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.drag[i] = drag; this.grav[i] = grav;
    this.size[i] = s0; this.alpha[i] = a0;
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        const last = --this.count;
        if (i !== last) this._copy(last, i);
        continue;
      }
      const t = this.life[i] / this.maxLife[i];
      const i3 = i * 3;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= k; this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * dt; this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] = Math.max(0.05, this.pos[i3 + 1] + this.vel[i3 + 1] * dt);
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = this.a0[i] * (1 - t) * Math.min(1, t * 8 + 0.2);
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    if (this.count > 0) {
      this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = true;
    }
  }

  _copy(from, to) {
    const f3 = from * 3, t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[t3 + k] = this.pos[f3 + k];
      this.vel[t3 + k] = this.vel[f3 + k];
      this.col[t3 + k] = this.col[f3 + k];
    }
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from]; this.a0[to] = this.a0[from];
    this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from];
    this.size[to] = this.size[from]; this.alpha[to] = this.alpha[from];
  }

  clear() { this.count = 0; this.geo.setDrawRange(0, 0); }
}

// Glowing tyre trails stored in a ring buffer of quads; they fade out in the shader.
export class SkidMarks {
  constructor(max = 1600, life = 5) {
    this.max = max;
    this.head = 0;
    this.pos = new Float32Array(max * 12);
    this.birth = new Float32Array(max * 4).fill(-1000);
    this.col = new Float32Array(max * 12);
    const idx = new Uint16Array(max * 6);
    for (let i = 0; i < max; i++) {
      const a = i * 4;
      idx.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aBirth = new THREE.BufferAttribute(this.birth, 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('birth', this.aBirth);
    geo.setAttribute('scol', this.aCol);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.uniforms = { uTime: { value: 0 }, uLife: { value: life } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute float birth;
        attribute vec3 scol;
        uniform float uTime;
        uniform float uLife;
        varying vec3 vC;
        varying float vA;
        void main() {
          vC = scol;
          vA = clamp(1.0 - (uTime - birth) / uLife, 0.0, 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC;
        varying float vA;
        void main() { gl_FragColor = vec4(vC, vA * vA * 0.8); }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.dirty = false;
  }

  add(x0, z0, x1, z1, w, c, time) {
    const dx = x1 - x0, dz = z1 - z0;
    const l = Math.hypot(dx, dz) || 1;
    const px = (-dz / l) * w, pz = (dx / l) * w;
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const y = 0.035;
    this.pos.set([x0 + px, y, z0 + pz, x0 - px, y, z0 - pz, x1 + px, y, z1 + pz, x1 - px, y, z1 - pz], i * 12);
    for (let k = 0; k < 4; k++) {
      this.birth[i * 4 + k] = time;
      this.col[i * 12 + k * 3] = c.r; this.col[i * 12 + k * 3 + 1] = c.g; this.col[i * 12 + k * 3 + 2] = c.b;
    }
    this.dirty = true;
  }

  update(time) {
    this.uniforms.uTime.value = time;
    if (this.dirty) {
      this.aPos.needsUpdate = this.aBirth.needsUpdate = this.aCol.needsUpdate = true;
      this.dirty = false;
    }
  }

  clear() {
    this.birth.fill(-1000);
    this.aBirth.needsUpdate = true;
  }
}

// Last full-screen pass: speed lines, chromatic split, vignette, flash, and sRGB output.
export const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uBoost: { value: 0 },
    uSpeed: { value: 0 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uBoost;
    uniform float uSpeed;
    uniform float uTime;
    uniform float uAspect;
    uniform float uFlash;
    varying vec2 vUv;
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    vec3 toSRGB(vec3 c) {
      c = max(c, vec3(0.0));
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
    }
    void main() {
      vec2 dir = vUv - 0.5;
      vec2 c = dir; c.x *= uAspect;
      float r = length(c);
      float ca = (0.0015 + uBoost * 0.007) * r * r * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + dir * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - dir * ca).b;
      float lines = max(uBoost, smoothstep(0.85, 1.0, uSpeed) * 0.15);
      if (lines > 0.01) {
        float ang = atan(c.y, c.x);
        float bins = 120.0;
        float a = (ang + 3.14159) / 6.28318 * bins;
        float id = floor(a);
        float fb = abs(fract(a) - 0.5);
        float h = hash(id * 13.7 + floor(uTime * 14.0 + hash(id) * 10.0));
        float on = step(0.82, h);
        float streak = on * (1.0 - smoothstep(0.05, 0.25, fb)) * smoothstep(0.32, 0.85, r);
        col += vec3(0.75, 0.9, 1.0) * streak * lines * 0.55;
      }
      col *= 1.0 - smoothstep(0.55, 1.25, r) * 0.6;
      col += vec3(1.0, 0.85, 1.0) * uFlash;
      gl_FragColor = vec4(toSRGB(col), 1.0);
    }`,
};
