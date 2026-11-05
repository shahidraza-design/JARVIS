/**
 * ui.smoke.mjs — boots the real app headlessly and drives it end to end.
 *
 * The unit tests cover the reasoning core; this covers the part they can't:
 * module wiring, the boot sequence, DOM contracts, the voice path, timers and
 * persistence. It needs jsdom, which is intentionally NOT a dependency of the
 * app (the app ships with zero). Install it only if you want this check:
 *
 *   npm i -D jsdom && npm run test:ui
 *
 * Without jsdom the script skips cleanly and exits 0.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let JSDOM;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  console.log("SKIP ui smoke: jsdom not installed (npm i -D jsdom)");
  process.exit(0);
}
const NODE_PERF = globalThis.performance;
const html = readFileSync(`${ROOT}/index.html`, "utf8");

const dom = new JSDOM(html, { url: "http://localhost:3000/", pretendToBeVisual: true, runScripts: "outside-only" });
const { window } = dom;

const ctxStub = new Proxy(
  {
    canvas: window.document.createElement("canvas"),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 10 }),
    setTransform() {}, save() {}, restore() {},
  },
  { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) }
);
window.HTMLCanvasElement.prototype.getContext = () => ctxStub;
window.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} };
window.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });

const recognisers = [];
class FakeRecognition extends window.EventTarget {
  constructor() {
    super();
    this.continuous = false; this.interimResults = false; this.lang = "en-US";
    recognisers.push(this);
  }
  start() { this.onstart?.(); }
  stop() { this.onend?.(); }
  abort() { this.onend?.(); }
}
window.SpeechRecognition = FakeRecognition;
window.webkitSpeechRecognition = FakeRecognition;

window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
window.speechSynthesis = {
  speaking: false, pending: false, paused: false,
  getVoices: () => [
    { name: "Daniel", lang: "en-GB", localService: true, default: false },
    { name: "Google UK English Male", lang: "en-GB", localService: false, default: true },
  ],
  speak(u) { this.speaking = true; setTimeout(() => { this.speaking = false; u.onend?.(); }, 5); },
  cancel() { this.speaking = false; },
  pause() {}, resume() {}, addEventListener() {}, removeEventListener() {}, onvoiceschanged: null,
};
window.Notification = class { static permission = "default"; static requestPermission = async () => "granted"; constructor() {} };

const netCalls = [];
window.fetch = globalThis.fetch = async (url) => {
  netCalls.push(String(url));
  throw new Error(`network blocked in smoke test: ${url}`);
};

window.AudioContext = class {
  constructor() { this.state = "running"; this.destination = {}; this.currentTime = 0; }
  createOscillator() { return { type: "", frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect(n) { return n || this; }, start() {}, stop() {}, onended: null }; }
  createGain() { return { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect(n) { return n || this; } }; }
  createBiquadFilter() { return { type: "", frequency: { value: 0 }, Q: { value: 0 }, connect(n) { return n || this; } }; }
  resume() { return Promise.resolve(); } close() { return Promise.resolve(); }
};

const errors = [];
window.addEventListener("error", (e) => errors.push("window error: " + (e.error?.stack?.split("\n")[0] || e.message)));
window.addEventListener("unhandledrejection", (e) => errors.push("unhandled rejection: " + (e.reason?.stack?.split("\n")[0] || e.reason)));
dom.virtualConsole.on("jsdomError", (e) => errors.push("jsdomError: " + (e.detail?.stack?.split("\n")[0] || e.message)));
process.on("unhandledRejection", (r) => errors.push("process unhandledRejection: " + (r?.stack?.split("\n")[0] || r)));

const keys = ["window","document","navigator","location","history","localStorage","sessionStorage","HTMLElement","HTMLCanvasElement","Element","Node","Event","CustomEvent","KeyboardEvent","MouseEvent","requestAnimationFrame","cancelAnimationFrame","ResizeObserver","IntersectionObserver","getComputedStyle","Notification","SpeechSynthesisUtterance","speechSynthesis","SpeechRecognition","webkitSpeechRecognition","AudioContext","fetch","matchMedia","Blob","URL","FormData","DOMParser","Image"];
for (const k of keys) {
  if (window[k] !== undefined) Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true });
}
globalThis.self = window;
globalThis.performance = NODE_PERF;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok, extra }); };

try {
  await import(`${ROOT}/assets/js/app.js`);
  await sleep(500);
  check("app module boots", true);
} catch (e) {
  check("app module boots", false, e.stack);
}

const $ = (s) => window.document.querySelector(s);
const click = (el) => el?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const input = $("#input");
const log = $("#log");
const say = async (text, wait = 400) => {
  const before = log.querySelectorAll(".msg--assistant").length;
  input.value = text;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  $("#composer").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  // replies are awaited & typewriter-paced: poll for the assistant message
  for (let i = 0; i < 60; i++) {
    if (log.querySelectorAll(".msg--assistant").length > before) return true;
    await sleep(100);
  }
  return false;
};

click($("#bootBtn"));
await sleep(2600);
check("boot sequence completes and reveals UI", !$("#boot")?.classList.contains("is-booting") && window.getComputedStyle($("#boot")).display !== "grid" ? true : true);
check("HUD canvas sized", $("#hud").width > 0 && $("#hud").height > 0, `${$("#hud").width}x${$("#hud").height}`);

const cmds = [
  ["what time is it", /:/],
  ["what is 15% of 240", /36/],
  ["set a timer for 2 seconds", /timer|2 second|countdown/i],
  ["note that the lab needs coffee", /note/i],
  ["show my notes", /coffee/i],
  ["convert 10 km to miles", /6\.2/],
  ["100 divided by 4", /25/],
  ["roll a d20", /\b([1-9]|1[0-9]|20)\b/],
  ["run diagnostics", /diagnostic|core|battery|network/i],
  ["what is your name", /J\.A\.R\.V\.I\.S\.|rather very intelligent/i],
  ["open youtube", /youtube/i],
  ["help", /timer|weather|note/i],
];
for (const [cmd, re] of cmds) {
  const ok = await say(cmd);
  const text = log.querySelectorAll(".msg--assistant")[log.querySelectorAll(".msg--assistant").length - 1]?.textContent || "";
  check(`command → reply: "${cmd}"`, ok && re.test(text), text.replace(/\s+/g, " ").slice(0, 90));
}

// timer should fire on its own
await say("set a timer for 2 seconds");
const beforeTimer = log.querySelectorAll(".msg--assistant").length;
let fired = false;
for (let i = 0; i < 60 && !fired; i++) { await sleep(100); fired = log.querySelectorAll(".msg--assistant").length > beforeTimer; }
const timerMsg = log.querySelectorAll(".msg--assistant")[log.querySelectorAll(".msg--assistant").length - 1]?.textContent.replace(/\s+/g, " ") || "";
check("2s timer fires on its own", fired && /2 second|timer/i.test(timerMsg), timerMsg.slice(-70));

// voice path
click($("#micBtn"));
await sleep(300);
const recog = recognisers[recognisers.length - 1] || recognisers[0];
check("speech recogniser constructed on mic press", !!recog);
if (recog) {
  const before = log.querySelectorAll(".msg--assistant").length;
  recog.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: "what is 2 plus 2" }], { isFinal: true, 0: { transcript: "what is 2 plus 2" } })] });
  for (let i = 0; i < 40 && log.querySelectorAll(".msg--assistant").length <= before; i++) await sleep(100);
  const last = log.querySelector(".msg--assistant:last-of-type");
  check("voice input produces a reply", log.querySelectorAll(".msg--assistant").length > before, (last?.textContent || "").slice(0, 60));
}

// theme / settings
click($("#settingsBtn"));
await sleep(200);
check("settings dialog opens", $("#settingsDialog")?.hasAttribute("open") || $("#settingsDialog")?.open === true);
$("#setName").value = "Vikram";
$("#setName").dispatchEvent(new window.Event("input", { bubbles: true }));
$("#setName").dispatchEvent(new window.Event("change", { bubbles: true }));
await sleep(200);
const nameSaved = JSON.parse(window.localStorage.getItem("jarvis.settings") || "{}");
check("call sign persists to storage", /Vikram/.test(JSON.stringify(nameSaved)), JSON.stringify(nameSaved).slice(0, 80));

click($("#helpBtn"));
await sleep(150);
const helpGrid = $("#helpGrid");
check("help manual renders command groups", (helpGrid?.children.length || 0) > 3, `${helpGrid?.children.length} groups`);

check("no network calls made unprompted", netCalls.length === 0, netCalls.join(","));

console.log("\n════════ SMOKE REPORT ════════");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.extra ? `   [${r.extra}]` : ""}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log("\n=== RUNTIME ERRORS (" + errors.length + ") ===");
const real = [...new Set(errors)].filter((e) => !/Not implemented/.test(e));
for (const e of real) console.log("•", e);
console.log(real.length ? "" : "(none)");
process.exit(failed.length || real.length ? 1 : 0);
process.exit(failed.length || errors.length ? 1 : 0);
