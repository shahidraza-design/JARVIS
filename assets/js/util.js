/* ═══════════════════════════════════════════════════════════════
   util.js — DOM helpers, safe math, units, time parsing, storage
   ═══════════════════════════════════════════════════════════════ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pad2 = (n) => String(n).padStart(2, "0");
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strip characters that sound bad when spoken by TTS. */
export function stripForSpeech(text = "") {
  return String(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_`>]/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ─────────────────────────── storage ─────────────────────────── */
const NS = "jarvis";

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(`${NS}.${key}`);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`${NS}.${key}`, JSON.stringify(value));
    } catch {
      /* quota or private mode — fail silently */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(`${NS}.${key}`);
    } catch {}
  },
  wipe() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(`${NS}.`))
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
  },
};

/* ─────────────────────────── math ─────────────────────────── */

const MATH_FUNCS = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  log: Math.log10,
  ln: Math.log,
  log2: Math.log2,
  exp: Math.exp,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
};

const MATH_CONSTS = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
};

const WORD_OPS = [
  [/\b(divided by|divide by|over)\b/g, "/"],
  [/\b(multiplied by|multiply by|times)\b/g, "*"],
  [/\b(plus|add)\b/g, "+"],
  [/\b(minus|subtract|less)\b/g, "-"],
  [/\b(to the power of|raised to|power)\b/g, "^"],
  [/\bpercent of\b/g, "% of"],
  [/\bpoint\b/g, "."],
  [/\bsquared\b/g, "^2"],
  [/\bcubed\b/g, "^3"],
];

function normalizeExpr(raw) {
  let s = String(raw).toLowerCase().trim();
  s = s.replace(/^(jarvis[,\s]*)?(hey[,\s]+jarvis[,\s]*)?/i, "");
  s = s.replace(/\b(please|thanks|thank you|for me|jarvis)\b/g, " ");
  s = s.replace(/\b(what is|what's|whats|how much is|calculate|compute|solve|evaluate|work out)\b/g, " ");
  s = s.replace(/[?=]/g, " ").trim();
  for (const [re, rep] of WORD_OPS) s = s.replace(re, rep);
  s = s
    .replace(/[×✕✖]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/√/g, "sqrt")
    .replace(/\*\*/g, "^")
    .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*/g, "($1/100)*")
    .replace(/(\d)[,٬](\d{3})(?!\d)/g, "$1$2");
  // "x" between digits means multiplication, e.g. 4x12
  s = s.replace(/(\d)\s*[x×]\s*(\d)/g, "$1*$2");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " ") { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      // exponent notation 1e5
      if (src[j] === "e" && /[0-9+-]/.test(src[j + 1] || "")) {
        let k = j + 1;
        if (/[+-]/.test(src[k])) k++;
        if (/[0-9]/.test(src[k] || "")) {
          while (k < src.length && /[0-9]/.test(src[k])) k++;
          j = k;
        }
      }
      const text = src.slice(i, j);
      const value = Number(text);
      if (!Number.isFinite(value)) throw new Error(`Bad number: ${text}`);
      tokens.push({ type: "num", value });
      i = j;
      continue;
    }
    if (/[a-z]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-z0-9]/.test(src[j])) j++;
      tokens.push({ type: "id", value: src.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/%^(),".includes(ch)) {
      tokens.push({ type: ch === "(" || ch === ")" || ch === "," ? "sep" : "op", value: ch });
      i++;
      continue;
    }
    throw new Error(`Unsupported character: ${ch}`);
  }
  return tokens;
}

/**
 * Evaluate an arithmetic expression without eval().
 * Supports + - * / % ^, parentheses, functions (sqrt, sin…), constants (pi, e).
 * @returns {number}
 */
export function evaluateMath(raw) {
  const src = normalizeExpr(raw);
  if (!src) throw new Error("Nothing to compute");
  const tokens = tokenize(src);
  let p = 0;

  const peek = () => tokens[p];
  const atOp = (...ops) => peek()?.type === "op" && ops.includes(peek().value);
  const atSep = (v) => peek()?.type === "sep" && peek().value === v;

  function expression() {
    let v = term();
    while (atOp("+", "-")) {
      const op = tokens[p++].value;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  function term() {
    let v = unary();
    for (;;) {
      if (atOp("*", "/", "%")) {
        const op = tokens[p++].value;
        const r = unary();
        if (op === "*") v *= r;
        else if (op === "/") {
          if (r === 0) throw new Error("Division by zero");
          v /= r;
        } else {
          if (r === 0) throw new Error("Division by zero");
          v %= r;
        }
      } else if (atSep("(") || peek()?.type === "num" || peek()?.type === "id") {
        // implicit multiplication: 2pi, 3(4+1), 2 sqrt(9)
        v *= unary();
      } else {
        break;
      }
    }
    return v;
  }

  function unary() {
    if (atOp("-", "+")) {
      const op = tokens[p++].value;
      const v = unary();
      return op === "-" ? -v : v;
    }
    return power();
  }

  function power() {
    const base = atom();
    if (atOp("^")) {
      p++;
      const exponent = unary();
      return Math.pow(base, exponent);
    }
    return base;
  }

  function atom() {
    const t = peek();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.type === "num") { p++; return t.value; }
    if (t.type === "id") {
      p++;
      const name = t.value;
      if (atSep("(")) {
        p++;
        const args = [];
        if (!atSep(")")) {
          args.push(expression());
          while (atSep(",")) { p++; args.push(expression()); }
        }
        if (!atSep(")")) throw new Error("Missing closing parenthesis");
        p++;
        const fn = MATH_FUNCS[name];
        if (!fn) throw new Error(`I don't know the function “${name}”`);
        const out = fn(...args);
        if (!Number.isFinite(out)) throw new Error("That result isn't a real number");
        return out;
      }
      if (name in MATH_CONSTS) return MATH_CONSTS[name];
      throw new Error(`I don't recognise “${t.value}”`);
    }
    if (atSep("(")) {
      p++;
      const v = expression();
      if (!atSep(")")) throw new Error("Missing closing parenthesis");
      p++;
      return v;
    }
    throw new Error(`Unexpected “${t.value}”`);
  }

  const result = expression();
  if (p < tokens.length) throw new Error("I couldn't parse the rest of that expression");
  if (!Number.isFinite(result)) throw new Error("That result isn't a finite number");
  // kill floating point fuzz, keep useful precision
  return Math.round(result * 1e10) / 1e10;
}

/** True when the string looks like it is worth handing to the math engine. */
export function looksLikeMath(raw) {
  const s = String(raw).toLowerCase();
  if (!/[0-9]/.test(s)) return false;
  if (!/[+\-*/^%×÷]|plus|minus|times|divided by|percent of|sqrt|root/.test(s)) return false;
  if (/\b(weather|temperature|remind|timer|note|convert|who|when was|open|search|forecast)\b/.test(s)) return false;
  return true;
}

/* ─────────────────────────── units ─────────────────────────── */

const UNIT_ALIASES = {
  m: "m", meter: "m", meters: "m", metre: "m", metres: "m",
  km: "km", kilometer: "km", kilometers: "km", kilometre: "km", kilometres: "km", kms: "km",
  cm: "cm", centimeter: "cm", centimeters: "cm", centimetre: "cm", centimetres: "cm",
  mm: "mm", millimeter: "mm", millimeters: "mm", millimetre: "mm", millimetres: "mm",
  mi: "mi", mile: "mi", miles: "mi",
  ft: "ft", foot: "ft", feet: "ft",
  in: "in", inch: "in", inches: "in",
  yd: "yd", yard: "yd", yards: "yd",
  nmi: "nmi", "nautical mile": "nmi", "nautical miles": "nmi",
  kg: "kg", kilogram: "kg", kilograms: "kg", kilo: "kg", kilos: "kg",
  g: "g", gram: "g", grams: "g",
  mg: "mg", milligram: "mg", milligrams: "mg",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  oz: "oz", ounce: "oz", ounces: "oz",
  t: "t", ton: "t", tons: "t", tonne: "t", tonnes: "t",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  gal: "gal", gallon: "gal", gallons: "gal",
  qt: "qt", quart: "qt", quarts: "qt",
  cup: "cup", cups: "cup",
  s: "s", sec: "s", secs: "s", second: "s", seconds: "s",
  min: "min", mins: "min", minute: "min", minutes: "min",
  h: "h", hr: "h", hrs: "h", hour: "h", hours: "h",
  day: "day", days: "day", week: "week", weeks: "week",
  b: "b", byte: "b", bytes: "b",
  kb: "kb", mb: "mb", gb: "gb", tb: "tb",
  kmh: "kmh", kph: "kmh", "km/h": "kmh", mph: "mph", "m/s": "ms", knot: "knot", knots: "knot",
  celsius: "c", c: "c", centigrade: "c",
  fahrenheit: "f", f: "f",
  kelvin: "k", k: "k",
};

const UNIT_TABLES = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, ft: 0.3048, in: 0.0254, yd: 0.9144, nmi: 1852 },
  mass: { kg: 1, g: 0.001, mg: 1e-6, lb: 0.45359237, oz: 0.028349523125, t: 1000 },
  volume: { l: 1, ml: 0.001, gal: 3.785411784, qt: 0.946352946, cup: 0.2365882365 },
  time: { s: 1, min: 60, h: 3600, day: 86400, week: 604800 },
  data: { b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 },
  speed: { ms: 1, kmh: 1 / 3.6, mph: 0.44704, knot: 0.514444 },
  temp: { c: 1, f: 1, k: 1 },
};

const UNIT_LABELS = {
  m: "m", km: "km", cm: "cm", mm: "mm", mi: "mi", ft: "ft", in: "in", yd: "yd", nmi: "nmi",
  kg: "kg", g: "g", mg: "mg", lb: "lb", oz: "oz", t: "t",
  l: "L", ml: "mL", gal: "gal", qt: "qt", cup: "cups",
  s: "s", min: "min", h: "h", day: "days", week: "weeks",
  b: "B", kb: "KB", mb: "MB", gb: "GB", tb: "TB",
  kmh: "km/h", mph: "mph", ms: "m/s", knot: "kn",
  c: "°C", f: "°F", k: "K",
};

export const unitLabel = (u) => UNIT_LABELS[u] || u;

export function normalizeUnit(raw) {
  if (!raw) return null;
  const key = String(raw).toLowerCase().trim().replace(/\./g, "").replace(/\s+/g, " ");
  return UNIT_ALIASES[key] || null;
}

function categoryOf(unit) {
  for (const [cat, table] of Object.entries(UNIT_TABLES)) {
    if (unit in table) return cat;
  }
  return null;
}

/** Convert a value between units. Returns null when incompatible. */
export function convertUnits(value, fromRaw, toRaw) {
  const from = normalizeUnit(fromRaw);
  const to = normalizeUnit(toRaw);
  if (!from || !to) return null;
  const catA = categoryOf(from);
  const catB = categoryOf(to);
  if (!catA || catA !== catB) return null;

  if (catA === "temp") {
    let celsius;
    if (from === "c") celsius = value;
    else if (from === "f") celsius = (value - 32) * (5 / 9);
    else celsius = value - 273.15;
    let out;
    if (to === "c") out = celsius;
    else if (to === "f") out = celsius * (9 / 5) + 32;
    else out = celsius + 273.15;
    return out;
  }

  const table = UNIT_TABLES[catA];
  return (value * table[from]) / table[to];
}

/** Try to understand "convert 10 km to miles" / "how many kg in 150 lb". */
export function parseConversion(raw) {
  const s = String(raw).toLowerCase().replace(/,/g, "");
  let m = s.match(/(?:convert\s+)?(-?\d+(?:\.\d+)?)\s*([a-z°/]+)\s*(?:to|into|in)\s*([a-z°/]+)/);
  if (!m) m = s.match(/(?:how many)\s+([a-z°/]+)\s+(?:are\s+)?in\s+(-?\d+(?:\.\d+)?)\s*([a-z°/]+)/);
  if (!m) return null;
  if (/^how many/.test(s) && m.length === 4 && !/^\d/.test(m[1] ?? "")) {
    return { value: Number(m[2]), from: m[3], to: m[1] };
  }
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return { value, from: m[2], to: m[3] };
}

export function formatNumber(n) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e9)) return n.toExponential(4);
  const rounded = Math.round(n * 1e4) / 1e4;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/* ─────────────────────────── time ─────────────────────────── */

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

export function formatLongDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const bits = [];
  if (h) bits.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m) bits.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (s || !bits.length) bits.push(`${s} second${s === 1 ? "" : "s"}`);
  return bits.join(" ");
}

export function clockTime(date = new Date()) {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
}

export function clockTimeShort(date = new Date()) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
}

export function longDate(date = new Date()) {
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** Parse the delay in "in 20 minutes", "for 5 min", "90 seconds". */
export function parseDuration(raw) {
  const s = String(raw).toLowerCase();
  const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g;
  let total = 0;
  let found = false;
  let match;
  while ((match = re.exec(s))) {
    const n = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(n)) continue;
    found = true;
    if (/^h/.test(unit)) total += n * 3600000;
    else if (/^m/.test(unit)) total += n * 60000;
    else total += n * 1000;
  }
  return found && total > 0 ? total : null;
}

/**
 * Parse when a reminder should fire: "in 10 minutes", "at 6:30 pm", "tomorrow at 9".
 * Returns { at: timestamp, label } or null.
 */
export function parseWhen(raw, now = new Date()) {
  const s = String(raw).toLowerCase();

  const delay = s.match(/\bin\s+((?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b[\s,and]*)+)/);
  if (delay) {
    const ms = parseDuration(delay[1]);
    if (ms) return { at: now.getTime() + ms, label: `in ${formatLongDuration(ms)}`, relative: true };
  }

  const at = s.match(/\b(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (at) {
    let hour = Number(at[1]);
    const minute = at[2] ? Number(at[2]) : 0;
    const meridian = at[3];
    if (meridian === "pm" && hour < 12) hour += 12;
    if (meridian === "am" && hour === 12) hour = 0;
    if (!meridian && hour < 7) hour += 12; // "at 5" almost always means 5 pm
    if (hour > 23 || minute > 59) return null;
    const target = new Date(now);
    target.setSeconds(0, 0);
    target.setHours(hour, minute, 0, 0);
    if (/\btomorrow\b/.test(s)) target.setDate(target.getDate() + 1);
    else if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    return { at: target.getTime(), label: clockTimeShort(target), relative: false };
  }

  if (/\btonight\b/.test(s)) {
    const target = new Date(now);
    target.setHours(21, 0, 0, 0);
    if (target.getTime() <= now.getTime()) return null;
    return { at: target.getTime(), label: clockTimeShort(target), relative: false };
  }
  return null;
}

export function parseSize(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
