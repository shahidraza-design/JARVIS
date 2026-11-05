/* ═══════════════════════════════════════════════════════════════
   hud.js — canvas arc-reactor visualiser
   ═══════════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;

export class Hud {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
    this.reducedMotion = reducedMotion;
    this.mode = "idle";
    this.level = 0.12;
    this.target = 0.12;
    this.time = 0;
    this.last = 0;
    this.running = false;
    this.w = 0;
    this.h = 0;
    this.particles = [];
    this.accent = [53, 224, 255];
    this.ok = [77, 255, 195];
    this.mix = 0;

    // Canvas 2D may be unavailable (old browsers, blocked contexts, headless
    // hosts). In that case fall back to a static ring rather than throwing —
    // a missing animation must never stop the assistant from booting.
    if (!this.ctx) {
      canvas.classList.add("hud--fallback");
      return;
    }

    this.refreshTheme();
    this._onResize = () => this.resize();
    // ResizeObserver is missing on older Safari; window resize still works.
    if (typeof ResizeObserver === "function") {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(canvas.parentElement || canvas);
    } else {
      window.addEventListener("resize", this._onResize, { passive: true });
    }
    this.resize();
  }

  get disabled() {
    return !this.ctx;
  }

  refreshTheme() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb").trim();
    const parts = raw.split(",").map((n) => Number(n.trim()));
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) this.accent = parts;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === "listening") this.pulse(0.9);
    if (mode === "thinking") this.pulse(0.5);
  }

  pulse(strength = 0.6) {
    this.target = Math.min(1.2, Math.max(this.target, strength));
  }

  resize() {
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const size = Math.max(80, Math.min(rect.width || 260, rect.height || 260));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = size;
    this.h = size;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._seedParticles(size);
  }

  _seedParticles(size) {
    const count = size < 200 ? 26 : 46;
    this.particles = Array.from({ length: count }, () => ({
      angle: Math.random() * TAU,
      radius: 0.52 + Math.random() * 0.42,
      speed: 0.04 + Math.random() * 0.16,
      size: 0.5 + Math.random() * 1.3,
      alpha: 0.12 + Math.random() * 0.45,
    }));
  }

  start() {
    if (this.running || !this.ctx) return;
    this.running = true;
    const loop = (ts) => {
      if (!this.running) return;
      const dt = this.last ? Math.min(48, ts - this.last) : 16;
      this.last = ts;
      this.time += (dt / 1000) * (this.reducedMotion ? 0.35 : 1);
      this._update(dt);
      this._draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }

  _update() {
    const t = this.time;
    switch (this.mode) {
      case "listening":
        this.target = 0.62 + 0.42 * Math.abs(Math.sin(t * 5.3)) + Math.random() * 0.16;
        break;
      case "speaking":
        this.target = 0.42 + 0.34 * Math.abs(Math.sin(t * 7.7 + 1)) + Math.random() * 0.1;
        break;
      case "thinking":
        this.target = 0.26 + 0.12 * Math.abs(Math.sin(t * 3.1));
        break;
      default:
        this.target = 0.17 + 0.07 * Math.abs(Math.sin(t * 1.15));
    }
    this.level += (this.target - this.level) * 0.14;
    const mixTarget = this.mode === "listening" ? 1 : 0;
    this.mix += (mixTarget - this.mix) * 0.08;
  }

  _col(alpha) {
    const { accent, ok, mix } = this;
    const r = Math.round(accent[0] + (ok[0] - accent[0]) * mix);
    const g = Math.round(accent[1] + (ok[1] - accent[1]) * mix);
    const b = Math.round(accent[2] + (ok[2] - accent[2]) * mix);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  _draw() {
    const ctx = this.ctx;
    const { w, h } = this;
    if (!ctx || !w || !h) return;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 5;
    const t = this.time;
    const level = this.level;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineCap = "round";

    // ambient bloom
    const bloom = ctx.createRadialGradient(0, 0, R * 0.05, 0, 0, R);
    bloom.addColorStop(0, this._col(0.16 + level * 0.14));
    bloom.addColorStop(0.4, this._col(0.05));
    bloom.addColorStop(1, this._col(0));
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();

    // outer tick ring
    ctx.strokeStyle = this._col(0.22);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, R - 0.5, 0, TAU);
    ctx.stroke();

    ctx.save();
    ctx.rotate(t * 0.05);
    for (let deg = 0; deg < 360; deg += 5) {
      const a = (deg * Math.PI) / 180;
      const long = deg % 30 === 0;
      const inner = R - (long ? 9 : 5);
      ctx.strokeStyle = this._col(long ? 0.5 : 0.2);
      ctx.lineWidth = long ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * (R - 1), Math.sin(a) * (R - 1));
      ctx.stroke();
    }
    ctx.restore();

    // orbiting dashed rings
    const rings = [
      { r: R * 0.87, speed: 0.22, dash: [2, 16], alpha: 0.42, width: 1.2 },
      { r: R * 0.8, speed: -0.34, dash: [34, 26, 6, 26], alpha: 0.3, width: 1 },
      { r: R * 0.55, speed: 0.46, dash: [1, 9], alpha: 0.3, width: 1 },
    ];
    rings.forEach((ring) => {
      ctx.save();
      ctx.rotate(t * ring.speed);
      ctx.setLineDash(ring.dash);
      ctx.strokeStyle = this._col(ring.alpha);
      ctx.lineWidth = ring.width;
      ctx.beginPath();
      ctx.arc(0, 0, ring.r, 0, TAU);
      ctx.stroke();
      ctx.restore();
    });

    // sweeping scanner arc
    const sweepAngle = t * 0.9;
    ctx.save();
    ctx.rotate(sweepAngle);
    const scan = ctx.createLinearGradient(-R, 0, R, 0);
    scan.addColorStop(0, this._col(0.9));
    scan.addColorStop(1, this._col(0));
    ctx.strokeStyle = scan;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.87, -0.5, 0.05);
    ctx.stroke();
    ctx.restore();

    // particles
    for (const p of this.particles) {
      const speed = this.reducedMotion ? p.speed * 0.25 : p.speed;
      p.angle += speed * 0.01;
      const radius = p.radius * R;
      const x = Math.cos(p.angle) * radius;
      const y = Math.sin(p.angle) * radius;
      ctx.fillStyle = this._col(p.alpha * (0.5 + level * 0.7));
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, TAU);
      ctx.fill();
    }

    // waveform ring
    const bars = 96;
    const baseR = R * 0.645;
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * TAU - Math.PI / 2;
      const wave =
        0.5 +
        0.5 *
          Math.sin(i * 0.42 + t * 4.1) *
          Math.sin(i * 0.11 - t * 1.7 + 0.6);
      const energy = level * (0.35 + wave * 0.95);
      const len = 3 + energy * R * 0.2;
      const alpha = 0.22 + energy * 0.55;
      ctx.strokeStyle = this._col(Math.min(1, alpha));
      ctx.lineWidth = i % 6 === 0 ? 2.2 : 1.3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * baseR, Math.sin(a) * baseR);
      ctx.lineTo(Math.cos(a) * (baseR + len), Math.sin(a) * (baseR + len));
      ctx.stroke();
    }

    // inner resonator ring
    ctx.strokeStyle = this._col(0.35 + level * 0.25);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.44, 0, TAU);
    ctx.stroke();

    ctx.save();
    ctx.rotate(-t * 0.55);
    ctx.setLineDash([R * 0.9, R * 2.4]);
    ctx.strokeStyle = this._col(0.6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.44, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // core glow
    const coreR = R * (0.16 + level * 0.045);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR * 3.1);
    glow.addColorStop(0, this._col(0.85));
    glow.addColorStop(0.28, this._col(0.3));
    glow.addColorStop(1, this._col(0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, coreR * 3.1, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = this._col(0.85);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, coreR, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = this._col(0.18 + level * 0.35);
    ctx.beginPath();
    ctx.arc(0, 0, coreR * 0.82, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "rgba(240, 253, 255, " + (0.7 + level * 0.3) + ")";
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.6, coreR * 0.3), 0, TAU);
    ctx.fill();

    ctx.restore();
  }
}
