/* ═══════════════════════════════════════════════════════════════
   speech.js — Web Speech API wrapper (recognition + synthesis)
   ═══════════════════════════════════════════════════════════════ */

const SRClass = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;

const PREFERRED_VOICES = [
  "Google UK English Male",
  "Daniel",
  "Arthur",
  "Oliver",
  "Microsoft Ryan Online (Natural) - English (United Kingdom)",
  "Microsoft Guy Online (Natural) - English (United States)",
  "Microsoft George - English (United Kingdom)",
  "Microsoft David - English (United States)",
  "Microsoft Mark - English (United States)",
  "Alex",
  "Google US English",
];

export class SpeechEngine {
  constructor() {
    this.synth = "speechSynthesis" in window ? window.speechSynthesis : null;
    this.recognition = null;
    this.voices = [];
    this.listening = false;
    this.speaking = false;
    this._wantListening = false;
    this._restartTimer = null;
    this._keepAlive = null;
    this.settings = {
      voiceURI: "",
      rate: 1,
      pitch: 0.9,
      mute: false,
      lang: "en-US",
      continuous: false,
      wake: false,
    };
    this.handlers = {
      onInterim: () => {},
      onFinal: () => {},
      onStateChange: () => {},
      onError: () => {},
      onSpeechStart: () => {},
      onSpeechEnd: () => {},
    };
  }

  get recognitionSupported() { return Boolean(SRClass()); }
  get synthesisSupported() { return Boolean(this.synth); }

  configure(settings = {}) {
    Object.assign(this.settings, settings);
    if ("mute" in settings && settings.mute) this.stopSpeaking();
    this._applyVoice();
  }

  on(handlers = {}) { Object.assign(this.handlers, handlers); }

  /* ────────────────────────── voices ────────────────────────── */

  loadVoices() {
    if (!this.synth) return Promise.resolve([]);
    return new Promise((resolve) => {
      const collect = () => {
        const list = this.synth.getVoices() || [];
        if (list.length) {
          this.voices = list;
          this._applyVoice();
          resolve(list);
          return true;
        }
        return false;
      };
      if (collect()) return;
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        if (collect() || tries > 28) {
          clearInterval(timer);
          resolve(this.voices);
        }
      }, 120);
      this.synth.onvoiceschanged = () => {
        if (collect()) clearInterval(timer);
      };
    });
  }

  englishVoices() {
    return this.voices.filter((v) => /^en/i.test(v.lang));
  }

  _applyVoice() {
    if (!this.synth) return;
    const all = this.voices.length ? this.voices : this.synth.getVoices() || [];
    if (!this.voices.length && all.length) this.voices = all;
    const chosen = all.find((v) => v.voiceURI === this.settings.voiceURI);
    this.voice = chosen || this._autoPick(all);
  }

  _autoPick(all) {
    for (const name of PREFERRED_VOICES) {
      const found = all.find((v) => v.name === name);
      if (found) return found;
    }
    const byName = all.find((v) => /english/i.test(v.name) && /(male|daniel|arthur|george|guy|ryan|david|alex)/i.test(v.name));
    if (byName) return byName;
    return all.find((v) => /^en[-_]GB/i.test(v.lang)) || all.find((v) => /^en/i.test(v.lang)) || all[0] || null;
  }

  get voiceName() { return this.voice?.name || "system default"; }

  /* ────────────────────────── synthesis ────────────────────────── */

  /** Speak text. Always resolves — interrupted, muted or unsupported. */
  speak(text, { onStart, onEnd } = {}) {
    const clean = String(text || "").trim();
    if (!clean || !this.synth || this.settings.mute) {
      onEnd?.();
      return Promise.resolve();
    }

    // Cut off anything already playing; that also resolves its promise.
    this.stopSpeaking();

    const chunks = splitForSpeech(clean);
    this.speaking = true;
    this.handlers.onStateChange("speaking");
    this.handlers.onSpeechStart?.();
    this._applyVoice();

    return new Promise((resolve) => {
      let index = 0;
      let started = false;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        clearInterval(this._keepAlive);
        this._keepAlive = null;
        this._resolveSpeak = null;
        this.speaking = false;
        this.handlers.onStateChange(this.listening ? "listening" : "idle");
        this.handlers.onSpeechEnd?.();
        onEnd?.();
        resolve();
      };

      // Safety net: if the browser never fires speech events (autoplay policy,
      // a crashed voice, a suspended tab) the caller must not hang forever.
      const watchdog = setTimeout(finish, Math.max(8000, clean.length * 150));
      this._resolveSpeak = finish;

      const next = () => {
        if (settled) return;
        if (index >= chunks.length) {
          finish();
          return;
        }
        const utter = new SpeechSynthesisUtterance(chunks[index++]);
        if (this.voice) {
          utter.voice = this.voice;
          utter.lang = this.voice.lang;
        } else {
          utter.lang = this.settings.lang;
        }
        utter.rate = this.settings.rate;
        utter.pitch = this.settings.pitch;
        utter.volume = 1;
        utter.onstart = () => {
          if (settled) return;
          if (!started) { started = true; onStart?.(); }
        };
        utter.onend = next;
        utter.onerror = (event) => {
          if (event.error === "interrupted" || event.error === "canceled") {
            finish();
            return;
          }
          next();
        };
        try {
          this.synth.speak(utter);
        } catch {
          finish();
        }
      };

      // Chrome occasionally pauses long queues; nudge it while speaking.
      this._keepAlive = setInterval(() => {
        if (!this.synth?.speaking) return;
        if (this.synth.paused) this.synth.resume();
      }, 4000);

      next();
    });
  }

  stopSpeaking() {
    const pending = this._resolveSpeak;
    this._resolveSpeak = null;
    if (this.synth) {
      try { this.synth.cancel(); } catch {}
    }
    if (pending) {
      pending();
      return;
    }
    if (this.speaking) {
      this.speaking = false;
      clearInterval(this._keepAlive);
      this._keepAlive = null;
      this.handlers.onStateChange(this.listening ? "listening" : "idle");
      this.handlers.onSpeechEnd?.();
    }
  }

  /* ────────────────────────── recognition ────────────────────────── */

  _ensureRecognition() {
    const SR = SRClass();
    if (!SR) return null;
    if (this.recognition) return this.recognition;

    const rec = new SR();
    rec.lang = this.settings.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      this.listening = true;
      this.handlers.onStateChange("listening");
    };

    rec.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) final += transcript;
        else interim += transcript;
      }
      if (interim.trim()) this.handlers.onInterim(interim.trim());
      if (final.trim()) {
        this.handlers.onInterim("");
        this.handlers.onFinal(final.trim());
      }
    };

    rec.onerror = (event) => {
      const code = event.error || "unknown";
      if (code === "aborted" || code === "no-speech") return;
      this.handlers.onError(code);
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(code)) {
        this._wantListening = false;
        this.listening = false;
        this.handlers.onStateChange("idle");
      }
    };

    rec.onend = () => {
      this.listening = false;
      if (this._wantListening) {
        // Chrome ends the session after ~60s of silence; restart transparently.
        clearTimeout(this._restartTimer);
        this._restartTimer = setTimeout(() => {
          if (this._wantListening && !this.listening) {
            try { rec.start(); } catch { /* already starting */ }
          }
        }, 260);
      } else {
        this.handlers.onStateChange(this.speaking ? "speaking" : "idle");
      }
    };

    this.recognition = rec;
    return rec;
  }

  startListening() {
    const rec = this._ensureRecognition();
    if (!rec) {
      this.handlers.onError("unsupported");
      return false;
    }
    if (this.listening) { this._wantListening = true; return true; }
    this.stopSpeaking();
    this._wantListening = true;
    rec.lang = this.settings.lang;
    try {
      rec.start();
    } catch {
      /* InvalidStateError if a start is already pending — harmless. */
    }
    return true;
  }

  stopListening() {
    this._wantListening = false;
    clearTimeout(this._restartTimer);
    if (this.recognition) {
      try { this.recognition.stop(); } catch {}
    }
    this.listening = false;
    this.handlers.onStateChange(this.speaking ? "speaking" : "idle");
  }

  toggleListening() {
    if (this.listening || this._wantListening) this.stopListening();
    else this.startListening();
  }
}

/** Split long text into utterance-sized chunks at sentence boundaries. */
export function splitForSpeech(text, max = 220) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return [clean];
  const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [clean];
  const chunks = [];
  let buffer = "";
  for (const sentence of sentences) {
    if ((buffer + sentence).length > max && buffer) {
      chunks.push(buffer.trim());
      buffer = "";
    }
    if (sentence.length > max) {
      sentence.split(/(?<=,)\s/).forEach((part) => {
        if (part.trim()) chunks.push(part.trim());
      });
    } else {
      buffer += sentence;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks.filter(Boolean);
}
