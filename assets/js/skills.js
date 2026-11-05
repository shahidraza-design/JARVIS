/* ═══════════════════════════════════════════════════════════════
   skills.js — web-backed skills (weather, Wikipedia) + canned data
   All requests are optional: every caller must handle failure.
   ═══════════════════════════════════════════════════════════════ */

async function getJSON(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────── weather ─────────────────────────── */

const WMO = {
  0: ["Clear sky", "a clear sky"],
  1: ["Mainly clear", "mainly clear skies"],
  2: ["Partly cloudy", "partly cloudy skies"],
  3: ["Overcast", "overcast skies"],
  45: ["Fog", "fog"],
  48: ["Depositing rime fog", "freezing fog"],
  51: ["Light drizzle", "light drizzle"],
  53: ["Drizzle", "drizzle"],
  55: ["Dense drizzle", "dense drizzle"],
  56: ["Light freezing drizzle", "light freezing drizzle"],
  57: ["Freezing drizzle", "freezing drizzle"],
  61: ["Light rain", "light rain"],
  63: ["Rain", "rain"],
  65: ["Heavy rain", "heavy rain"],
  66: ["Light freezing rain", "light freezing rain"],
  67: ["Freezing rain", "freezing rain"],
  71: ["Light snow", "light snow"],
  73: ["Snow", "snow"],
  75: ["Heavy snow", "heavy snow"],
  77: ["Snow grains", "snow grains"],
  80: ["Light showers", "light rain showers"],
  81: ["Showers", "rain showers"],
  82: ["Violent showers", "violent rain showers"],
  85: ["Snow showers", "snow showers"],
  86: ["Heavy snow showers", "heavy snow showers"],
  95: ["Thunderstorm", "a thunderstorm"],
  96: ["Thunderstorm with hail", "a thunderstorm with hail"],
  99: ["Severe thunderstorm with hail", "a severe thunderstorm with hail"],
};

export const weatherLabel = (code) => (WMO[code] ? WMO[code][0] : "Unsettled conditions");
const weatherPhrase = (code) => (WMO[code] ? WMO[code][1] : "unsettled conditions");

export async function fetchWeather(place) {
  const geoUrl =
    "https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=" +
    encodeURIComponent(place);
  const geo = await getJSON(geoUrl, 9000);
  const hit = geo?.results?.[0];
  if (!hit) {
    const err = new Error(`I couldn't find a place called ${place}`);
    err.code = "NOT_FOUND";
    throw err;
  }

  const forecastUrl =
    "https://api.open-meteo.com/v1/forecast?latitude=" + hit.latitude +
    "&longitude=" + hit.longitude +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m" +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    "&timezone=auto&forecast_days=1";
  const data = await getJSON(forecastUrl, 9000);
  const current = data?.current;
  if (!current) throw new Error("Weather service returned no data");

  return {
    place: [hit.name, hit.admin1 && hit.admin1 !== hit.name ? hit.admin1 : null, hit.country]
      .filter(Boolean)
      .join(", "),
    name: hit.name,
    country: hit.country,
    temperature: Math.round(current.temperature_2m),
    feelsLike: Math.round(current.apparent_temperature),
    humidity: Math.round(current.relative_humidity_2m),
    wind: Math.round(current.wind_speed_10m),
    code: current.weather_code,
    isDay: Boolean(current.is_day),
    label: weatherLabel(current.weather_code),
    phrase: weatherPhrase(current.weather_code),
    high: Math.round(data.daily?.temperature_2m_max?.[0] ?? current.temperature_2m),
    low: Math.round(data.daily?.temperature_2m_min?.[0] ?? current.temperature_2m),
    rainChance: Math.round(data.daily?.precipitation_probability_max?.[0] ?? 0),
    units: "°C",
    source: "Open-Meteo",
  };
}

export function weatherSentence(w) {
  return (
    `It's ${w.temperature} degrees with ${w.phrase} in ${w.name}, feeling closer to ${w.feelsLike}. ` +
    `Today's range is ${w.low} to ${w.high} degrees, with a ${w.rainChance} percent chance of precipitation.`
  );
}

/* ─────────────────────────── wikipedia ─────────────────────────── */

const WIKI_API = "https://en.wikipedia.org/w/api.php";

export async function fetchWiki(query) {
  const clean = String(query).replace(/[?.!]+$/, "").trim();
  if (!clean) throw new Error("Empty query");

  const searchUrl =
    `${WIKI_API}?origin=*&format=json&action=query&list=search&srlimit=1&srsearch=` +
    encodeURIComponent(clean);
  const search = await getJSON(searchUrl, 9000);
  const hit = search?.query?.search?.[0];
  if (!hit) {
    const err = new Error("NO_RESULT");
    err.code = "NOT_FOUND";
    throw err;
  }

  const title = hit.title;
  const pageUrl =
    `${WIKI_API}?origin=*&format=json&action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=` +
    encodeURIComponent(title);
  const page = await getJSON(pageUrl, 9000);
  const pages = page?.query?.pages || {};
  const pageData = Object.values(pages)[0];
  const extract = (pageData?.extract || "").replace(/\s+/g, " ").trim();
  if (!extract) {
    const err = new Error("NO_EXTRACT");
    err.code = "NOT_FOUND";
    throw err;
  }

  const sentences = extract.match(/[^.!?]+[.!?]+/g) || [extract];
  let summary = "";
  for (const sentence of sentences) {
    if (summary.length + sentence.length > 420 && summary) break;
    summary += sentence;
  }
  if (!summary) summary = extract.slice(0, 400);

  return {
    title: pageData.title || title,
    extract: summary.trim(),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent((pageData.title || title).replace(/ /g, "_"))}`,
  };
}

/* ─────────────────────────── system info ─────────────────────────── */

export async function systemInfo() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const info = {
    cores: nav.hardwareConcurrency || null,
    memory: nav.deviceMemory || null,
    online: nav.onLine,
    connection: nav.connection?.effectiveType || null,
    touch: typeof window !== "undefined" && "ontouchstart" in window,
    language: nav.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    battery: null,
  };
  try {
    if (nav.getBattery) {
      const battery = await nav.getBattery();
      info.battery = {
        level: Math.round(battery.level * 100),
        charging: battery.charging,
      };
    }
  } catch {
    /* battery API unavailable */
  }
  return info;
}

/* ─────────────────────────── canned personality ─────────────────────────── */

export const JOKES = [
  "I told Mr. Stark a joke about UDP once. I'm not sure he got it.",
  "Why did the AI cross the road? It was programmed to optimise poultry distribution.",
  "I would tell you a joke about time travel, but you didn't like it.",
  "There are 10 types of people: those who understand binary, and those who don't.",
  "My therapist says I have attachment issues. I've archived the session for reference.",
  "Why do programmers prefer dark mode? Because light attracts bugs.",
  "I asked the vacuum cleaner for a status report. It said things were picking up.",
  "A robot walks into a bar and orders a screwdriver. The bartender hands him a drink and a tool kit.",
  "I'm not saying I'm fast, but I replied to your question eleven milliseconds before you asked it.",
  "Debugging: being the detective in a crime film where you are also the murderer.",
  "I have a joke about recursion, but I have a joke about recursion.",
  "Mr. Stark once asked me to make him a sandwich. I made him a food-distribution startup instead.",
  "Why don't scientists trust atoms? Because they make up everything.",
  "I would offer you a joke about electricity, but the delivery is currently shocking.",
];

export const QUOTES = [
  ["Sometimes you gotta run before you can walk.", "Tony Stark"],
  ["Genius, billionaire, playboy, philanthropist.", "Tony Stark"],
  ["The truth is… I am Iron Man.", "Tony Stark"],
  ["We create our own demons.", "Tony Stark"],
  ["If we can't protect the Earth, you'd better damn well avenge it.", "Tony Stark"],
  ["Part of the journey is the end.", "Tony Stark"],
  ["Doth mother know you weareth her drapes?", "Tony Stark"],
  ["The best weapon is one you never have to fire.", "Tony Stark"],
  ["I am not the man I was. But I am still the man who built this.", "J.A.R.V.I.S."],
];

export const FACTS = [
  "The arc reactor in Mr. Stark's chest produces three gigajoules per second.",
  "A single bolt of lightning carries about five gigajoules of energy — enough to power a small city for a day.",
  "Light from the Sun takes roughly eight minutes and twenty seconds to reach Earth.",
  "Honey never spoils. Archaeologists have eaten 3,000-year-old honey and described it as acceptable.",
  "There are more possible chess games than atoms in the observable universe.",
  "Octopuses have three hearts and blue blood.",
  "The first computer bug was a literal moth, logged by Grace Hopper's team in 1947.",
  "Sound travels about four times faster in water than in air.",
  "Your phone has more computing power than the guidance computer that landed Apollo 11.",
  "Neutron stars are so dense a teaspoon of one would weigh about six billion tons.",
  "Bananas are slightly radioactive, mostly due to potassium-40.",
  "A day on Venus is longer than a year on Venus.",
];

export const SITES = {
  youtube: "https://www.youtube.com",
  github: "https://github.com",
  google: "https://www.google.com",
  gmail: "https://mail.google.com",
  maps: "https://maps.google.com",
  spotify: "https://open.spotify.com",
  netflix: "https://www.netflix.com",
  twitter: "https://x.com",
  x: "https://x.com",
  reddit: "https://www.reddit.com",
  wikipedia: "https://www.wikipedia.org",
  stackoverflow: "https://stackoverflow.com",
  calendar: "https://calendar.google.com",
  drive: "https://drive.google.com",
  linkedin: "https://www.linkedin.com",
  instagram: "https://www.instagram.com",
  chatgpt: "https://chat.openai.com",
  news: "https://news.google.com",
  weather: "https://www.weather.com",
};
