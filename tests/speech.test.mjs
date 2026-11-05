/* Speech engine lifecycle — must never leave a caller awaiting forever. */

import test from "node:test";
import assert from "node:assert/strict";

const spoken = [];

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
  }
}

const fakeSynth = {
  speaking: false,
  paused: false,
  speak(utterance) {
    spoken.push(utterance.text);
    this.speaking = true;
    // Deliberately never fire onend: simulates a browser that interrupts us.
  },
  cancel() { this.speaking = false; },
  getVoices() { return []; },
  pause() {},
  resume() {},
};

globalThis.window = { speechSynthesis: fakeSynth };
globalThis.SpeechSynthesisUtterance = FakeUtterance;

const { SpeechEngine, splitForSpeech } = await import("../assets/js/speech.js");

test("an interrupted utterance always settles", async () => {
  const engine = new SpeechEngine();
  engine.configure({ mute: false });

  const first = engine.speak("This is the first message.");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(engine.speaking, true, "engine should report speaking");

  const second = engine.speak("This is the second message.");
  await first; // resolves because the first utterance was interrupted
  engine.stopSpeaking();
  await second;

  assert.equal(engine.speaking, false);
  assert.equal(spoken.length, 2);
});

test("muted speech resolves without sending audio", async () => {
  const engine = new SpeechEngine();
  engine.configure({ mute: true });
  const before = spoken.length;
  await engine.speak("This should stay silent.");
  assert.equal(spoken.length, before);
});

test("empty speech is a no-op", async () => {
  const engine = new SpeechEngine();
  await engine.speak("   ");
  assert.equal(engine.speaking, false);
});

test("synthesis reports chunk counts for long text", () => {
  const chunks = splitForSpeech("The reactor is stable. ".repeat(30), 120);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length > 0));
});
