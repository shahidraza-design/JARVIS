/* ═══════════════════════════════════════════════════════════════
   Test suite for the J.A.R.V.I.S. reasoning core.
   Run with:  npm test
   ═══════════════════════════════════════════════════════════════ */

import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateMath, convertUnits, parseConversion, parseDuration, parseWhen,
  formatDuration, formatNumber, normalizeUnit,
} from "../assets/js/util.js";
import { respond, resolvePending, HELP_GROUPS } from "../assets/js/brain.js";
import { splitForSpeech } from "../assets/js/speech.js";

/* ── a browser-free stand-in for the runtime context ── */
function makeCtx(seed = {}) {
  const notes = [];
  const scheduled = [];
  const ctx = {
    settings: { name: "Vikram", city: "Kolkata", rate: 1, ...(seed.settings || {}) },
    sessionStart: Date.now() - 125000,
    voiceName: "Test Voice",
    recognitionSupported: true,
    accent: "cyan",
    cleared: false,
    standbyCalled: false,
    updateSettings(patch) { Object.assign(ctx.settings, patch); },
    setAccent(value) { ctx.accent = value; },
    notes: () => notes,
    addNote(text) {
      const note = { id: `n${notes.length}`, text, ts: Date.now() };
      notes.unshift(note);
      return note;
    },
    deleteNote(id) {
      const at = notes.findIndex((n) => n.id === id);
      if (at >= 0) notes.splice(at, 1);
    },
    clearNotes() {
      const count = notes.length;
      notes.length = 0;
      return count;
    },
    timers: {
      add(item) {
        const record = { ...item, id: `t${scheduled.length}` };
        scheduled.push(record);
        return record;
      },
      list: () => scheduled,
      remove: () => true,
      clear() {
        const count = scheduled.length;
        scheduled.length = 0;
        return count;
      },
    },
    async openUrl() { return true; },
    clearLog() { ctx.cleared = true; },
    sound() {},
    standby() { ctx.standbyCalled = true; },
  };
  return { ctx, notes, scheduled };
}

/* ─────────────────────────── math ─────────────────────────── */

test("arithmetic respects precedence", () => {
  assert.equal(evaluateMath("2 + 2"), 4);
  assert.equal(evaluateMath("2 + 3 * 4"), 14);
  assert.equal(evaluateMath("(2 + 3) * 4"), 20);
  assert.equal(evaluateMath("2 ^ 10"), 1024);
  assert.equal(evaluateMath("10 / 4"), 2.5);
  assert.equal(evaluateMath("-3 + 1"), -2);
});

test("math understands function calls, constants and words", () => {
  assert.equal(evaluateMath("sqrt(144)"), 12);
  assert.equal(evaluateMath("sqrt(9) + 1"), 4);
  assert.ok(Math.abs(evaluateMath("2 * pi") - Math.PI * 2) < 1e-9);
  assert.equal(evaluateMath("what is 12 times 12?"), 144);
  assert.equal(evaluateMath("100 divided by 4"), 25);
  assert.equal(evaluateMath("5 squared"), 25);
});

test("math handles percent-of shorthand", () => {
  assert.equal(evaluateMath("15% of 240"), 36);
  assert.equal(evaluateMath("10 percent of 50"), 5);
});

test("math rejects dangerous or malformed input", () => {
  assert.throws(() => evaluateMath("alert(1)"));
  assert.throws(() => evaluateMath("10 / 0"), /Division by zero/);
  assert.throws(() => evaluateMath("2 +"));
  assert.throws(() => evaluateMath(""));
});

/* ─────────────────────────── units ─────────────────────────── */

test("unit conversion covers length, mass, temperature", () => {
  assert.ok(Math.abs(convertUnits(10, "km", "miles") - 6.2137119) < 1e-6);
  assert.equal(convertUnits(1, "kg", "g"), 1000);
  assert.equal(convertUnits(100, "c", "f"), 212);
  assert.equal(convertUnits(32, "f", "c"), 0);
  assert.ok(Math.abs(convertUnits(1, "kg", "pounds") - 2.2046226) < 1e-6);
});

test("unit conversion refuses incompatible categories", () => {
  assert.equal(convertUnits(1, "kg", "km"), null);
  assert.equal(convertUnits(1, "bananas", "km"), null);
  assert.equal(normalizeUnit("kilometres"), "km");
});

test("conversion phrases are parsed", () => {
  assert.deepEqual(parseConversion("convert 10 km to miles"), { value: 10, from: "km", to: "miles" });
  const reverse = parseConversion("how many kg in 150 lb");
  assert.equal(reverse.value, 150);
  assert.equal(normalizeUnit(reverse.to), "kg");
});

test("durations and clock targets parse", () => {
  assert.equal(parseDuration("set a timer for 5 minutes"), 300000);
  assert.equal(parseDuration("90 seconds"), 90000);
  assert.equal(parseDuration("1 hour and 30 minutes"), 5400000);
  assert.equal(parseDuration("no numbers here"), null);

  const now = new Date("2026-05-04T10:00:00");
  const inTen = parseWhen("remind me in 10 minutes", now);
  assert.equal(inTen.at - now.getTime(), 600000);

  const atSix = parseWhen("call mom at 6 pm", now);
  assert.ok(atSix.at > now.getTime());
  assert.equal(new Date(atSix.at).getHours(), 18);
});

test("formatting helpers behave", () => {
  assert.equal(formatDuration(65000), "1:05");
  assert.equal(formatDuration(3661000), "1:01:01");
  assert.equal(formatNumber(1234.5678), "1,234.5678");
});

/* ─────────────────────────── brain ─────────────────────────── */

test("assistant routes arithmetic and percentages", async () => {
  const { ctx } = makeCtx();
  const sum = await respond("what is 2 + 2", ctx);
  assert.match(sum.say, /4/);

  const percent = await respond("what is 15% of 240", ctx);
  assert.match(percent.say, /36/);
});

test("assistant converts units", async () => {
  const { ctx } = makeCtx();
  const res = await respond("convert 10 km to miles", ctx);
  assert.match(res.say, /6\.2137/);
});

test("assistant sets timers", async () => {
  const { ctx, scheduled } = makeCtx();
  const res = await respond("set a timer for 5 minutes", ctx);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 300000);
  assert.equal(scheduled[0].kind, "timer");
  assert.match(res.say, /5 minutes/);
});

test("assistant asks for a duration when the timer is underspecified", async () => {
  const { ctx, scheduled } = makeCtx();
  const res = await respond("set a timer", ctx);
  assert.equal(res.pending.kind, "timer-duration");
  assert.equal(scheduled.length, 0);

  const followUp = await resolvePending(res.pending, "90 seconds", ctx);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 90000);
  assert.match(followUp.say, /1 minute 30 seconds/);
});

test("assistant schedules reminders with a time", async () => {
  const { ctx, scheduled } = makeCtx();
  const res = await respond("remind me to stretch at 6 pm", ctx);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].kind, "reminder");
  assert.match(scheduled[0].label, /stretch/);
  assert.match(res.say, /remind you/i);
});

test("assistant asks when a reminder should fire", async () => {
  const { ctx, scheduled } = makeCtx();
  const res = await respond("remind me to call the lab", ctx);
  assert.equal(res.pending.kind, "when");
  assert.equal(scheduled.length, 0);

  await resolvePending(res.pending, "in 20 minutes", ctx);
  assert.equal(scheduled.length, 1);
  assert.ok(scheduled[0].ms > 19 * 60000 && scheduled[0].ms <= 20 * 60000);
});

test("notes are written, read back and cleared", async () => {
  const { ctx, notes } = makeCtx();
  await respond("note that the lab is out of coffee", ctx);
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /lab is out of coffee/);

  const read = await respond("show my notes", ctx);
  assert.match(read.say, /lab is out of coffee/);

  await respond("clear my notes", ctx);
  assert.equal(notes.length, 0);
});

test("fallback intent for unrelated text is helpful, not empty", async () => {
  const { ctx } = makeCtx();
  const res = await respond("zzzz qqqq", ctx);
  assert.ok(res.say.length > 10);
  assert.ok(res.html.length > 0);
});

test("identity, greeting and help respond in character", async () => {
  const { ctx } = makeCtx();
  const who = await respond("who are you?", ctx);
  assert.match(who.say, /J\.A\.R\.V\.I\.S\./);

  const hi = await respond("hello", ctx);
  assert.ok(hi.say.length > 20);

  const help = await respond("help", ctx);
  assert.match(help.html, /Timers/);
  assert.ok(HELP_GROUPS.length >= 4);
});

test("voice and interface controls mutate settings", async () => {
  const { ctx } = makeCtx();
  await respond("mute", ctx);
  assert.equal(ctx.settings.mute, true);

  await respond("unmute", ctx);
  assert.equal(ctx.settings.mute, false);

  await respond("speak faster", ctx);
  assert.ok(ctx.settings.rate > 1);

  await respond("switch to stealth mode", ctx);
  assert.equal(ctx.accent, "crimson");

  await respond("call me Tony", ctx);
  assert.equal(ctx.settings.name, "Tony");
});

test("standby and clear commands reach the runtime", async () => {
  const { ctx } = makeCtx();
  await respond("go to sleep", ctx);
  assert.equal(ctx.standbyCalled, true);

  await respond("clear the conversation", ctx);
  assert.equal(ctx.cleared, true);
});

test("diagnostics works without a browser", async () => {
  const { ctx } = makeCtx();
  const res = await respond("run diagnostics", ctx);
  assert.match(res.say, /Diagnostics complete/);
  assert.match(res.html, /Battery/);
});

test("weather without a city asks for one instead of guessing", async () => {
  const { ctx } = makeCtx({ settings: { city: "" } });
  const res = await respond("what's the weather?", ctx);
  assert.equal(res.pending.kind, "place");
  assert.match(res.say, /which city/i);
});

test("jokes and quotes are non-empty", async () => {
  const { ctx } = makeCtx();
  for (const cmd of ["tell me a joke", "give me a quote", "tell me a fact"]) {
    const res = await respond(cmd, ctx);
    assert.ok(res.say.length > 20, `${cmd} returned too little`);
  }
});

/* ─────────────────────────── speech ─────────────────────────── */

test("long replies are chunked for synthesis", () => {
  const short = splitForSpeech("All systems nominal.");
  assert.equal(short.length, 1);

  const long = "Sentence one is here. " .repeat(20);
  const chunks = splitForSpeech(long, 100);
  assert.ok(chunks.length > 1);
  chunks.forEach((chunk) => assert.ok(chunk.length <= 140));
});
