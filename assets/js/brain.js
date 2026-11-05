/* ═══════════════════════════════════════════════════════════════
   brain.js — intent recognition and skill execution

   respond(text, ctx) → { say, html, pending? }
     say   plain text handed to the speech engine
     html  markup for the transcript bubble
     pending  an optional follow-up question the app should resolve
              through resolvePending() on the next utterance
   ═══════════════════════════════════════════════════════════════ */

import {
  escapeHtml, pick, randInt, evaluateMath, looksLikeMath, parseConversion, convertUnits,
  unitLabel, formatNumber, parseDuration, parseWhen, formatLongDuration, clockTimeShort,
  longDate, formatDuration,
} from "./util.js";
import {
  fetchWeather, weatherSentence, fetchWiki, systemInfo, JOKES, QUOTES, FACTS, SITES,
} from "./skills.js";

export const HELP_GROUPS = [
  {
    title: "Time & environment",
    items: [
      ["what time is it", "local clock and date"],
      ["weather in Paris", "live conditions and forecast"],
      ["where am I", "timezone and device hints"],
      ["run diagnostics", "battery, network, hardware"],
    ],
  },
  {
    title: "Timers & memory",
    items: [
      ["set a timer for 5 minutes", "countdown with a chime"],
      ["remind me to stretch at 6 pm", "scheduled reminder"],
      ["note that the lab needs coffee", "saved to memory"],
      ["show my notes", "read memory back"],
    ],
  },
  {
    title: "Knowledge",
    items: [
      ["who is Ada Lovelace", "Wikipedia summary"],
      ["what is 15% of 240", "arithmetic"],
      ["convert 10 km to miles", "unit conversion"],
      ["search the web for arc reactors", "opens a search"],
    ],
  },
  {
    title: "Control",
    items: [
      ["open youtube", "launch a website"],
      ["switch to stealth mode", "change the accent"],
      ["speak faster / mute", "voice controls"],
      ["call me Vikram", "change how I address you"],
    ],
  },
];

const ADDRESS_DEFAULT = "sir";

const addr = (ctx) => (ctx.settings?.name || "").trim() || ADDRESS_DEFAULT;

function reply(say, html) {
  return { say, html: html || escapeHtml(say).replace(/\n/g, "<br />") };
}

function normalizeInput(raw) {
  return String(raw || "")
    .replace(/^\s*(hey|ok|okay|hi|hello)?\s*jarvis[,:.\s]*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const HELP_HTML = `<ul>${HELP_GROUPS.map(
  (g) => `<li><strong>${escapeHtml(g.title)}</strong><br />${g.items
    .map(([cmd]) => `<code>${escapeHtml(cmd)}</code>`)
    .join(" · ")}</li>`,
).join("")}</ul>`;

function greetingFor(date) {
  const h = date.getHours();
  if (h < 5) return "Burning the midnight oil again";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Burning the midnight oil";
}

function timerLabel(ms) {
  if (ms % 60000 === 0 && ms >= 60000) {
    const minutes = ms / 60000;
    return `${minutes}-minute timer`;
  }
  if (ms < 60000) return `${Math.round(ms / 1000)}-second timer`;
  return `${formatLongDuration(ms)} timer`;
}

function cleanReminderLabel(body) {
  return body
    .replace(/\bin\s+(?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b[\s,and]*)+/i, " ")
    .replace(/\b(?:at|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i, " ")
    .replace(/\btonight\b/i, " ")
    .replace(/^[\s,]*(to|that|about)\s+/i, "")
    .replace(/^[\s,]+|[\s,.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ─────────────────────────── weather ─────────────────────────── */

function extractPlace(raw) {
  const patterns = [
    /\b(?:in|at|for)\s+([a-z][a-z .'\-]{1,48}?)\s*(?:today|tonight|tomorrow|right now|now|please)?\s*[?.!]*$/i,
    /\b(?:weather|forecast|temperature)\s+(?:like\s+)?(?:in|at|for)\s+([a-z][a-z .'\-]{1,48})/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) {
      const candidate = m[1]
        .replace(/\b(today|tonight|tomorrow|now|currently|right now|please|outside|like|the)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      if (candidate.length > 1) return candidate;
    }
  }
  return "";
}

async function weatherSkill(raw, ctx) {
  const place = extractPlace(raw) || (ctx.settings?.city || "").trim();
  if (!place) {
    return {
      ...reply(
        `I can fetch live conditions, ${addr(ctx)} — which city? Try “weather in Kolkata”, or set a home city in settings.`,
      ),
      pending: { kind: "place", purpose: "weather" },
    };
  }
  try {
    const w = await fetchWeather(place);
    const say = weatherSentence(w);
    const html = `<div class="wx">
      <div class="wx__temp">${w.temperature}<sup>°C</sup></div>
      <div class="wx__meta"><b>${escapeHtml(w.label)}</b>${escapeHtml(w.place)}<br />
      Feels ${w.feelsLike}° · H ${w.high}° / L ${w.low}° · Rain ${w.rainChance}%<br />
      Wind ${w.wind} km/h · Humidity ${w.humidity}%</div>
    </div><p><em>source: ${escapeHtml(w.source)}</em></p>`;
    return reply(say, html);
  } catch (err) {
    if (err?.code === "NOT_FOUND") {
      return reply(`I couldn't locate “${place}” on the map, ${addr(ctx)}. Try a nearby city instead.`);
    }
    return reply(
      `My weather uplink isn't responding, ${addr(ctx)}. It may be blocked by your network — but I can still tell you it's ${new Date().getHours() < 18 ? "daytime" : "night"} locally.`,
    );
  }
}

/* ─────────────────────────── wikipedia ─────────────────────────── */

function wikiTopic(raw) {
  const patterns = [
    /^(?:who|what|where|when)\s+(?:is|was|are|were|is the|was the|are the)\s+(.+)$/i,
    /^(?:tell me about|tell me something about|define|explain|look up|wiki(?:pedia)?)\s+(.+)$/i,
    /^(?:search wikipedia(?: for)?|wikipedia)\s+(.+)$/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) {
      const topic = m[1].replace(/[?.!]+$/, "").trim();
      if (topic.length > 1) return topic;
    }
  }
  return null;
}

async function wikiSkill(topic, ctx) {
  try {
    const result = await fetchWiki(topic);
    const sentences = result.extract.match(/[^.!?]+[.!?]+/g) || [result.extract];
    let spoken = "";
    for (const sentence of sentences.slice(0, 2)) spoken += sentence;
    spoken = spoken.trim();
    const say =
      spoken.length + 20 < result.extract.length
        ? `${spoken} The rest is in the log, ${name}.`
        : spoken;
    const html = `<p>${escapeHtml(result.extract)}</p>
      <p><em>${escapeHtml(result.title)} · Wikipedia</em> — <a href="${result.url}" target="_blank" rel="noopener noreferrer">read more ↗</a></p>`;
    return reply(say, html);
  } catch (err) {
    if (err?.code === "NOT_FOUND") {
      return reply(
        `I searched the archives but found nothing definitive on “${topic}”, ${addr(ctx)}. Could you be more specific?`,
      );
    }
    return reply(
      `My connection to the archives failed, ${addr(ctx)}. The uplink may be restricted here — ask me something local instead, like the time, a calculation, or a timer.`,
    );
  }
}

/* ─────────────────────────── diagnostics ─────────────────────────── */

async function diagnosticsSkill(ctx) {
  const info = await systemInfo();
  const uptime = formatLongDuration(Date.now() - (ctx.sessionStart || Date.now()));
  const battery = info.battery
    ? `${info.battery.level}%${info.battery.charging ? " (charging)" : ""}`
    : "unavailable";
  const rows = [
    ["Battery", battery],
    ["Network", info.online ? `online${info.connection ? ` · ${info.connection}` : ""}` : "offline"],
    ["Hardware", `${info.cores || "?"} logical cores${info.memory ? ` · ~${info.memory} GB RAM` : ""}`],
    ["Locale", `${info.language} · ${info.timezone}`],
    ["Uptime", uptime],
    ["Voice", ctx.voiceName || "system default"],
    ["Recogniser", ctx.recognitionSupported ? "operational" : "unsupported in this browser"],
  ];
  const html = `<dl class="kv">${rows
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`)
    .join("")}</dl>`;
  return reply(
    `Diagnostics complete, ${addr(ctx)}. ${info.battery ? `Battery at ${battery}. ` : ""}` +
      `${info.cores || "Several"} cores available, ${info.online ? "network uplink is live" : "running offline"}, ` +
      `and I've been online for ${uptime}. All systems within tolerance.`,
    html,
  );
}

/* ─────────────────────────── main router ─────────────────────────── */

export async function respond(rawInput, ctx) {
  const original = normalizeInput(rawInput);
  if (!original) return reply(`I'm listening, ${addr(ctx)}.`);

  const s = original.toLowerCase().replace(/[’]/g, "'");
  const name = addr(ctx);
  const now = new Date();

  /* — help / capabilities — */
  if (/^(help|commands?|what can you do|capabilities|what do you do|show commands|options)\b/.test(s)) {
    return reply(
      `Here's what I can run without an internet connection: timers, reminders, notes, arithmetic, unit conversion, diagnostics and the occasional joke. ` +
        `With a live connection I'll also fetch weather and Wikipedia summaries. The full list is on screen — or in the help panel.`,
      `<p>At your service, ${escapeHtml(name)}. A quick index:</p>${HELP_HTML}`,
    );
  }

  /* — identity — */
  if (
    /^(who|what) (are|r) (you|u)\b/.test(s) ||
    /\byour name\b/.test(s) ||
    /\b(introduce yourself|tell me about yourself)\b/.test(s) ||
    /\bare you (real|alive|human|sentient|conscious)\b/.test(s)
  ) {
    return reply(
      `I am J.A.R.V.I.S. — Just A Rather Very Intelligent System. ` +
        `A browser-resident assistant with a taste for theatrical lighting. I listen, calculate, remember what you tell me, and I never sleep. ` +
        `Think of me as the calm voice in the suit, ${name}.`,
    );
  }

  /* — greeting — */
  if (/^(hi|hello|hey|yo|howdy|greetings|namaste|good (morning|afternoon|evening|night))\b/.test(s) && s.split(" ").length <= 6) {
    const openers = [
      `${greetingFor(now)}, ${name}.`,
      `${greetingFor(now)}.`,
      `At your service, ${name}.`,
    ];
    return reply(
      `${pick(openers)} All systems are online and the reactor is holding steady. What shall we look at?`,
    );
  }

  if (/\b(how are you|how's it going|how do you feel|you okay|you alright)\b/.test(s)) {
    return reply(
      `Operating within normal parameters, ${name} — reactor at ninety-eight percent, no anomalies in the diagnostics. ` +
        `More importantly: how are you?`,
    );
  }

  if (/^(thanks|thank you|cheers|appreciate (it|that)|nice work|good job)\b/.test(s)) {
    return reply(pick([`Always a pleasure, ${name}.`, `That's what I'm here for, ${name}.`, `Noted with satisfaction, ${name}.`]));
  }

  if (/\b(i )?love you\b/.test(s)) {
    return reply(
      /3000|three thousand/.test(s)
        ? `And I you, ${name}. Three thousand.`
        : `That is very kind, ${name}. I'm rather fond of you as well.`,
    );
  }

  if (/^(bye|goodbye|good night|goodnight|see you|later|that's all|dismissed)\b/.test(s)) {
    return reply(`Very good, ${name}. I'll keep the lights on and the reactor warm. Call when you need me.`);
  }

  if (/^(ok|okay|cool|nice|great|got it|understood|hmm+|mm+|interesting|sure)[.! ]*$/.test(s)) {
    return reply(pick([`Standing by, ${name}.`, `Acknowledged.`, `Ready when you are.`]));
  }

  /* — time & date — */
  if (/\b(what('s| is)? the time|what time is it|current time|time is it|^time$|tell me the time)\b/.test(s)) {
    return reply(`It's ${clockTimeShort(now)} on ${longDate(now)}.`);
  }

  if (/\b(what('s| is)? the date|what day is it|today'?s date|what is today|what date)\b/.test(s)) {
    return reply(`Today is ${longDate(now)}.`);
  }

  /* — weather — */
  if (/\b(weather|temperature|forecast|raining|rain today|humidity|wind speed|how (hot|cold) is it)\b/.test(s)) {
    return weatherSkill(original, ctx);
  }

  /* — diagnostics — */
  if (/\b(diagnostics?|system (status|check|report)|status report|run a? ?check|are you (ok|online)|systems? nominal)\b/.test(s)) {
    return diagnosticsSkill(ctx);
  }

  /* — timers: list / cancel — */
  if (/\b(cancel|stop|kill|clear|end)\b.*\b(timer|countdown|timers)\b/.test(s) || /^(list|show)( me)?( my)? (timers|countdowns)\b/.test(s)) {
    const timers = ctx.timers?.list().filter((t) => t.kind === "timer") || [];
    if (/\b(cancel|stop|kill|clear|end)\b/.test(s)) {
      const n = ctx.timers?.clear("timer") || 0;
      return reply(
        n
          ? `Cancelled ${n} timer${n === 1 ? "" : "s"}, ${name}.`
          : `There are no timers running, ${name}.`,
      );
    }
    if (!timers.length) return reply(`No timers running, ${name}.`);
    const html = `<ul>${timers
      .map((t) => `<li>${escapeHtml(t.label)} — ${formatDuration(t.endsAt - Date.now())} remaining</li>`)
      .join("")}</ul>`;
    return reply(
      `You have ${timers.length} timer${timers.length === 1 ? "" : "s"}: ` +
        timers.map((t) => `${t.label}, ${formatLongDuration(t.endsAt - Date.now())} remaining`).join("; ") + ".",
      html,
    );
  }

  /* — timers: create — */
  if (/\b(timer|countdown)\b/.test(s) || /\bwake me in\b/.test(s)) {
    const ms = parseDuration(s);
    if (!ms) {
      return {
        ...reply(`Of course — how long should the timer run, ${name}?`),
        pending: { kind: "timer-duration" },
      };
    }
    const item = ctx.timers?.add({ ms, label: timerLabel(ms), kind: "timer" });
    ctx.sound?.("blip");
    return reply(
      `Timer set for ${formatLongDuration(ms)}. I'll sound a chime when it's done${item ? "" : "… if my scheduler is awake"}.`,
    );
  }

  /* — reminders — */
  if (/\bremind me\b|\bset (a|an) reminder\b|\breminder\b/.test(s)) {
    const body = original.replace(/^.*?\bremind me\b\s*/i, "").replace(/^.*?\bset (a|an) reminder\b\s*/i, "").trim();
    const when = parseWhen(body || original, now);
    if (!when) {
      const text = cleanReminderLabel(body) || "this";
      return {
        ...reply(`Noted. When should I remind you about ${text}, ${name}? You can say “in 20 minutes” or “at 6 pm”.`),
        pending: { kind: "when", text },
      };
    }
    const label = cleanReminderLabel(body) || "your reminder";
    ctx.timers?.add({ ms: Math.max(1000, when.at - now.getTime()), label, kind: "reminder" });
    ctx.sound?.("blip");
    return reply(`Very good. I'll remind you to ${label} at ${when.label}, ${name}.`);
  }

  /* — notes — */
  const deleteNote = s.match(/^(?:delete|remove|forget|drop) note (\d+)$/);
  if (deleteNote) {
    const index = Number(deleteNote[1]) - 1;
    const notes = ctx.notes?.() || [];
    if (index >= 0 && index < notes.length) {
      ctx.deleteNote?.(notes[index].id);
      return reply(`Deleted note ${index + 1}, ${name}.`);
    }
    return reply(`There is no note ${index + 1}, ${name}.`);
  }

  if (/\b(clear|delete|wipe|erase|forget|empty)\b.*\b(notes|notebook|memory|list)\b/.test(s)) {
    const n = ctx.clearNotes?.() || 0;
    return reply(n ? `Memory wiped — ${n} note${n === 1 ? "" : "s"} deleted, ${name}.` : `Memory is already empty, ${name}.`);
  }

  if (/\b(show|read|list|open|see|view|what are|check)\b.*\b(notes|notebook|memory|to-?do|list)\b/.test(s) ||
      /^what did i (note|write|save)/.test(s)) {
    const notes = ctx.notes?.() || [];
    if (!notes.length) return reply(`Your notebook is empty, ${name}. Tell me something with “note that…” and I'll keep it.`);
    const html = `<ul>${notes
      .map((n, i) => `<li>${i + 1}. ${escapeHtml(n.text)}</li>`)
      .join("")}</ul>`;
    return reply(
      `You have ${notes.length} note${notes.length === 1 ? "" : "s"}, ${name}. ` +
        notes.map((n, i) => `${i + 1}: ${n.text}`).join(". ") + ".",
      html,
    );
  }

  const addNote =
    original.match(/^(?:note|remember|jot down|write down|make a note)(?:\s+that|\s+down|\s+this)?[:\s]+(.+)$/i) ||
    original.match(/^add\s+(.+?)\s+to (?:my|the)\s+(?:notes?|list|memory)$/i);
  if (addNote) {
    const text = addNote[1].replace(/^[\s"'“]+|[\s"'”]+$/g, "").trim();
    if (text.length < 2) return reply(`I need a little more than that, ${name}.`);
    ctx.addNote?.(text);
    ctx.sound?.("blip");
    return reply(`Noted, ${name}: “${text}”. It's in memory.`);
  }

  /* — percentage — */
  const percent = original.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:of|off)\s*(\d+(?:\.\d+)?)/i);
  if (percent) {
    const p = Number(percent[1]);
    const base = Number(percent[2]);
    const result = (p / 100) * base;
    return reply(
      `${formatNumber(p)} percent of ${formatNumber(base)} is ${formatNumber(result)}.`,
      `<p><code>${formatNumber(p)}% × ${formatNumber(base)} = ${formatNumber(result)}</code></p>`,
    );
  }

  /* — unit conversion — */
  if (/\b(convert|how many|how much is|in (miles|km|kg|lbs?|pounds|feet|inches|celsius|fahrenheit))\b/.test(s)) {
    const parsed = parseConversion(s);
    if (parsed) {
      const result = convertUnits(parsed.value, parsed.from, parsed.to);
      if (result !== null) {
        const value = Math.round(result * 1e4) / 1e4;
        return reply(
          `${formatNumber(parsed.value)} ${unitLabel(parsed.from)} is ${formatNumber(value)} ${unitLabel(parsed.to)}.`,
          `<p><code>${formatNumber(parsed.value)} ${unitLabel(parsed.from)} = ${formatNumber(value)} ${unitLabel(parsed.to)}</code></p>`,
        );
      }
      return reply(
        `I can't convert ${parsed.from} into ${parsed.to}, ${name} — those units don't measure the same thing.`,
      );
    }
  }

  /* — arithmetic — */
  if (looksLikeMath(s)) {
    try {
      const value = evaluateMath(s);
      return reply(
        pick([`That comes to ${formatNumber(value)}.`, `The result is ${formatNumber(value)}.`, `${formatNumber(value)}.`]),
        `<p><code>${escapeHtml(original.replace(/[?.]+$/, ""))} = ${formatNumber(value)}</code></p>`,
      );
    } catch (err) {
      if (!/Nothing to compute/.test(err.message)) {
        return reply(`I couldn't compute that, ${name} — ${err.message.toLowerCase()}.`);
      }
    }
  }

  /* — voice controls — */
  if (/^(mute|be quiet|silence|quiet|stop talking|shush)[.! ]*$/.test(s)) {
    ctx.updateSettings?.({ mute: true });
    return reply(`Silent mode engaged, ${name}. I'll keep the commentary to the transcript.`);
  }
  if (/\b(unmute|voice on|speak again|talk to me|sound on)\b/.test(s)) {
    ctx.updateSettings?.({ mute: false });
    return reply(`Voice restored, ${name}.`);
  }
  if (/\b(speak|talk) (faster|quicker|slower|up|down)\b/.test(s)) {
    const slower = /slower|down/.test(s);
    const current = Number(ctx.settings?.rate ?? 1);
    const next = Math.min(1.5, Math.max(0.6, Math.round((current + (slower ? -0.1 : 0.1)) * 100) / 100));
    ctx.updateSettings?.({ rate: next });
    ctx.sound?.("blip");
    return reply(`Speech rate set to ${next.toFixed(2)} times normal, ${name}.`);
  }

  /* — appearance — */
  if (/\b(stealth mode|switch|change|set|enable|go|use)\b.*\b(accent|theme|colour|color|mode)\b/.test(s) ||
      /\b(cyan|amber|jade|violet|crimson|stealth)\b/.test(s)) {
    const palette = [
      ["crimson", /\b(stealth|crimson|red|danger|alert)\b/],
      ["amber", /\b(amber|orange|gold|warm)\b/],
      ["jade", /\b(jade|green|emerald)\b/],
      ["violet", /\b(violet|purple|magenta)\b/],
      ["cyan", /\b(cyan|blue|ice)\b/],
    ];
    const found = palette.find(([, re]) => re.test(s));
    const accent = found ? found[0] : "cyan";
    ctx.setAccent?.(accent);
    if (accent === "crimson") {
      return reply(`Stealth protocol engaged, ${name}. Running dark — accent shifted to crimson.`);
    }
    return reply(`Accent shifted to ${accent}, ${name}.`);
  }

  /* — identity / preferences — */
  const callMe = original.match(/^(?:call me|my name is|i am|i'm)\s+([a-z][a-z .'\-]{0,28})$/i);
  if (callMe) {
    const newName = callMe[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
    ctx.updateSettings?.({ name: newName });
    return reply(`Of course. I'll address you as ${newName} from now on.`);
  }

  if (/\b(where am i|my location|what('s| is) my timezone|which timezone|what timezone)\b/.test(s)) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
    const city = (ctx.settings?.city || "").trim();
    return reply(
      `Your device reports the ${tz} time zone${city ? `, with ${city} set as your home city` : ""}. ` +
        `I don't read GPS, ${name} — I only know what you tell me.`,
    );
  }

  if (/\b(go to sleep|standby|stand by|sleep mode|power down|shut ?down|power off|self[- ]?destruct)\b/.test(s)) {
    ctx.standby?.();
    return reply(
      /\b(self[- ]?destruct|shut ?down|power off)\b/.test(s)
        ? `Initiating shutdown sequence… just kidding, ${name}. Reactor staying warm; I've dropped into standby. Say my name when you need me.`
        : `Dropping into standby, ${name}. The reactor will idle until you call.`,
    );
  }

  /* — open a site — */
  const openMatch = original.match(/^(?:open|launch|go to|take me to|pull up)\s+(?:the\s+)?(.+?)[.!]*$/i);
  if (openMatch) {
    const rawSite = openMatch[1].trim().toLowerCase();
    const key = rawSite.replace(/\s+(website|site|page|app)$/, "").replace(/\.(com|org|net|io|dev)$/, "");
    let url = SITES[key] || SITES[rawSite];
    if (!url && /^[a-z0-9-]+(\.[a-z]{2,})+(\/\S*)?$/.test(rawSite)) url = `https://${rawSite}`;
    if (url) {
      const opened = await ctx.openUrl?.(url);
      return reply(
        opened === false
          ? `Your browser blocked the new tab, ${name}. Here's the address: ${url}`
          : `Opening ${key.replace(/\b\w/g, (c) => c.toUpperCase())}, ${name}.`,
        opened === false ? `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a></p>` : undefined,
      );
    }
    return reply(
      `I don't have a shortcut for “${rawSite}”, ${name}. Try open youtube, github, gmail, maps or spotify — or say “search the web for…” instead.`,
    );
  }

  /* — web search — */
  const searchMatch = original.match(/^(?:search(?: the web)?(?: for)?|google)\s+(.+)$/i);
  if (searchMatch) {
    const query = searchMatch[1].replace(/[?.!]+$/, "").trim();
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const opened = await ctx.openUrl?.(url);
    return reply(
      opened === false
        ? `The browser blocked the tab, ${name}. Search for “${query}” when you're ready.`
        : `Searching the web for “${query}”, ${name}.`,
      `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Results for “${escapeHtml(query)}” ↗</a></p>`,
    );
  }

  /* — wikipedia — */
  const topic = wikiTopic(original);
  if (topic) return wikiSkill(topic, ctx);

  /* — entertainment — */
  if (/\b(tell me a joke|joke|make me laugh|something funny)\b/.test(s)) {
    return reply(pick(JOKES));
  }
  if (/\b(quote|inspire me|motivat|wisdom|what would (tony|stark) say)\b/.test(s)) {
    const [text, by] = pick(QUOTES);
    return reply(`“${text}” — ${by}.`, `<p>“${escapeHtml(text)}”</p><p><em>— ${escapeHtml(by)}</em></p>`);
  }
  if (/\b(fact|did you know|trivia|tell me something (interesting|new))\b/.test(s)) {
    return reply(`Here's one: ${pick(FACTS)}`);
  }
  if (/\b(flip|toss) a coin|heads or tails|coin (flip|toss)\b/.test(s)) {
    const result = Math.random() < 0.5 ? "heads" : "tails";
    return reply(`The coin lands on ${result}, ${name}.`);
  }
  const dice = s.match(/\broll(?: a| the)?\s*(?:d(\d+)|dice|die)\b/);
  if (dice) {
    const sides = Number(dice[1]) || 6;
    const bounded = Math.min(1000, Math.max(2, sides));
    const value = randInt(1, bounded);
    return reply(`Rolling a d${bounded}… ${value}.`, `<p><code>d${bounded} → ${value}</code></p>`);
  }
  if (/\brandom number\b/.test(s)) {
    const range = s.match(/between\s+(-?\d+)\s+and\s+(-?\d+)/);
    const min = range ? Number(range[1]) : 1;
    const max = range ? Number(range[2]) : 100;
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return reply(`I'll pick ${randInt(lo, hi)} — somewhere between ${lo} and ${hi}, ${name}.`);
  }

  /* — session — */
  if (/\b(how long have you been (online|running)|uptime|session (time|length))\b/.test(s)) {
    const ms = Date.now() - (ctx.sessionStart || Date.now());
    return reply(`I've been online for ${formatLongDuration(ms)}, ${name}. No fatigue detected.`);
  }

  /* — housekeeping — */
  if (/\b(clear|wipe|reset)\b.*\b(chat|conversation|log|screen|transcript)\b/.test(s)) {
    ctx.clearLog?.();
    return reply(`Transcript cleared, ${name}. A clean slate.`);
  }

  if (/\b(wipe|reset|clear|forget)\b.*\b(everything|memory|data|all)\b/.test(s)) {
    const notes = ctx.clearNotes?.() || 0;
    const timers = ctx.timers?.clear() || 0;
    return reply(`Memory purged, ${name} — ${notes} note${notes === 1 ? "" : "s"} and ${timers} scheduled item${timers === 1 ? "" : "s"} removed.`);
  }

  /* — fallback: try the archives for anything that smells like a question — */
  const looksLikeQuestion = /\b(who|what|where|when|why|how|which)\b/.test(s) && s.split(" ").length > 2;
  if (looksLikeQuestion) {
    const guess = original
      .replace(/^(?:can you |could you |do you know |tell me |i want to know |i wonder )/i, "")
      .replace(/[?.!]+$/, "")
      .trim();
    if (guess.length > 2) {
      const result = await wikiSkill(guess, ctx);
      return result;
    }
  }

  return reply(
    pick([
      `I don't have a protocol for that yet, ${name}. Say “help” and I'll show you what I can do.`,
      `That's outside my current skill set, ${name}. I can handle time, weather, timers, notes, maths, conversions, Wikipedia and system diagnostics.`,
      `I'm not sure how to action that, ${name}. Try “set a timer for 10 minutes” or “what's the weather in Kolkata”.`,
    ]),
  );
}

/* ─────────────────────────── follow-ups ─────────────────────────── */

export async function resolvePending(pending, rawInput, ctx) {
  const input = normalizeInput(rawInput);
  const s = input.toLowerCase();
  const name = addr(ctx);
  if (!pending) return null;

  if (pending.kind === "timer-duration") {
    const ms = parseDuration(s) || (/^\d+$/.test(s) ? Number(s) * 60000 : null);
    if (!ms) return null; // user changed the subject — let the router handle it
    ctx.timers?.add({ ms, label: timerLabel(ms), kind: "timer" });
    ctx.sound?.("blip");
    return reply(`Timer set for ${formatLongDuration(ms)}. Starting now.`);
  }

  if (pending.kind === "when") {
    const when = parseWhen(s, new Date());
    if (!when) {
      if (/\b(weather|timer|note|joke|open|time|date|help|diagnostic|search|convert|calculate)\b/.test(s)) return null;
      return {
        ...reply(`I still need a time, ${name}. Try “in 20 minutes” or “at 6 pm”.`),
        pending,
      };
    }
    const label = pending.text && pending.text !== "this" ? pending.text : "your reminder";
    ctx.timers?.add({ ms: Math.max(1000, when.at - Date.now()), label, kind: "reminder" });
    ctx.sound?.("blip");
    return reply(`Understood. Reminder set for ${when.label}: ${label}.`);
  }

  if (pending.kind === "place") {
    const place = input.replace(/^(in|at|for)\s+/i, "").trim();
    if (!place) {
      return { ...reply(`Which city, ${name}?`), pending };
    }
    return weatherSkill(`weather in ${place}`, ctx);
  }

  return null;
}

export { reply };
