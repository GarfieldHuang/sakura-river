// Quiet synthesized soundscape: flowing river, wind, rain, rolling thunder, wind bells, pole splashes, birds.
export class Soundscape {
  constructor() { this.ctx = null; this.muted = false; this.ready = false; this.next = { bubble: 0, bell: 3, bird: 2 }; }
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    this.master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 3;
    const white = ctx.createBuffer(1, len, ctx.sampleRate), brown = ctx.createBuffer(1, len, ctx.sampleRate), pink = ctx.createBuffer(1, len, ctx.sampleRate);
    { const w = white.getChannelData(0), b = brown.getChannelData(0), p = pink.getChannelData(0); let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) { const r = Math.random() * 2 - 1; w[i] = r; last = (last + 0.02 * r) / 1.02; b[i] = last * 3.5;
        b0 = 0.99765 * b0 + r * 0.099; b1 = 0.963 * b1 + r * 0.2965; b2 = 0.57 * b2 + r * 1.0526; p[i] = (b0 + b1 + b2 + r * 0.1848) * 0.18; } }
    this.buf = { white, brown, pink };
    const loop = (buf, rate = 1) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(ctx.currentTime + Math.random() * 0.1); return s; };
    const chain = (src, nodes, gainV) => { let n = src; for (const x of nodes) { n.connect(x); n = x; } const g = ctx.createGain(); g.gain.value = gainV; n.connect(g); g.connect(this.master); return g; };
    const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    // river: deep rush + bright babble
    this.riverLow = chain(loop(brown), [filt('lowpass', 620)], 0.5);
    this.riverMid = chain(loop(pink, 0.9), [filt('bandpass', 900, 0.6)], 0.12);
    this.babbleF = filt('bandpass', 2200, 1.1);
    this.riverHi = chain(loop(white), [this.babbleF], 0.03);
    this.windF = filt('bandpass', 380, 0.6);
    this.wind = chain(loop(pink, 0.7), [this.windF], 0.0);
    this.rainHi = chain(loop(white, 1.0), [filt('highpass', 2400), filt('lowpass', 9000)], 0.0);
    this.rainLow = chain(loop(pink, 1.2), [filt('lowpass', 1100)], 0.0);
    this.ready = true;
  }
  toggle() { this.muted = !this.muted; if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.1); }
  update(dt, env, speed, windStr, t) {
    if (!this.ready) return; const ctx = this.ctx, now = ctx.currentTime;
    const gorge = env.gorge || 0;
    this.riverLow.gain.setTargetAtTime(0.42 + gorge * 0.25 + speed * 0.03, now, 0.5);
    this.riverMid.gain.setTargetAtTime(0.1 + gorge * 0.08, now, 0.5);
    this.babbleF.frequency.setTargetAtTime(1800 + 900 * Math.sin(t * 0.37) * Math.sin(t * 0.13), now, 0.3);
    this.riverHi.gain.setTargetAtTime(0.02 + 0.02 * (0.5 + 0.5 * Math.sin(t * 0.71)), now, 0.3);
    this.wind.gain.setTargetAtTime(0.03 + windStr * 0.07, now, 0.6);
    this.windF.frequency.setTargetAtTime(300 + windStr * 260, now, 0.8);
    this.rainHi.gain.setTargetAtTime(env.rain * 0.16, now, 0.8);
    this.rainLow.gain.setTargetAtTime(env.rain * 0.22, now, 0.8);
    // bubbles in the current
    if (t > this.next.bubble) { this.next.bubble = t + 0.08 + Math.random() * 0.5; this.bubble(); }
    if (t > this.next.bell && windStr > 0.7) { this.next.bell = t + 4 + Math.random() * 12; this.bell(); }
    if (t > this.next.bird && env.dayF > 0.6 && env.rain < 0.1) { this.next.bird = t + 3 + Math.random() * 9; this.bird(); }
  }
  bubble() {
    const ctx = this.ctx, now = ctx.currentTime; const o = ctx.createOscillator(), g = ctx.createGain();
    const f = 500 + Math.random() * 900; o.frequency.setValueAtTime(f, now); o.frequency.exponentialRampToValueAtTime(f * 1.7, now + 0.05);
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.012 + Math.random() * 0.012, now + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    o.connect(g); g.connect(this.master); o.start(now); o.stop(now + 0.08);
  }
  bell() {
    const ctx = this.ctx, now = ctx.currentTime; const base = 2400 + Math.random() * 900;
    for (const [m, a] of [[1, 0.012], [2.76, 0.005], [5.4, 0.002]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = base * m;
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(a, now + 0.004); g.gain.exponentialRampToValueAtTime(0.00001, now + 2.2 / m);
      o.connect(g); g.connect(this.master); o.start(now); o.stop(now + 2.5);
    }
  }
  bird() {
    const ctx = this.ctx; let now = ctx.currentTime; const n = 2 + Math.floor(Math.random() * 4); const f0 = 2600 + Math.random() * 1600;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(f0 * (1.2 + Math.random() * 0.4), now + 0.09);
      lfo.frequency.value = 40 + Math.random() * 30; lg.gain.value = 180; lfo.connect(lg); lg.connect(o.frequency);
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.006, now + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      o.connect(g); g.connect(this.master); o.start(now); o.stop(now + 0.14); lfo.start(now); lfo.stop(now + 0.14);
      now += 0.13 + Math.random() * 0.08;
    }
  }
  splash(strength = 1) {
    if (!this.ready) return; const ctx = this.ctx, now = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.buf.white; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.05 * strength, now + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(now, Math.random() * 2); s.stop(now + 0.4);
    const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.setValueAtTime(140, now); o.frequency.exponentialRampToValueAtTime(70, now + 0.12);
    og.gain.setValueAtTime(0.03 * strength, now + 0.05); og.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    o.connect(og); og.connect(this.master); o.start(now + 0.05); o.stop(now + 0.25);
  }
  thunder(dist) {
    if (!this.ready) return; const ctx = this.ctx; const delay = 0.5 + dist / 450; const now = ctx.currentTime + delay;
    const near = Math.max(0, 1 - dist / 900); const vol = 0.55 / (1 + dist / 700);
    const s = ctx.createBufferSource(); s.buffer = this.buf.brown; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(260 + near * 500, now); f.frequency.exponentialRampToValueAtTime(70, now + 6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, now);
    const dur = 5 + Math.random() * 3;
    g.gain.linearRampToValueAtTime(vol, now + 0.15 + (1 - near) * 0.5);
    for (let k = 1; k < 8; k++) g.gain.linearRampToValueAtTime(vol * (0.35 + 0.65 * Math.random()) * Math.exp(-k * 0.35), now + 0.3 + k * dur / 8);
    g.gain.linearRampToValueAtTime(0.0001, now + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(now, Math.random() * 2); s.stop(now + dur + 0.1);
    if (near > 0.3) {
      const c = ctx.createBufferSource(); c.buffer = this.buf.white; const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 900;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(0, now - 0.05); cg.gain.linearRampToValueAtTime(0.18 * near, now - 0.04); cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      c.connect(hf); hf.connect(cg); cg.connect(this.master); c.start(now - 0.05); c.stop(now + 0.6);
    }
  }
}
