import { store } from './util.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const CHORDS = [
  { bass: 33, tones: [57, 60, 64] }, // A minor
  { bass: 29, tones: [53, 57, 60] }, // F
  { bass: 36, tones: [55, 60, 64] }, // C
  { bass: 31, tones: [55, 59, 62] }, // G
];
const ARP = [0, 1, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1];
const LEAD = [
  [0, 76, 3], [3, 74, 1], [4, 72, 4], [8, 74, 2], [10, 76, 2], [12, 79, 4],
  [16, 77, 3], [19, 76, 1], [20, 74, 4], [24, 72, 2], [26, 74, 2], [28, 77, 4],
  [32, 76, 3], [35, 74, 1], [36, 72, 4], [40, 71, 2], [42, 72, 2], [44, 76, 4],
  [48, 74, 6], [54, 71, 2], [56, 67, 4], [60, 71, 4],
];

// All sound is made live with WebAudio: no audio files.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = store.get('neonRacer.muted') === '1';
    this.musicOn = false;
    this.bpm = 112;
    this.stepDur = 60 / this.bpm / 4;
    this.loop = 0;
  }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this._build();
      }
      if (this.ctx.state !== 'running') this.ctx.resume();
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.connect(this.ctx.destination);
      s.start(0);
    } catch (e) { /* audio is optional */ }
  }

  _build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(c.destination);
    this.sfx = c.createGain();
    this.sfx.connect(this.master);
    this.music = c.createGain();
    this.music.gain.value = 0.3;
    this.music.connect(this.master);

    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.engFilter = c.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 500;
    this.engFilter.Q.value = 5;
    this.engGain = c.createGain();
    this.engGain.gain.value = 0;
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.sfx);
    const osc = (type, g) => {
      const o = c.createOscillator();
      o.type = type;
      const gn = c.createGain();
      gn.gain.value = g;
      o.connect(gn);
      gn.connect(this.engFilter);
      o.start();
      return o;
    };
    this.o1 = osc('sawtooth', 0.5);
    this.o2 = osc('square', 0.28);
    this.o3 = osc('sine', 0.6);

    const loopNoise = (type, freq, q) => {
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.sfx);
      src.start();
      return { f, g };
    };
    this.driftN = loopNoise('bandpass', 2300, 7);
    this.boostN = loopNoise('lowpass', 900, 1);

    this.delay = c.createDelay(1.0);
    this.delay.delayTime.value = this.stepDur * 3;
    const fb = c.createGain();
    fb.gain.value = 0.35;
    const wet = c.createGain();
    wet.gain.value = 0.35;
    this.delay.connect(fb); fb.connect(this.delay);
    this.delay.connect(wet); wet.connect(this.music);
    this.ready = true;
  }

  get time() { return this.ctx ? this.ctx.currentTime : 0; }

  setMuted(m) {
    this.muted = m;
    store.set('neonRacer.muted', m ? '1' : '0');
    if (this.ready) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  suspend() { try { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); } catch (e) { /* ignore */ } }
  resume() { try { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); } catch (e) { /* ignore */ } }

  setEngine(sf, throttle, boost, on) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const gears = [0, 0.2, 0.4, 0.6, 0.8, 1.6];
    let g = 0;
    while (g < gears.length - 2 && sf > gears[g + 1]) g++;
    const rpm = Math.min(1, (sf - gears[g]) / (gears[g + 1] - gears[g]));
    const r = 0.25 + 0.75 * rpm;
    const base = 34 + g * 7 + r * 62 + boost * 18 + (sf < 0.05 ? throttle * 25 : 0);
    this.o1.frequency.setTargetAtTime(base, t, 0.04);
    this.o2.frequency.setTargetAtTime(base * 1.505, t, 0.04);
    this.o3.frequency.setTargetAtTime(base * 0.5, t, 0.04);
    this.engFilter.frequency.setTargetAtTime(260 + r * 1300 + throttle * 500 + boost * 1400, t, 0.05);
    this.engGain.gain.setTargetAtTime(on ? 0.05 + throttle * 0.05 + boost * 0.04 : 0, t, 0.08);
  }

  setDrift(a) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.driftN.g.gain.setTargetAtTime(a * 0.09, t, 0.06);
    this.driftN.f.frequency.setTargetAtTime(2000 + a * 600, t, 0.1);
  }

  setBoost(a) {
    if (!this.ready) return;
    this.boostN.g.gain.setTargetAtTime(a * 0.22, this.ctx.currentTime, 0.08);
  }

  stopLoops() {
    this.setEngine(0, 0, 0, false);
    this.setDrift(0);
    this.setBoost(0);
  }

  tone(freq, dur, type = 'square', vol = 0.15, when = 0, slideTo = 0, dest = null) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, vol, type, freq, when = 0, dest = null, freqEnd = 0) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest || this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  boostPickup() {
    this.tone(330, 0.35, 'sawtooth', 0.12, 0, 1320);
    this.tone(660, 0.3, 'square', 0.06, 0.05, 1760);
  }

  starPickup() {
    [84, 88, 91, 96].forEach((m, i) => this.tone(mtof(m), 0.18, 'triangle', 0.16, i * 0.045));
  }

  whoosh() { this.noise(0.7, 0.35, 'bandpass', 300, 0, null, 2600); }

  bump(strength) {
    const v = Math.min(1, strength / 20);
    this.noise(0.25, 0.5 * v + 0.1, 'lowpass', 500);
    this.tone(90, 0.2, 'sine', 0.35 * v + 0.05, 0, 40);
  }

  countBeep(go) {
    if (go) { this.tone(880, 0.6, 'square', 0.16); this.tone(1760, 0.6, 'sine', 0.08); }
    else this.tone(440, 0.25, 'square', 0.14);
  }

  lapDing() {
    this.tone(mtof(81), 0.25, 'triangle', 0.18);
    this.tone(mtof(88), 0.4, 'triangle', 0.18, 0.12);
  }

  fanfare(place) {
    const seq = place === 1 ? [72, 76, 79, 84, 79, 84, 88] : [72, 76, 79, 84];
    seq.forEach((m, i) => {
      this.tone(mtof(m), 0.32, 'square', 0.1, i * 0.13);
      this.tone(mtof(m - 12), 0.32, 'triangle', 0.12, i * 0.13);
    });
  }

  click() { this.tone(1200, 0.06, 'square', 0.06); }

  startMusic() {
    if (!this.ready || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this._sched(), 25);
  }

  stopMusic() {
    this.musicOn = false;
    clearInterval(this.timer);
  }

  setMusicLevel(v) {
    if (this.ready) this.music.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3);
  }

  _sched() {
    if (!this.ready || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (this.nextTime < now - 0.05) this.nextTime = now + 0.05;
    while (this.nextTime < now + 0.15) {
      this._playStep(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step = (this.step + 1) % 64;
      if (this.step === 0) this.loop++;
    }
  }

  _voice(freq, t, dur, type, vol, cutoff, toDelay) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.music);
    if (toDelay) g.connect(this.delay);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _playStep(st, t) {
    const c = this.ctx;
    const bar = Math.floor(st / 16), s = st % 16;
    const ch = CHORDS[bar];
    const sd = this.stepDur;
    this._voice(mtof(ch.bass + (s % 4 === 2 ? 12 : 0)), t, sd * 0.9, 'sawtooth', 0.22, 600 + (s % 4 === 0 ? 300 : 0), false);
    const tones = [...ch.tones, ch.tones[0] + 12];
    this._voice(mtof(tones[ARP[s]] + 12), t, sd * 0.8, 'square', 0.05, 2600, true);
    if (s === 0) {
      for (const m of ch.tones) {
        for (const det of [-6, 6]) {
          const o = c.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(m);
          o.detune.value = det;
          const f = c.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.value = 1100;
          const g = c.createGain();
          const len = sd * 16;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.022, t + 0.4);
          g.gain.setValueAtTime(0.022, t + len - 0.3);
          g.gain.linearRampToValueAtTime(0.0001, t + len);
          o.connect(f); f.connect(g); g.connect(this.music);
          o.start(t);
          o.stop(t + len + 0.05);
        }
      }
    }
    if (this.loop % 2 === 1) {
      for (const [ls, m, l] of LEAD) {
        if (ls === st) {
          const o = c.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(m);
          const lfo = c.createOscillator();
          lfo.frequency.value = 5.5;
          const lg = c.createGain();
          lg.gain.value = 4;
          lfo.connect(lg); lg.connect(o.detune);
          const f = c.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.value = 2400;
          const g = c.createGain();
          const len = sd * l;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
          g.gain.setValueAtTime(0.07, t + len * 0.7);
          g.gain.exponentialRampToValueAtTime(0.0001, t + len);
          o.connect(f); f.connect(g); g.connect(this.music); g.connect(this.delay);
          o.start(t); lfo.start(t);
          o.stop(t + len + 0.05); lfo.stop(t + len + 0.05);
        }
      }
    }
    if (s % 4 === 0) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      const g = c.createGain();
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      o.connect(g); g.connect(this.music);
      o.start(t); o.stop(t + 0.35);
    }
    if (s === 4 || s === 12) {
      this.noise(0.16, 0.35, 'highpass', 1200, t - c.currentTime, this.music);
      this.tone(190, 0.1, 'triangle', 0.18, t - c.currentTime, 120, this.music);
    }
    if (s % 2 === 1) this.noise(0.04, s % 4 === 3 ? 0.12 : 0.07, 'highpass', 7500, t - c.currentTime, this.music);
  }
}
