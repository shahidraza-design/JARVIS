/* ═══════════════════════════════════════════════════════════════
   app.js — J.A.R.V.I.S. runtime: UI, voice loop, persistence
   ═══════════════════════════════════════════════════════════════ */

import { $, escapeHtml, storage, sleep, formatDuration, clockTimeShort, pad2 } from "./util.js";
import { SpeechEngine } from "./speech.js";
import { Sfx } from "./audio.js";
import { Hud } from "./hud.js";
import { TimerService } from "./timers.js";
import { respond, resolvePending, HELP_GROUPS } from "./brain.js";
import { QUOTES } from "./skills.js";

/* ─────────────────────────── DOM ─────────────────────────── */

const dom = {
  boot: $("#boot"),
  bootLog: $("#bootLog"),
  bootBtn: $("#bootBtn"),
  hud: $("#hud"),
  modeLabel: $("#modeLabel"),
  modeSub: $("#modeSub"),
  micBtn: $("#micBtn"),
  micLabel: $("#micLabel"),
  micNote: $("#micNote"),
  composerMic: $("#composerMic"),
  log: $("#log"),
  typing: $("#typing"),
  composer: $("#composer"),
  input: $("#input"),
  interim: $("#interim"),
  hint: $("#hint"),
  statusPill: $("#statusPill"),
  statusText: $("#statusText"),
  statusMessage: $("#statusMessage"),
  clockTime: $("#clockTime"),
  clockDate: $("#clockDate"),
  uplinkText: $("#uplinkText"),
  muteBtn: $("#muteBtn"),
  clearBtn: $("#clearBtn"),
  quickChips: $("#quickChips"),
  scheduleList: $("#scheduleList"),
  scheduleEmpty: $("#scheduleEmpty"),
  schedCount: $("#schedCount"),
  noteList: $("#noteList"),
  noteEmpty: $("#noteEmpty"),
  noteCount: $("#noteCount"),
  tabSchedule: $("#tabSchedule"),
  tabMemory: $("#tabMemory"),
  paneSchedule: $("#paneSchedule"),
  paneMemory: $("#paneMemory"),
  directive: $("#directiveText"),
  helpBtn: $("#helpBtn"),
  settingsBtn: $("#settingsBtn"),
  settingsDialog: $("#settingsDialog"),
  helpDialog: $("#helpDialog"),
  helpGrid: $("#helpGrid"),
  toasts: $("#toasts"),
  bars: { power: $("#barPower"), core: $("#barCore"), uplink: $("#barUplink") },
  vals: { power: $("#valPower"), core: $("#valCore"), uplink: $("#valUplink") },
  telemetry: {
    battery: $("#tBattery"),
    network: $("#tNetwork"),
    cores: $("#tCores"),
    tz: $("#tTz"),
    session: $("#tSession"),
    voice: $("#tVoice"),
  },
  settings: {
    name: $("#setName"),
    voice: $("#setVoice"),
    lang: $("#setLang"),
    rate: $("#setRate"),
    rateVal: $("#rateVal"),
    pitch: $("#setPitch"),
    pitchVal: $("#pitchVal"),
    city: $("#setCity"),
    swatches: $("#swatches"),
    continuous: $("#setContinuous"),
    wake: $("#setWake"),
    mute: $("#setMute"),
    reset: $("#resetBtn"),
  },
};

/* ─────────────────────────── state ─────────────────────────── */

function guessCity() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const tail = tz.split("/").pop() || "";
  const city = tail.replace(/_/g, " ").trim();
  if (/^(utc|gmt|etc|unknown)$/i.test(city)) return "";
  return city;
}

const DEFAULT_SETTINGS = {
  name: "",
  city: guessCity(),
  rate: 1,
  pitch: 0.9,
  mute: false,
  lang: "en-US",
  continuous: false,
  wake: false,
  voiceURI: "",
  accent: "cyan",
};

const settings = { ...DEFAULT_SETTINGS, ...(storage.get("settings", {}) || {}) };
const state = {
  booted: false,
  busy: false,
  pending: null,
  sessionStart: Date.now(),
  notes: Array.isArray(storage.get("notes", [])) ? storage.get("notes", []) : [],
  history: Array.isArray(storage.get("history", [])) ? storage.get("history", []) : [],
  online: navigator.onLine,
  battery: null,
};

const speech = new SpeechEngine();
const sfx = new Sfx();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// A visual failure must never be fatal: fall back to a no-op HUD.
const hud = (() => {
  try {
    return new Hud(dom.hud, { reducedMotion });
  } catch (err) {
    console.warn("HUD unavailable, continuing without it:", err);
    return { setMode() {}, pulse() {}, start() {}, stop() {}, refreshTheme() {} };
  }
})();
const notesList = dom.noteList;

/* ─────────────────────────── toasts ─────────────────────────── */

function toast(title, body, kind = "") {
  const el = document.createElement("div");
  el.className = `toast${kind ? ` toast--${kind}` : ""}`;
  el.innerHTML = `<b>${escapeHtml(title)}</b><span>${escapeHtml(body)}</span>`;
  dom.toasts.appendChild(el);
  setTimeout(() => {
    el.classList.add("is-out");
    setTimeout(() => el.remove(), 320);
  }, 5200);
}

/* ─────────────────────────── presence ─────────────────────────── */

const STATUS_TEXT = {
  ready: "READY",
  listening: "LISTENING",
  thinking: "PROCESSING",
  speaking: "SPEAKING",
  standby: "STANDBY",
  offline: "OFFLINE",
};

const MODE_TEXT = {
  ready: ["READY", "awaiting your command"],
  idle: ["IDLE", "reactor stable"],
  listening: ["LISTENING", "microphone open"],
  thinking: ["PROCESSING", "resolving intent"],
  speaking: ["SPEAKING", "voice output"],
  standby: ["STANDBY", "reactor idling"],
  offline: ["OFFLINE", "uplink severed"],
};

const FOOTER_TEXT = {
  ready: "ALL SYSTEMS NOMINAL",
  listening: "AUDIO CHANNEL OPEN",
  thinking: "PARSING REQUEST",
  speaking: "SYNTHESISING RESPONSE",
  standby: "REACTOR IDLING",
  offline: "WORKING OFFLINE",
};

function setMode(mode) {
  const [label, sub] = MODE_TEXT[mode] || MODE_TEXT.idle;
  dom.modeLabel.textContent = label;
  dom.modeSub.textContent = sub;
  const pillState = mode === "idle" ? "ready" : mode;
  dom.statusPill.dataset.state = pillState;
  dom.statusText.textContent = STATUS_TEXT[pillState] || "READY";
  dom.statusMessage.textContent = FOOTER_TEXT[pillState] || FOOTER_TEXT.ready;
  if (!state.online && mode !== "thinking" && mode !== "speaking") {
    dom.statusPill.dataset.state = "offline";
    dom.statusText.textContent = "OFFLINE";
  }
  hud.setMode(mode === "idle" ? "idle" : mode);
}

function setMicUI(listening) {
  dom.micBtn.classList.toggle("is-live", listening);
  dom.micBtn.setAttribute("aria-pressed", String(listening));
  dom.composerMic.classList.toggle("is-live", listening);
  dom.micLabel.textContent = listening ? "LISTENING — TAP TO STOP" : "TAP TO SPEAK";
  dom.micBtn.setAttribute("aria-label", listening ? "Stop listening" : "Start listening");
}

/* ─────────────────────────── transcript ─────────────────────────── */

const MAX_HISTORY = 60;

function timeLabel(date = new Date()) {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function addMessage({ role = "assistant", text = "", html = null, ts = Date.now(), persist = true }) {
  const el = document.createElement("article");
  el.className = `msg msg--${role}`;

  const when = new Date(ts);
  if (role === "system") {
    el.innerHTML = `<div class="msg__body"><div class="msg__text">${html || escapeHtml(text)}</div></div>`;
  } else {
    const from = role === "user" ? "YOU" : "J.A.R.V.I.S.";
    const ava = role === "user" ? "YOU" : "J";
    el.innerHTML = `
      <div class="msg__ava" aria-hidden="true">${ava}</div>
      <div class="msg__body">
        <div class="msg__meta"><b>${from}</b><time datetime="${when.toISOString()}">${timeLabel(when)}</time></div>
        <div class="msg__text">${html || escapeHtml(text).replace(/\n/g, "<br />")}</div>
      </div>`;
  }

  dom.log.appendChild(el);

  if (persist) {
    state.history.push({ role, text, html, ts });
    if (state.history.length > MAX_HISTORY) state.history = state.history.slice(-MAX_HISTORY);
    storage.set("history", state.history);
  }

  requestAnimationFrame(() => {
    try {
      // Not every engine implements scrollTo (older webviews, test DOMs).
      if (typeof dom.log.scrollTo === "function") {
        dom.log.scrollTo({ top: dom.log.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
      } else {
        dom.log.scrollTop = dom.log.scrollHeight;
      }
    } catch {
      /* scrolling is cosmetic — never let it break a reply */
    }
  });
  return el;
}

function renderHistory() {
  dom.log.innerHTML = "";
  if (!state.history.length) return;
  state.history.forEach((m) => addMessage({ ...m, persist: false }));
  addMessage({ role: "system", text: "session resumed", persist: false });
}

function clearTranscript() {
  state.history = [];
  storage.set("history", []);
  state.pending = null;
  dom.log.innerHTML = "";
  addMessage({
    role: "system",
    text: "Transcript cleared. " + (settings.name ? `Still here, ${settings.name}.` : "Still here."),
    persist: false,
  });
  speech.stopSpeaking();
}

/* ─────────────────────────── speaking ─────────────────────────── */

function speak(text) {
  if (!text || settings.mute) return Promise.resolve();
  return speech.speak(text);
}

/* ─────────────────────────── voice ─────────────────────────── */

const isEmbedded = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();

function micNoteDefault() {
  if (!speech.recognitionSupported) {
    dom.micNote.textContent = "Voice recognition is unavailable in this browser — typing works fully";
    dom.micNote.classList.add("is-warn");
    return;
  }
  dom.micNote.classList.remove("is-warn");
  dom.micNote.textContent = isEmbedded
    ? "Embedded preview: open in a new tab if the mic is blocked"
    : "Voice powered by your browser · Ctrl + Space";
}

function toggleMic() {
  sfx.unlock();
  if (!speech.recognitionSupported) {
    toast("Voice unavailable", "This browser has no SpeechRecognition API. Chrome or Edge will unlock voice.", "warn");
    dom.input.focus();
    return;
  }
  if (speech.listening) {
    speech.stopListening();
    sfx.listenEnd();
    setMode("ready");
    return;
  }
  speech.stopSpeaking();
  sfx.listenStart();
  speech.startListening();
}

function handleVoiceError(code) {
  if (code === "not-allowed" || code === "service-not-allowed") {
    dom.micNote.textContent = "Microphone blocked — allow access or open this page in its own tab";
    dom.micNote.classList.add("is-warn");
    toast("Microphone blocked", "Grant mic permission, or open the app in a new tab and try again.", "err");
    setMode("ready");
    return;
  }
  if (code === "audio-capture") {
    toast("No microphone", "I can't find an input device. Check your system sound settings.", "err");
    return;
  }
  if (code === "network") {
    toast("Recogniser offline", "Speech recognition needs a network connection in this browser.", "warn");
    return;
  }
  if (code === "unsupported") {
    toast("Voice unavailable", "This browser has no speech recognition. Typing still works.", "warn");
  }
}

function handleVoiceFinal(text) {
  dom.interim.textContent = "";
  dom.interim.classList.remove("is-live");
  const heard = text.trim();
  if (!heard) return;

  if (settings.wake && !/\bjarvis\b/i.test(heard)) {
    // Wake word not present: keep the channel open quietly.
    return;
  }

  sfx.listenEnd();
  if (!settings.continuous) speech.stopListening();
  handleInput(heard, { source: "voice" });
}

/* ─────────────────────────── context for the brain ─────────────────────────── */

function makeContext() {
  return {
    settings,
    sessionStart: state.sessionStart,
    voiceName: speech.voiceName,
    recognitionSupported: speech.recognitionSupported,
    updateSettings(patch) {
      Object.assign(settings, patch);
      persistSettings();
      applySettings();
    },
    setAccent,
    notes: () => state.notes,
    addNote(text) {
      const note = { id: `n${Date.now().toString(36)}`, text, ts: Date.now() };
      state.notes.unshift(note);
      state.notes = state.notes.slice(0, 100);
      storage.set("notes", state.notes);
      renderNotes();
      return note;
    },
    deleteNote(id) {
      state.notes = state.notes.filter((n) => n.id !== id);
      storage.set("notes", state.notes);
      renderNotes();
    },
    clearNotes() {
      const n = state.notes.length;
      state.notes = [];
      storage.set("notes", []);
      renderNotes();
      return n;
    },
    timers,
    async openUrl(url) {
      try {
        const win = window.open(url, "_blank", "noopener,noreferrer");
        return Boolean(win);
      } catch {
        return false;
      }
    },
    clearLog: clearTranscript,
    sound(name) {
      if (sfx[name]) sfx[name]();
    },
    standby() {
      speech.stopListening();
      speech.stopSpeaking();
      setMode("standby");
      dom.micNote.textContent = "Standing by. Tap the microphone or say “Jarvis”.";
    },
  };
}

/* ─────────────────────────── input pipeline ─────────────────────────── */

async function handleInput(rawText, { source = "text" } = {}) {
  const text = String(rawText || "").trim();
  if (!text) return;
  if (state.busy) return;

  sfx.unlock();
  sfx.send();
  state.busy = true;
  dom.typing.hidden = false;
  dom.micBtn.classList.remove("is-live");
  setMode("thinking");

  addMessage({ role: "user", text });
  dom.input.value = "";
  hud.pulse(0.8);

  // A short beat so the interface feels considered rather than instant.
  await sleep(reducedMotion ? 60 : 260 + Math.random() * 240);

  const ctx = makeContext();
  let result = null;
  try {
    if (state.pending) {
      result = await resolvePending(state.pending, text, ctx);
      if (result) state.pending = result.pending || null;
    }
    if (!result) {
      result = await respond(text, ctx);
      state.pending = result.pending || null;
    }
  } catch (err) {
    console.error(err);
    result = {
      say: `Something in my reasoning core misfired, ${settings.name || "sir"}. Try that once more.`,
      html: `<p>Something in my reasoning core misfired. Try that once more.</p>`,
    };
  }

  dom.typing.hidden = true;
  addMessage({ role: "assistant", text: result.say || "", html: result.html });

  state.busy = false;

  // Pause the recogniser while I speak, so I don't transcribe myself.
  if (source === "voice" || speech.listening) speech.stopListening();

  if (!settings.mute && speech.synthesisSupported) setMode("speaking");
  await speak(result.say || "");
  if (!state.online) setMode("ready");
  else setMode(speech.listening ? "listening" : "ready");

  if (settings.continuous && state.booted && !state.busy) {
    await sleep(450);
    if (!speech.listening) speech.startListening();
  }
}

/* ─────────────────────────── notes ─────────────────────────── */

function renderNotes() {
  dom.noteCount.textContent = String(state.notes.length);
  dom.noteEmpty.hidden = state.notes.length > 0;
  notesList.innerHTML = state.notes
    .map((n) => {
      const when = new Date(n.ts);
      return `<li class="item" data-note="${n.id}">
        <div class="item__label">${escapeHtml(n.text)}<small>saved ${escapeHtml(when.toLocaleDateString(undefined, { day: "numeric", month: "short" }))} · ${timeLabel(when).slice(0, 5)}</small></div>
        <span></span>
        <button class="item__x" type="button" data-remove-note="${n.id}" aria-label="Delete note">✕</button>
      </li>`;
    })
    .join("");
}

notesList.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-remove-note]");
  if (!btn) return;
  const id = btn.getAttribute("data-remove-note");
  state.notes = state.notes.filter((n) => n.id !== id);
  storage.set("notes", state.notes);
  renderNotes();
  sfx.click();
});

/* ─────────────────────────── timers ─────────────────────────── */

const timers = new TimerService({
  onChange: () => renderSchedule(),
  onFire: (item) => {
    const label = item.label || "Timer";
    const isReminder = item.kind === "reminder";
    sfx.alarm();
    hud.pulse(1.2);
    toast(isReminder ? "REMINDER" : "TIMER COMPLETE", label, "warn");
    addMessage({
      role: "assistant",
      text: isReminder ? `Reminder: ${label}` : `Time's up — your ${label} is complete.`,
      html: `<p><strong>${isReminder ? "Reminder" : "Timer"}:</strong> ${escapeHtml(label)}</p>`,
    });
    if (!settings.mute) {
      speak(isReminder ? `Reminder, ${settings.name || "sir"}: ${label}` : `Time's up, ${settings.name || "sir"}. Your ${label} is complete.`);
    }
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(isReminder ? "J.A.R.V.I.S. — Reminder" : "J.A.R.V.I.S. — Timer", { body: label });
      }
    } catch {}
  },
});

function itemMarkup(item) {
  const remaining = Math.max(0, item.endsAt - Date.now());
  const due = new Date(item.endsAt);
  const kind = item.kind === "reminder" ? "REMINDER" : "TIMER";
  return `<li class="item" data-timer="${item.id}">
    <div class="item__label">${escapeHtml(item.label)}<small>${kind} · due ${escapeHtml(clockTimeShort(due))}</small></div>
    <span class="item__time" data-ends="${item.endsAt}">${formatDuration(remaining)}</span>
    <button class="item__x" type="button" data-remove-timer="${item.id}" aria-label="Cancel ${kind.toLowerCase()}">✕</button>
  </li>`;
}

function renderSchedule() {
  const items = timers.list();
  dom.schedCount.textContent = String(items.length);
  dom.scheduleEmpty.hidden = items.length > 0;
  dom.scheduleList.innerHTML = items.map(itemMarkup).join("");
}

dom.scheduleList.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-remove-timer]");
  if (!btn) return;
  timers.remove(btn.getAttribute("data-remove-timer"));
  sfx.click();
});

function tickCountdowns() {
  const now = Date.now();
  dom.scheduleList.querySelectorAll(".item__time[data-ends]").forEach((el) => {
    const ends = Number(el.getAttribute("data-ends"));
    el.textContent = formatDuration(ends - now);
  });
}

/* ─────────────────────────── clock & telemetry ─────────────────────────── */

function updateClock() {
  const now = new Date();
  dom.clockTime.textContent = now.toLocaleTimeString(undefined, { hour12: false });
  dom.clockDate.textContent = now.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });

  const session = Date.now() - state.sessionStart;
  const total = Math.floor(session / 1000);
  dom.telemetry.session.textContent = `${pad2(Math.floor(total / 3600))}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`;
}

async function refreshBattery() {
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      const apply = () => {
        state.battery = { level: Math.round(b.level * 100), charging: b.charging };
        dom.telemetry.battery.textContent = `${state.battery.level}%${b.charging ? " ⚡" : ""}`;
      };
      apply();
      b.addEventListener("levelchange", apply);
      b.addEventListener("chargingchange", apply);
      return;
    }
  } catch {}
  dom.telemetry.battery.textContent = "n/a";
}

function updateNetwork() {
  state.online = navigator.onLine;
  const conn = navigator.connection?.effectiveType;
  dom.uplinkText.textContent = state.online ? "ONLINE" : "OFFLINE";
  dom.telemetry.network.textContent = state.online ? (conn ? conn.toUpperCase() : "LINKED") : "OFFLINE";
  dom.telemetry.cores.textContent = `${navigator.hardwareConcurrency || "?"} vCPU`;
  dom.telemetry.tz.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || "—";
  if (!state.online) {
    dom.statusPill.dataset.state = "offline";
    dom.statusText.textContent = "OFFLINE";
  }
}

function driftMeters() {
  const drift = (value, min, max, step) =>
    Math.min(max, Math.max(min, value + (Math.random() - 0.5) * step));
  const power = Math.round(drift(Number(dom.vals.power.textContent) || 97, 91, 99.4, 3));
  const core = Math.round(drift(Number(dom.vals.core.textContent) || 34, 26, 46, 7));
  const uplink = state.online ? Math.round(drift(Number(dom.vals.uplink.textContent) || 89, 78, 97, 6)) : 8;
  dom.vals.power.textContent = `${power}%`;
  dom.bars.power.style.width = `${power}%`;
  dom.vals.core.textContent = `${core}%`;
  dom.bars.core.style.width = `${core}%`;
  dom.vals.uplink.textContent = `${uplink}%`;
  dom.bars.uplink.style.width = `${uplink}%`;
}

/* ─────────────────────────── settings ─────────────────────────── */

function persistSettings() {
  storage.set("settings", settings);
}

function setAccent(accent) {
  const allowed = ["cyan", "amber", "jade", "violet", "crimson"];
  const value = allowed.includes(accent) ? accent : "cyan";
  settings.accent = value;
  document.documentElement.dataset.accent = value;
  persistSettings();
  hud.refreshTheme();
  document.querySelectorAll(".swatch").forEach((sw) => {
    const on = sw.dataset.accent === value;
    sw.classList.toggle("is-active", on);
    sw.setAttribute("aria-checked", String(on));
  });
}

function populateVoices() {
  const voices = speech.englishVoices();
  const current = settings.voiceURI;
  dom.settings.voice.innerHTML = `<option value="">System default (${escapeHtml(speech._autoPick(voices)?.name || "auto")})</option>`;
  voices
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} — ${v.lang}`;
      opt.selected = v.voiceURI === current;
      dom.settings.voice.appendChild(opt);
    });
  dom.telemetry.voice.textContent = speech.voiceName.replace(/\s*\(.*?\)\s*/g, " ").slice(0, 24) || "system";
}

function applySettings({ refreshVoices = true } = {}) {
  document.documentElement.dataset.accent = settings.accent || "cyan";
  hud.refreshTheme();
  speech.configure({
    voiceURI: settings.voiceURI,
    rate: Number(settings.rate),
    pitch: Number(settings.pitch),
    mute: Boolean(settings.mute),
    lang: settings.lang,
    continuous: Boolean(settings.continuous),
    wake: Boolean(settings.wake),
  });
  dom.muteBtn.textContent = settings.mute ? "VOICE OFF" : "VOICE ON";
  dom.muteBtn.setAttribute("aria-pressed", String(Boolean(settings.mute)));
  dom.settings.mute.checked = Boolean(settings.mute);
  dom.settings.continuous.checked = Boolean(settings.continuous);
  dom.settings.wake.checked = Boolean(settings.wake);
  document.querySelectorAll(".swatch").forEach((sw) => {
    const on = sw.dataset.accent === (settings.accent || "cyan");
    sw.classList.toggle("is-active", on);
    sw.setAttribute("aria-checked", String(on));
  });
  dom.telemetry.voice.textContent = speech.voiceName.replace(/\s*\(.*?\)\s*/g, " ").slice(0, 24) || "system";
  if (refreshVoices) populateVoices();
}

function syncSettingsForm() {
  dom.settings.name.value = settings.name || "";
  dom.settings.city.value = settings.city || "";
  dom.settings.lang.value = settings.lang;
  dom.settings.rate.value = String(settings.rate);
  dom.settings.pitch.value = String(settings.pitch);
  dom.settings.rateVal.textContent = `${Number(settings.rate).toFixed(2)}×`;
  dom.settings.pitchVal.textContent = Number(settings.pitch).toFixed(2);
  dom.settings.continuous.checked = Boolean(settings.continuous);
  dom.settings.wake.checked = Boolean(settings.wake);
  dom.settings.mute.checked = Boolean(settings.mute);
  dom.settings.voice.value = settings.voiceURI || "";
  populateVoices();
}

dom.settings.name.addEventListener("input", (e) => {
  settings.name = e.target.value.trim();
  persistSettings();
});
dom.settings.city.addEventListener("input", (e) => {
  settings.city = e.target.value.trim();
  persistSettings();
});
dom.settings.voice.addEventListener("change", (e) => {
  settings.voiceURI = e.target.value;
  persistSettings();
  speech.configure({ voiceURI: settings.voiceURI });
  dom.telemetry.voice.textContent = speech.voiceName.slice(0, 24);
  speak(`Voice updated, ${settings.name || "sir"}. How does this sound?`);
});
dom.settings.lang.addEventListener("change", (e) => {
  settings.lang = e.target.value;
  persistSettings();
  speech.configure({ lang: settings.lang });
  if (speech.recognition) speech.recognition.lang = settings.lang;
});
dom.settings.rate.addEventListener("input", (e) => {
  settings.rate = Number(e.target.value);
  dom.settings.rateVal.textContent = `${settings.rate.toFixed(2)}×`;
  speech.configure({ rate: settings.rate });
  persistSettings();
});
dom.settings.pitch.addEventListener("input", (e) => {
  settings.pitch = Number(e.target.value);
  dom.settings.pitchVal.textContent = settings.pitch.toFixed(2);
  speech.configure({ pitch: settings.pitch });
  persistSettings();
});
dom.settings.continuous.addEventListener("change", (e) => {
  settings.continuous = e.target.checked;
  speech.configure({ continuous: settings.continuous });
  persistSettings();
  if (!settings.continuous) speech.stopListening();
});
dom.settings.wake.addEventListener("change", (e) => {
  settings.wake = e.target.checked;
  persistSettings();
});
dom.settings.mute.addEventListener("change", (e) => {
  settings.mute = e.target.checked;
  persistSettings();
  applySettings({ refreshVoices: false });
  if (!settings.mute) speak("Voice restored.");
});
dom.settings.swatches.addEventListener("click", (e) => {
  const sw = e.target.closest(".swatch");
  if (!sw) return;
  setAccent(sw.dataset.accent);
  sfx.click();
});
dom.settings.reset.addEventListener("click", () => {
  if (!window.confirm("Wipe all J.A.R.V.I.S. memory — notes, timers, transcript and preferences?")) return;
  storage.wipe();
  state.notes = [];
  state.history = [];
  timers.clear();
  dom.log.innerHTML = "";
  Object.assign(settings, DEFAULT_SETTINGS, { city: guessCity() });
  persistSettings();
  applySettings();
  syncSettingsForm();
  renderNotes();
  renderSchedule();
  addMessage({ role: "system", text: "Memory wiped. A fresh start.", persist: false });
  toast("Memory wiped", "Everything you had told me is gone.", "warn");
});

dom.muteBtn.addEventListener("click", () => {
  settings.mute = !settings.mute;
  persistSettings();
  applySettings({ refreshVoices: false });
  if (settings.mute) speech.stopSpeaking();
  else speak("Voice restored.");
  sfx.click();
});

dom.clearBtn.addEventListener("click", () => {
  clearTranscript();
  sfx.click();
});

/* ─────────────────────────── help ─────────────────────────── */

function buildHelp() {
  dom.helpGrid.innerHTML = HELP_GROUPS.map(
    (group) => `<div class="help-group">
      <h3>${escapeHtml(group.title)}</h3>
      <ul>${group.items
        .map(([cmd, desc]) => `<li><code>${escapeHtml(cmd)}</code><span>${escapeHtml(desc)}</span></li>`)
        .join("")}</ul>
    </div>`,
  ).join("");
}

/* ─────────────────────────── dialogs ─────────────────────────── */

function openDialog(dialog) {
  sfx.click();
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

[dom.settingsDialog, dom.helpDialog].forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

dom.settingsBtn.addEventListener("click", () => {
  syncSettingsForm();
  openDialog(dom.settingsDialog);
});
dom.helpBtn.addEventListener("click", () => openDialog(dom.helpDialog));

/* ─────────────────────────── tabs ─────────────────────────── */

function selectTab(which) {
  const schedule = which === "schedule";
  dom.tabSchedule.classList.toggle("is-active", schedule);
  dom.tabMemory.classList.toggle("is-active", !schedule);
  dom.tabSchedule.setAttribute("aria-selected", String(schedule));
  dom.tabMemory.setAttribute("aria-selected", String(!schedule));
  dom.paneSchedule.classList.toggle("is-active", schedule);
  dom.paneMemory.classList.toggle("is-active", !schedule);
  dom.paneSchedule.hidden = !schedule;
  dom.paneMemory.hidden = schedule;
  sfx.click();
}

dom.tabSchedule.addEventListener("click", () => selectTab("schedule"));
dom.tabMemory.addEventListener("click", () => selectTab("memory"));

/* ─────────────────────────── events ─────────────────────────── */

dom.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  handleInput(dom.input.value);
});

dom.micBtn.addEventListener("click", toggleMic);
dom.composerMic.addEventListener("click", toggleMic);

dom.quickChips.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-cmd]");
  if (!chip) return;
  handleInput(chip.dataset.cmd);
});

dom.input.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    dom.input.blur();
  }
});

document.addEventListener("keydown", (event) => {
  const typing = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || "");
  if (event.ctrlKey && event.code === "Space") {
    event.preventDefault();
    toggleMic();
    return;
  }
  if (event.key === "Escape") {
    if (dom.settingsDialog.open) dom.settingsDialog.close();
    if (dom.helpDialog.open) dom.helpDialog.close();
    if (speech.speaking) speech.stopSpeaking();
    if (speech.listening) speech.stopListening();
    return;
  }
  if (!typing && event.key === "?") {
    event.preventDefault();
    openDialog(dom.helpDialog);
  }
  if (!typing && event.key === "/") {
    event.preventDefault();
    dom.input.focus();
  }
});

window.addEventListener("online", () => {
  updateNetwork();
  toast("Uplink restored", "Network connection is live again.");
  setMode("ready");
});
window.addEventListener("offline", () => {
  updateNetwork();
  toast("Uplink lost", "I'll keep working with local skills.", "warn");
  setMode("offline");
});

let directiveIndex = Math.floor(Math.random() * QUOTES.length);
function rotateDirective() {
  directiveIndex = (directiveIndex + 1) % QUOTES.length;
  const [text, by] = QUOTES[directiveIndex];
  dom.directive.style.opacity = "0";
  setTimeout(() => {
    dom.directive.textContent = `“${text}”`;
    dom.directive.parentElement.querySelector(".quote__by").textContent = `— ${by.toUpperCase()}`;
    dom.directive.style.opacity = "";
  }, 420);
}

dom.directive.style.transition = "opacity 0.35s ease";

/* ─────────────────────────── boot ─────────────────────────── */

const BOOT_LINES = [
  ["STARK INDUSTRIES // SECURE BOOT v4.2.1", ""],
  ["mounting neural lattice ............... OK", "ok"],
  ["calibrating arc reactor ............... 98%", ""],
  ["loading linguistic model .............. OK", "ok"],
  ["restoring local memory ................ OK", "ok"],
  ["voice synthesis ....................... READY", "ok"],
  ["uplink handshake ...................... LIVE", "ok"],
  ["J.A.R.V.I.S. ONLINE", "ok"],
];

async function runBoot() {
  dom.bootBtn.disabled = true;
  dom.bootBtn.textContent = "INITIALISING…";
  dom.bootLog.classList.add("is-live");
  sfx.unlock();
  sfx.boot();

  for (const [line, cls] of BOOT_LINES) {
    const span = document.createElement("span");
    span.className = `ln ${cls}`.trim();
    span.textContent = `> ${line}`;
    dom.bootLog.appendChild(span);
    dom.bootLog.scrollTop = dom.bootLog.scrollHeight;
    if (!reducedMotion) sfx.blip();
    await sleep(reducedMotion ? 40 : 150 + Math.random() * 110);
  }

  await sleep(reducedMotion ? 80 : 320);
  completeBoot();
}

async function completeBoot() {
  if (state.booted) return;
  state.booted = true;
  dom.boot.classList.add("is-out");
  setTimeout(() => { dom.boot.style.display = "none"; }, 950);

  state.sessionStart = Date.now();
  hud.start();
  hud.pulse(0.9);
  setMode("ready");
  micNoteDefault();
  renderNotes();
  renderSchedule();
  updateNetwork();
  updateClock();
  refreshBattery();
  setAccent(settings.accent || "cyan");
  applySettings();

  await sleep(240);

  const name = settings.name || "sir";
  const hour = new Date().getHours();
  const salutation = hour < 5 ? "Burning the midnight oil" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const greeting = `${salutation}, ${name}. All systems are online — reactor at ninety-eight percent. What shall we do?`;

  addMessage({
    role: "assistant",
    text: greeting,
    html: `<p>${salutation}, <strong>${escapeHtml(name)}</strong>. All systems are online — reactor at 98%, voice interface standing by.</p>
      <p><em>Try “weather in Kolkata”, “set a timer for 5 minutes”, “note that the lab needs coffee”, or say “help” for the full index.</em></p>`,
    persist: false,
  });

  await sleep(160);
  dom.input.focus({ preventScroll: true });
  speak(greeting);
  setMode("ready");

  // Ask for notification permission on the boot gesture so timers can reach
  // the user even when this tab is in the background.
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      const ask = () => { try { Notification.requestPermission(); } catch {} };
      "requestIdleCallback" in window ? window.requestIdleCallback(ask, { timeout: 3000 }) : setTimeout(ask, 1200);
    }
  } catch {}
}

dom.bootBtn.addEventListener("click", runBoot);
document.addEventListener("keydown", (event) => {
  if (!state.booted && (event.key === "Enter" || event.code === "Space")) {
    event.preventDefault();
    runBoot();
  }
});

/* ─────────────────────────── init ─────────────────────────── */

function init() {
  buildHelp();
  renderHistory();
  renderNotes();
  renderSchedule();
  updateNetwork();
  updateClock();
  syncSettingsForm();
  applySettings({ refreshVoices: false });
  micNoteDefault();

  if (!speech.synthesisSupported) {
    toast("No voice output", "This browser can't synthesise speech. Text replies still work.", "warn");
  }

  speech.on({
    onInterim: (text) => {
      dom.interim.textContent = text;
      dom.interim.classList.toggle("is-live", Boolean(text));
    },
    onFinal: handleVoiceFinal,
    onStateChange: (mode) => {
      if (mode === "listening") {
        setMicUI(true);
        setMode("listening");
        dom.hint.textContent = "Listening — speak naturally, then pause.";
        return;
      }
      if (mode === "speaking") {
        setMicUI(false);
        setMode("speaking");
        return;
      }
      setMicUI(false);
      if (!state.busy) setMode(state.online ? "ready" : "offline");
      dom.hint.textContent = "Enter to send · Ctrl + Space to talk · Type “help” for the full command list";
    },
    onError: handleVoiceError,
    onSpeechStart: () => { setMode("speaking"); },
    onSpeechEnd: () => { if (!state.busy) setMode(speech.listening ? "listening" : "ready"); },
  });

  speech.loadVoices().then(() => {
    applySettings({ refreshVoices: false });
    populateVoices();
  });

  setInterval(updateClock, 1000);
  setInterval(tickCountdowns, 500);
  setInterval(driftMeters, 2400);
  setInterval(rotateDirective, 42000);
  updateNetwork();
}

init();
