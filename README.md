# J.A.R.V.I.S.

**Just A Rather Very Intelligent System** — a voice-first assistant that runs entirely in your browser.

An arc-reactor HUD, live speech recognition, spoken replies, and a local skill engine for timers,
reminders, notes, weather, maths, unit conversion, Wikipedia lookups and system diagnostics.
No build step. No dependencies. No API keys. No account.

```bash
npm start          # → http://localhost:3000
```

Then press **INITIALIZE SYSTEM**, and talk — or type.

---

## Quick start

```bash
git clone <this repo>
cd JARVIS
node server.js            # or: npm start
# open http://localhost:3000
```

Any static file server works too (`python3 -m http.server 3000`), but `server.js` sets
`Permissions-Policy` headers that make microphone access behave properly and binds `0.0.0.0`
so it survives proxies and previews.

Requirements: Node 18+ (only for the included server). The app itself is plain HTML, CSS and ES modules.

---

## What it does

| Area | Examples |
| --- | --- |
| **Time & date** | “what time is it”, “what day is it” |
| **Weather** | “weather in Kolkata”, “will it rain today”, “temperature in Paris” — live data from Open-Meteo |
| **Timers** | “set a timer for 5 minutes”, “start a 90 second countdown”, “cancel the timer” |
| **Reminders** | “remind me to stretch at 6 pm”, “remind me in 20 minutes to check the oven” |
| **Notes** | “note that the lab needs coffee”, “show my notes”, “delete note 2”, “clear notes” |
| **Maths** | “what is 15% of 240”, “sqrt(144) + 2^10”, “100 divided by 4” — safe parser, no `eval` |
| **Conversions** | “convert 10 km to miles”, “how many kg in 150 lb”, “100 f to c” |
| **Knowledge** | “who is Ada Lovelace”, “tell me about Iron Man”, “search the web for arc reactors” |
| **System** | “run diagnostics”, “how long have you been online”, “where am I” |
| **Control** | “open youtube”, “switch to stealth mode”, “speak faster”, “mute”, “call me Vikram” |
| **Fun** | jokes, quotes, facts, coin flips, dice (“roll a d20”), random numbers |
| **Housekeeping** | “clear the conversation”, “wipe everything”, “go to sleep” |

Type **help** (or press <kbd>?</kbd>) for the full index inside the app.

---

## Voice

- **Input** — Web Speech API (`SpeechRecognition`). Chrome, Edge and Safari expose it; Firefox currently does not.
  Typing works everywhere, so the interface stays fully usable without a microphone.
- **Output** — `SpeechSynthesis`, with a preference for calm British male voices (Daniel, Google UK English Male,
  Microsoft Ryan…) when the device has them. Voice, rate and pitch are configurable in settings.
- **Wake word** — optional. When enabled, I only respond to phrases containing “Jarvis”.
- **Continuous conversation** — optional. Keeps the mic open and listens again after each reply.
- **Barge-in** — starting a new command interrupts whatever I'm saying.

> **Microphone in an embedded preview:** browsers require the parent page to delegate microphone access
> to an iframe. If voice is blocked where you're viewing this, open the app in its own tab
> (`http://localhost:3000`) or deploy it and visit the page directly.

---

## Install it as an app

The app ships a manifest and an offline shell, so it installs like a native application.

- **Android / Chrome desktop** — open the app, then use the browser's *Install app* option
  (or **Settings → Install app** inside JARVIS). You get a home-screen icon, a full-screen window
  with no address bar, and it opens instantly even with no connection.
- **iPhone / iPad** — Share → *Add to Home Screen*.
- **Offline** — the interface, your notes, timers and all local skills keep working without a
  network. Weather and Wikipedia obviously need the internet; they say so rather than failing silently.

Installing needs HTTPS or `localhost`. Opening the file directly (`file://`) or being offline on a
first visit won't offer it.

## Interface

- **Arc reactor HUD** — canvas renderer with a reactively animated waveform, orbiting instrument rings,
  scanner sweep and particles. It shifts green while listening and reacts to every exchange.
- **Conversation log** — running transcript, persisted in `localStorage`. Rich replies render as cards
  (weather, maths, diagnostics, notes).
- **Schedule** — live countdowns, cancellation, browser notifications and a synthesised alarm.
- **Memory** — notes saved to this device only.
- **Settings** — call sign, home city, voice, rate, pitch, recognition language, accent theme, silent mode.
- **Themes** — cyan, amber, jade, violet and crimson (crimson doubles as “stealth mode”).

### Keyboard

| Keys | Action |
| --- | --- |
| <kbd>Enter</kbd> | Send |
| <kbd>Ctrl</kbd> + <kbd>Space</kbd> | Start / stop listening |
| <kbd>/</kbd> | Focus the composer |
| <kbd>?</kbd> | Command reference |
| <kbd>Esc</kbd> | Stop speaking / close dialogs |

---

## Architecture

```
index.html               markup: boot sequence, HUD, transcript, panels, dialogs
server.js                zero-dependency static server (ported, MIME-correct, mic headers)
assets/css/base.css      design tokens, reset, boot screen, ambient effects
assets/css/app.css       layout, panels, chat, modals, responsive rules
assets/js/app.js         runtime: boot, voice loop, rendering, persistence, settings
assets/js/brain.js       intent router + skills + follow-up resolution
assets/js/skills.js      network skills (weather, Wikipedia), system info, canned content
assets/js/speech.js      Web Speech API wrapper (recognition, synthesis, chunking)
assets/js/hud.js         canvas arc-reactor renderer
assets/js/timers.js      persistent timers & reminders
assets/js/audio.js       synthesised UI sound effects (WebAudio, no assets)
assets/js/util.js        DOM helpers, safe math parser, units, time parsing, storage
manifest.json            installable-app metadata (name, icons, standalone display)
sw.js                    offline shell: network-first pages, cached assets, APIs untouched
assets/icons/            app icons (generated by tools/make-icons.py, no image libraries)
tools/make-icons.py      re-renders the icons with pure Python
tests/                   35 tests: reasoning core, speech lifecycle, offline shell
```

### Design notes

- **Everything is local.** The only network calls are the ones you explicitly trigger:
  Open-Meteo for weather and Wikipedia's public API for summaries. Settings, notes, timers and
  the transcript live in `localStorage`.
- **No `eval`.** Arithmetic goes through a hand-written recursive-descent parser with a whitelist
  of functions and constants.
- **Graceful degradation.** No speech recognition, no synthesis, no network, no canvas?
  The app still answers in text and keeps its state. A missing HUD context or a browser
  without `ResizeObserver` falls back to a static reactor ring instead of breaking the boot.
- **Accessibility.** Live regions on the transcript and toasts, labelled controls, visible focus,
  and full `prefers-reduced-motion` support (animations settle, the HUD slows down).
- **Offline-first shell.** A service worker caches the interface so the app opens instantly and
  works without a connection. It deliberately never caches weather or Wikipedia responses — stale
  data is worse than an honest error.
- **No tracker, no analytics, no fonts required.** Web fonts from Google are a progressive
  enhancement; the system font stack is the fallback.

---

## Tests

```bash
npm test        # 35 unit tests, no dependencies
```

Covers the math parser (precedence, functions, percent, rejects garbage), unit conversion,
duration and clock parsing, the intent router (arithmetic, timers, reminders, notes, controls,
diagnostics, weather follow-ups), speech chunking, and the offline shell (precaching, the
offline fallback, and the rule that weather/Wikipedia requests are never cached).

```bash
npm i -D jsdom && npm run test:ui
```

An end-to-end smoke check that boots the real page headlessly and drives it: module wiring,
the boot sequence, HUD canvas sizing, twelve spoken commands, a timer firing on its own, the
microphone path, settings persistence and the help manual — then fails on any uncaught error.
jsdom is optional on purpose: the app itself still ships with no dependencies.

---

## Make it yours

- **Change my voice** — settings → Voice. Any installed system voice appears there.
- **Change my manners** — `assets/js/brain.js`: the `respond()` router reads top to bottom;
  add a handler object before the fallback. `HELP_GROUPS` drives the in-app manual.
- **Change the colours** — the `--accent*` tokens in `base.css`; add a swatch in
  `index.html` + a `[data-accent="…"]` rule.
- **Change the HUD** — `hud.js` draws in layers: bloom → tick ring → dashed rings → scanner →
  particles → waveform → core. Each block is independent.

---

## Known limits

- Weather and Wikipedia need outbound internet from the browser. Where those hosts are blocked,
  I say so plainly instead of failing silently.
- Currency exchange, music playback and email sending are not implemented — no keys, no back end.
- Speech recognition is server-assisted in most browsers. Offline, typing and all local skills
  still work.
- Timers persist across reloads, but a page that is closed when a reminder is due will fire it
  the next time the app opens.

---

MIT licensed. Built with affection for a certain fictional butler.
