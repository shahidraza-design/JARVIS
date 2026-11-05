/* ═══════════════════════════════════════════════════════════════
   audio.js — tiny synthesised UI sounds (no asset files)
   ═══════════════════════════════════════════════════════════════ */

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  /** Must be called from a user gesture to satisfy autoplay policy. */
  unlock() {
    if (!this.enabled) return null;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) { this.enabled = false; return null; }
      if (!this.ctx) this.ctx = new Ctx();
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    } catch {
      this.enabled = false;
      return null;
    }
  }

  tone({ freq = 660, dur = 0.08, type = "sine", gain = 0.05, slideTo = null, delay = 0 }) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  click() { this.tone({ freq: 880, dur: 0.05, type: "triangle", gain: 0.028 }); }
  blip() { this.tone({ freq: 1180, dur: 0.06, type: "sine", gain: 0.03 }); }
  wake() {
    this.tone({ freq: 520, dur: 0.1, type: "sine", gain: 0.05 });
    this.tone({ freq: 780, dur: 0.12, type: "sine", gain: 0.04, delay: 0.08 });
  }
  listenStart() { this.tone({ freq: 420, slideTo: 620, dur: 0.16, type: "sine", gain: 0.045 }); }
  listenEnd() { this.tone({ freq: 620, slideTo: 400, dur: 0.14, type: "sine", gain: 0.04 }); }
  send() { this.tone({ freq: 740, slideTo: 1040, dur: 0.09, type: "triangle", gain: 0.035 }); }
  error() {
    this.tone({ freq: 240, dur: 0.16, type: "sawtooth", gain: 0.04 });
    this.tone({ freq: 180, dur: 0.2, type: "sawtooth", gain: 0.03, delay: 0.1 });
  }
  chime() {
    const notes = [784, 988, 1319];
    notes.forEach((f, i) => this.tone({ freq: f, dur: 0.5, type: "sine", gain: 0.06, delay: i * 0.14 }));
  }
  boot() {
    this.tone({ freq: 60, slideTo: 130, dur: 1.1, type: "sine", gain: 0.06 });
    [330, 440, 660, 880].forEach((f, i) =>
      this.tone({ freq: f, dur: 0.3, type: "triangle", gain: 0.028, delay: 0.18 * i }),
    );
  }
  alarm() {
    for (let i = 0; i < 3; i++) {
      this.tone({ freq: 988, dur: 0.14, type: "square", gain: 0.04, delay: i * 0.3 });
      this.tone({ freq: 1319, dur: 0.14, type: "square", gain: 0.035, delay: i * 0.3 + 0.15 });
    }
  }
}
