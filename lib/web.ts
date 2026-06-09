// $0 / no-key web capabilities for Nillad: DuckDuckGo HTML search + Open-Meteo
// weather. Both are free and need no API key, keeping the stack local-first.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// DuckDuckGo wraps result links as //duckduckgo.com/l/?uddg=<encoded real url>.
function unwrap(href: string): string {
  const m = /[?&]uddg=([^&]+)/.exec(href);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      /* fall through */
    }
  }
  return href.startsWith("//") ? "https:" + href : href;
}

export type SearchHit = { title: string; url: string; snippet: string };

export async function webSearch(query: string, limit = 5): Promise<SearchHit[]> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const html = await res.text();

  const anchors = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((m) =>
    stripHtml(m[1]),
  );
  const hits: SearchHit[] = [];
  for (let i = 0; i < anchors.length && hits.length < limit; i++) {
    const url = unwrap(anchors[i][1]);
    const title = stripHtml(anchors[i][2]);
    if (!title || !url.startsWith("http")) continue;
    hits.push({ title, url, snippet: snippets[i] || "" });
  }
  return hits;
}

// Fetch a page and return readable-ish text (tags/scripts stripped). Capped so a
// huge page doesn't blow the model's context.
export async function fetchReadable(url: string, maxChars = 3000): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const html = await res.text();
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, "\n");
  return stripHtml(body).slice(0, maxChars);
}

// ---------- Weather (Open-Meteo) ----------

const AMERICAN_FORK = { name: "American Fork, Utah", latitude: 40.3769, longitude: -111.7958 };

const WMO: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "rime fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "light showers", 81: "showers", 82: "violent showers", 85: "snow showers", 86: "snow showers",
  95: "thunderstorm", 96: "thunderstorm w/ hail", 99: "thunderstorm w/ hail",
};

async function geocode(place: string): Promise<{ name: string; latitude: number; longitude: number }> {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1`);
  const j = (await res.json()) as { results?: { name: string; admin1?: string; latitude: number; longitude: number }[] };
  const r = j.results?.[0];
  if (!r) throw new Error(`couldn't find "${place}"`);
  return { name: `${r.name}${r.admin1 ? ", " + r.admin1 : ""}`, latitude: r.latitude, longitude: r.longitude };
}

export async function getWeather(place?: string): Promise<string> {
  const loc = place && place.trim() ? await geocode(place.trim()) : AMERICAN_FORK;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FDenver&forecast_days=3`;
  const res = await fetch(url);
  const j = (await res.json()) as {
    current: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number };
    daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
  };
  const c = j.current;
  const lines = [
    `Weather for ${loc.name}:`,
    `Now: ${Math.round(c.temperature_2m)}°F (feels ${Math.round(c.apparent_temperature)}°F), ${WMO[c.weather_code] || "?"}, wind ${Math.round(c.wind_speed_10m)} mph.`,
  ];
  for (let i = 0; i < j.daily.time.length; i++) {
    const day = new Date(j.daily.time[i] + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
    lines.push(`${day}: ${Math.round(j.daily.temperature_2m_min[i])}–${Math.round(j.daily.temperature_2m_max[i])}°F, ${WMO[j.daily.weather_code[i]] || "?"}.`);
  }
  return lines.join("\n");
}
