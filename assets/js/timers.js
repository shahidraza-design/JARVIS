/* ═══════════════════════════════════════════════════════════════
   timers.js — persistent timers & reminders
   ═══════════════════════════════════════════════════════════════ */

import { storage, clamp } from "./util.js";

const KEY = "timers";
const MAX_ITEMS = 24;

let seq = 0;
const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

export class TimerService {
  constructor({ onChange, onFire } = {}) {
    this.onChange = onChange || (() => {});
    this.onFire = onFire || (() => {});
    const stored = storage.get(KEY, []);
    this.items = Array.isArray(stored)
      ? stored.filter((i) => i && Number.isFinite(i.endsAt)).slice(0, MAX_ITEMS)
      : [];
    this._firing = new Set();
    this._tick = this._tick.bind(this);
    this._interval = setInterval(this._tick, 400);
    // Defer the first pass so callers can finish wiring their onChange handler.
    setTimeout(this._tick, 0);
  }

  add({ ms, label, kind = "timer" }) {
    const duration = clamp(Math.round(ms), 1000, 7 * 24 * 3600 * 1000);
    const item = {
      id: newId(),
      label: (label || (kind === "reminder" ? "Reminder" : "Timer")).slice(0, 120),
      kind,
      duration,
      endsAt: Date.now() + duration,
      createdAt: Date.now(),
    };
    this.items.push(item);
    if (this.items.length > MAX_ITEMS) this.items = this.items.slice(-MAX_ITEMS);
    this._persist();
    this.onChange();
    return item;
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.items.length !== before) {
      this._persist();
      this.onChange();
      return true;
    }
    return false;
  }

  clear(kind = null) {
    const before = this.items.length;
    this.items = kind ? this.items.filter((i) => i.kind !== kind) : [];
    if (this.items.length !== before) {
      this._persist();
      this.onChange();
    }
    return before - this.items.length;
  }

  list() {
    return [...this.items].sort((a, b) => a.endsAt - b.endsAt);
  }

  remaining(item) {
    return Math.max(0, item.endsAt - Date.now());
  }

  _persist() {
    storage.set(KEY, this.items);
  }

  _tick() {
    const now = Date.now();
    const due = this.items.filter((i) => i.endsAt <= now && !this._firing.has(i.id));
    if (!due.length) return;
    due.forEach((item) => this._firing.add(item.id));
    this.items = this.items.filter((i) => !due.some((d) => d.id === i.id));
    this._persist();
    this.onChange();
    due.forEach((item) => {
      this._firing.delete(item.id);
      try {
        this.onFire(item);
      } catch (err) {
        console.error("timer fire failed", err);
      }
    });
  }

  destroy() {
    clearInterval(this._interval);
  }
}
