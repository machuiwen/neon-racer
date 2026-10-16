import { ordinal, fmtTime } from './util.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      pos: $('hud-pos'), posOf: $('hud-posof'), lap: $('hud-lap'), stars: $('hud-stars'),
      time: $('hud-time'), best: $('hud-best'), last: $('hud-last'),
      speed: $('hud-speed'), boost: $('hud-boostfill'), boostWrap: $('hud-boost'),
      toast: $('toast'), wrong: $('wrongway'), countdown: $('countdown'),
    };
    this.cache = {};
  }

  set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  update(s) {
    const e = this.el;
    this.set('pos', s.pos, (v) => { e.pos.innerHTML = v + '<sup>' + ordinal(v) + '</sup>'; });
    this.set('posOf', s.total, (v) => { e.posOf.textContent = '/' + v; });
    this.set('lap', s.lap + '/' + s.laps, (v) => { e.lap.textContent = 'LAP ' + v; });
    this.set('stars', s.stars, (v) => { e.stars.textContent = '★ ' + v; });
    this.set('time', fmtTime(s.time), (v) => { e.time.textContent = v; });
    this.set('best', fmtTime(s.best), (v) => { e.best.textContent = 'BEST ' + v; });
    this.set('last', s.last > 0 ? fmtTime(s.last) : '', (v) => { e.last.textContent = v ? 'LAST ' + v : ''; });
    this.set('speed', s.speed, (v) => { e.speed.textContent = v; });
    this.set('boost', Math.round(s.boost * 100), (v) => {
      e.boost.style.transform = 'scaleX(' + v / 100 + ')';
      e.boostWrap.classList.toggle('full', v >= 99);
    });
    this.set('boosting', s.boosting, (v) => e.boostWrap.classList.toggle('active', v));
    this.set('wrong', s.wrong, (v) => e.wrong.classList.toggle('show', v));
  }

  toast(text, cls = '') {
    const t = this.el.toast;
    t.textContent = text;
    t.className = '';
    void t.offsetWidth;
    t.className = 'show ' + cls;
  }

  countdown(text, go) {
    const c = this.el.countdown;
    c.textContent = text;
    c.className = '';
    void c.offsetWidth;
    c.className = 'pop' + (go ? ' go' : '');
  }
}

export class Minimap {
  constructor(canvas, track) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.track = track;
    this.bg = document.createElement('canvas');
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.w = this.c.width = this.bg.width = Math.round(r.width * dpr);
    this.h = this.c.height = this.bg.height = Math.round(r.height * dpr);
    const t = this.track, b = t.bounds;
    const pad = 12 * dpr;
    const sx = (this.w - pad * 2) / (b.maxx - b.minx), sy = (this.h - pad * 2) / (b.maxz - b.minz);
    this.s = Math.min(sx, sy);
    this.ox = this.w / 2;
    this.oy = this.h / 2;
    const g = this.bg.getContext('2d');
    g.clearRect(0, 0, this.w, this.h);
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= t.N; i += 2) {
        const j = i % t.N;
        const [x, y] = this.map(t.px[j], t.pz[j]);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
    };
    g.lineJoin = 'round';
    path(); g.strokeStyle = 'rgba(10,0,25,0.85)'; g.lineWidth = 9 * dpr; g.stroke();
    path(); g.strokeStyle = 'rgba(24,224,255,0.35)'; g.lineWidth = 6 * dpr; g.stroke();
    path(); g.strokeStyle = '#7ff3ff'; g.lineWidth = 1.6 * dpr; g.stroke();
    const [sx0, sy0] = this.map(t.px[0] + t.nx[0] * t.hw, t.pz[0] + t.nz[0] * t.hw);
    const [sx1, sy1] = this.map(t.px[0] - t.nx[0] * t.hw, t.pz[0] - t.nz[0] * t.hw);
    g.beginPath(); g.moveTo(sx0, sy0); g.lineTo(sx1, sy1);
    g.strokeStyle = '#fff'; g.lineWidth = 3 * dpr; g.stroke();
  }

  map(x, z) {
    const b = this.track.bounds;
    return [this.ox - (x - b.cx) * this.s, this.oy - (z - b.cz) * this.s];
  }

  draw(cars, player) {
    if (!this.w) return;
    const g = this.ctx, d = this.dpr;
    g.clearRect(0, 0, this.w, this.h);
    g.drawImage(this.bg, 0, 0);
    for (const c of cars) {
      if (c === player) continue;
      const [x, y] = this.map(c.x, c.z);
      g.beginPath(); g.arc(x, y, 4 * d, 0, Math.PI * 2);
      g.fillStyle = '#' + c.color.getHexString(); g.fill();
    }
    const [x, y] = this.map(player.x, player.z);
    g.beginPath(); g.arc(x, y, 6.5 * d, 0, Math.PI * 2);
    g.fillStyle = '#fff'; g.fill();
    g.beginPath(); g.arc(x, y, 4.5 * d, 0, Math.PI * 2);
    g.fillStyle = '#' + player.color.getHexString(); g.fill();
  }
}

export class Confetti {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.running = false;
    this.loop = this.loop.bind(this);
  }

  start() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.c.width = Math.round(window.innerWidth * dpr);
    this.c.height = Math.round(window.innerHeight * dpr);
    const cols = ['#ff2ea6', '#18e0ff', '#7dff3a', '#ffd92e', '#9a4dff', '#ffffff', '#ff8a1c'];
    this.parts = [];
    for (let i = 0; i < 220; i++) {
      this.parts.push({
        x: Math.random() * this.c.width,
        y: -Math.random() * this.c.height * 0.8 - 20,
        vx: (Math.random() - 0.5) * 180 * dpr,
        vy: (120 + Math.random() * 220) * dpr,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 10,
        w: (6 + Math.random() * 8) * dpr,
        h: (10 + Math.random() * 10) * dpr,
        col: cols[i % cols.length],
        wob: Math.random() * 10,
      });
    }
    this.t = performance.now();
    this.age = 0;
    if (!this.running) { this.running = true; requestAnimationFrame(this.loop); }
  }

  stop() {
    this.running = false;
    this.ctx.clearRect(0, 0, this.c.width, this.c.height);
  }

  loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.t) / 1000);
    this.t = now;
    this.age += dt;
    const g = this.ctx;
    g.clearRect(0, 0, this.c.width, this.c.height);
    let alive = 0;
    for (const p of this.parts) {
      p.wob += dt * 4;
      p.x += (p.vx + Math.sin(p.wob) * 60 * this.dpr) * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      if (p.y > this.c.height + 30) {
        if (this.age < 5) { p.y = -20; p.x = Math.random() * this.c.width; } else continue;
      }
      alive++;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.scale(1, Math.abs(Math.cos(p.wob)) * 0.8 + 0.2);
      g.fillStyle = p.col;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    if (alive === 0) { this.stop(); return; }
    requestAnimationFrame(this.loop);
  }
}

// Multi-touch buttons using pointer events. Each finger presses the button it is on (or nearest within reach).
export class TouchControls {
  constructor(root) {
    this.root = root;
    this.state = { left: false, right: false, gas: false, brake: false, boost: false };
    this.btns = [...root.querySelectorAll('[data-k]')].map((el) => ({ el, k: el.dataset.k, r: null }));
    this.ptrs = new Map();
    const down = (e) => {
      e.preventDefault();
      this.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      try { root.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      this.recompute();
    };
    const move = (e) => {
      if (!this.ptrs.has(e.pointerId)) return;
      e.preventDefault();
      this.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      this.recompute();
    };
    const up = (e) => {
      if (!this.ptrs.delete(e.pointerId)) return;
      this.recompute();
    };
    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('lostpointercapture', up);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  layout() {
    for (const b of this.btns) {
      const r = b.el.getBoundingClientRect();
      b.r = r.width ? { l: r.left, t: r.top, r: r.right, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 } : null;
    }
  }

  recompute() {
    const on = {};
    const reach = 40;
    for (const [x, y] of this.ptrs.values()) {
      let best = null, bd = Infinity;
      for (const b of this.btns) {
        if (!b.r) continue;
        const dx = Math.max(b.r.l - x, 0, x - b.r.r), dy = Math.max(b.r.t - y, 0, y - b.r.b);
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = b; }
      }
      if (best && bd <= reach) on[best.k] = true;
    }
    for (const b of this.btns) {
      const v = !!on[b.k];
      if (this.state[b.k] !== v) {
        this.state[b.k] = v;
        b.el.classList.toggle('on', v);
      }
    }
  }

  reset() {
    this.ptrs.clear();
    this.recompute();
  }
}
