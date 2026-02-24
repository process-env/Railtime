import { promises as fs } from "fs";
import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from "@/lib/api/rate-limit";
import { badRequest, internalError, rateLimited } from "@/lib/api/errors";
import { getCache, setCache, zaddToSet } from "@/lib/redis";
import { NEWSROOM_CHAT_MODEL } from "../constants";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const VALID_TYPES = [
  "evergreen",
  "weather",
  "news",
  "transit-insight",
  "alert-live",
] as const;

type SegmentType = (typeof VALID_TYPES)[number];

type SegmentCategory = "evergreen" | "semi-live" | "live";

const CATEGORY_MAP: Record<SegmentType, SegmentCategory> = {
  evergreen: "evergreen",
  weather: "semi-live",
  news: "semi-live",
  "transit-insight": "semi-live",
  "alert-live": "live",
};

const TTL_MAP: Record<SegmentType, number> = {
  evergreen: 604800, // 7 days
  weather: 1800, // 30 min
  news: 600, // 10 min
  "transit-insight": 600, // 10 min
  "alert-live": 0, // never cached
};

const VOICE_MAP: Record<SegmentType, string> = {
  evergreen: "fable",
  weather: "echo",
  news: "nova",
  "transit-insight": "fable",
  "alert-live": "fable",
};

// NYC coordinates for weather API
const NYC_LAT = 40.7128;
const NYC_LON = -74.006;

// NYC RSS feeds
const NYC_RSS_FEEDS = [
  "https://rss.nytimes.com/services/xml/rss/nyt/NYRegion.xml",
  "https://gothamist.com/feed",
];

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

interface NewsroomRequest {
  type: SegmentType;
  alerts?: Array<{
    id: string;
    headerText: string;
    affectedRoutes?: string[];
  }>;
}

interface SubwayFacts {
  general: string[];
  stations: Record<string, string[]>;
  routes: Record<string, string[]>;
  history: string[];
  engineering: string[];
  movies: string[];
  celebrities: string[];
  music: string[];
  neighborhoods: string[];
  trivia: string[];
}

interface NewsItem {
  title: string;
  description?: string;
}

interface WeatherData {
  current: {
    temp: number;
    feelsLike: number;
    humidity: number;
    windSpeed: number;
    description: string;
  };
  today: {
    high: number;
    low: number;
    description: string;
  };
  forecast: Array<{
    day: string;
    high: number;
    low: number;
    description: string;
  }>;
}

interface CachedAudio {
  text: string;
  audioBase64: string;
  category: SegmentCategory;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// In-process caches for static reference files
// ---------------------------------------------------------------------------

let subwayFactsCache: SubwayFacts | null = null;

// ---------------------------------------------------------------------------
// Helper functions (ported from conductor/announce)
// ---------------------------------------------------------------------------

/**
 * Load subway facts data
 */
async function loadSubwayFacts(): Promise<SubwayFacts | null> {
  if (subwayFactsCache) return subwayFactsCache;

  try {
    const filePath = path.join(
      process.cwd(),
      "public",
      "data",
      "subway-facts.json"
    );
    const content = await fs.readFile(filePath, "utf-8");
    subwayFactsCache = JSON.parse(content);
    return subwayFactsCache;
  } catch (error) {
    console.error("Failed to load subway facts:", error);
    return null;
  }
}

/**
 * Pick a random fact from all subway facts categories
 */
function pickRandomFact(facts: SubwayFacts): string {
  const allFacts = [
    ...facts.general,
    ...facts.history,
    ...facts.engineering,
    ...facts.trivia,
    ...facts.movies,
    ...facts.celebrities,
    ...facts.music,
    ...facts.neighborhoods,
  ];
  return allFacts[Math.floor(Math.random() * allFacts.length)];
}

// ---------------------------------------------------------------------------
// TTS synthesis (generalized with voice parameter)
// ---------------------------------------------------------------------------

async function synthesizeSpeech(
  text: string,
  voice: string
): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error("OpenAI API key not configured");
  }

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "tts-1",
      input: text,
      voice,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("OpenAI TTS API error:", errorText);
    throw new Error("Failed to synthesize speech");
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

// ---------------------------------------------------------------------------
// OpenAI chat helper
// ---------------------------------------------------------------------------

async function chatCompletion(
  prompt: string,
  maxTokens: number = 150,
  temperature: number = 0.8
): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: NEWSROOM_CHAT_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    console.error("OpenAI API error:", await response.text());
    return null;
  }

  const data = await response.json();
  return data.choices[0]?.message?.content?.trim() || null;
}

// ---------------------------------------------------------------------------
// Generator functions
// ---------------------------------------------------------------------------

async function generateEvergreen(): Promise<string> {
  const facts = await loadSubwayFacts();
  if (!facts) {
    return "Did you know the NYC subway runs 24 hours a day, 7 days a week? One of the only systems in the world that never sleeps.";
  }

  const fact = pickRandomFact(facts);

  const prompt = `You are a 1010 WINS-style NYC radio host sharing a fun subway fact. Rephrase this fact in an entertaining, conversational way: ${fact}. Keep it under 30 words. Sound natural, like you're chatting with a friend on the platform.`;

  const result = await chatCompletion(prompt, 80, 0.8);
  return result || fact;
}

async function generateWeather(): Promise<string> {
  const weather = await fetchWeather();

  if (!OPENAI_API_KEY) {
    return `Current temperature in New York City: ${weather.current.temp} degrees. Today's high ${weather.today.high}, low ${weather.today.low}.`;
  }

  const forecastText = weather.forecast
    .map((f) => `${f.day}: High ${f.high}, Low ${f.low}, ${f.description}`)
    .join("\n");

  const prompt = `You are the iconic voice of NYC weather - think Pat Kiernan meets a jazz DJ. Deliver this weather report with New York attitude and style.

CURRENT CONDITIONS:
- Temperature: ${weather.current.temp} (feels like ${weather.current.feelsLike})
- Conditions: ${weather.current.description}
- Humidity: ${weather.current.humidity} percent
- Wind: ${weather.current.windSpeed} miles per hour

TODAY:
- High: ${weather.today.high} / Low: ${weather.today.low}
- ${weather.today.description}

5-DAY FORECAST:
${forecastText}

Rules:
- Start with "RailTime Weather on the ones!" or similar catchy opener
- Current conditions first, then today, then quick 5-day outlook
- Add NYC flair - mention if it's "jacket weather" or "subway platform hot"
- Include a witty commuter tip based on weather
- End with signature sign-off like "Stay dry out there, New York" or "Bundle up, subway riders"
- Keep it under 120 words - punchy and memorable
- Sound like you're broadcasting from Times Square
- IMPORTANT: Never use degree symbols or abbreviations. Say "72" not "72 degrees" or "72°F". Just say the number.`;

  const result = await chatCompletion(prompt, 250, 0.8);
  return (
    result ||
    `RailTime Weather - it's ${weather.current.temp} degrees in New York City with ${weather.current.description}. Today's high ${weather.today.high}, low ${weather.today.low}. Stay safe out there.`
  );
}

async function generateNews(): Promise<string> {
  const news = await fetchRSSNews();

  if (!OPENAI_API_KEY || news.length === 0) {
    return "You're listening to RailTime News. No new updates at this time. Back to your regular train tracking.";
  }

  const headlines = news.map((n, i) => `${i + 1}. ${n.title}`).join("\n");

  const prompt = `You are a 1010 WINS style NYC news radio anchor. Read these headlines in a punchy, fast-paced New York news radio style.

Headlines:
${headlines}

Rules:
- Start with "You give us 10 minutes, we give you the world. This is RailTime News."
- Keep each headline to ONE short sentence
- Use NYC news radio cadence - quick, punchy, authoritative
- End with "Back to your trains. RailTime - know before you go."
- Total should be under 100 words
- Sound urgent and professional`;

  const result = await chatCompletion(prompt, 200, 0.7);
  return (
    result ||
    "You're listening to RailTime News. Stay tuned for updates. Back to your trains."
  );
}

async function generateTransitInsight(): Promise<string> {
  try {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!wsUrl) {
      return generateEvergreen();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${wsUrl}/api/transit-analysis`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return generateEvergreen();
    }

    const data = await response.json();
    const analysis: string | undefined = data.analysis;

    if (!analysis || analysis === "pending") {
      return generateEvergreen();
    }

    // Pick 1-2 sentences from the analysis
    const sentences = analysis
      .split(/(?<=[.!?])\s+/)
      .filter((s: string) => s.trim().length > 10);
    const insight = sentences.slice(0, 2).join(" ");

    const prompt = `You are a 1010 WINS-style NYC radio host delivering a transit update. Rewrite this transit analysis insight as punchy radio commentary: ${insight}. Keep it under 40 words. Sound urgent and professional.`;

    const result = await chatCompletion(prompt, 100, 0.7);
    return result || insight;
  } catch (error) {
    console.error("Transit insight fetch error:", error);
    return generateEvergreen();
  }
}

async function generateAlertLive(
  alerts: NonNullable<NewsroomRequest["alerts"]>
): Promise<string> {
  const facts = await loadSubwayFacts();
  const fact = facts ? pickRandomFact(facts) : "The NYC subway has 472 stations.";

  const alertDetails = alerts
    .map((a) => {
      const routes = a.affectedRoutes?.join(", ") || "multiple lines";
      return `${a.headerText} (affecting ${routes})`;
    })
    .join(". ");

  const prompt = `You are a 1010 WINS-style NYC radio host. Weave this service alert into an entertaining fact. Alert: ${alertDetails}. Fun fact: ${fact}. Create a natural transition from the fact to the alert info. Keep it under 50 words.`;

  const result = await chatCompletion(prompt, 120, 0.8);
  return (
    result ||
    `Service alert: ${alerts[0]?.headerText || "Check MTA for details"}.`
  );
}

// ---------------------------------------------------------------------------
// Data fetchers (ported from conductor routes)
// ---------------------------------------------------------------------------

async function fetchWeather(): Promise<WeatherData> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${NYC_LAT}&longitude=${NYC_LON}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=America/New_York&forecast_days=6&temperature_unit=fahrenheit&wind_speed_unit=mph`;

  const response = await fetch(url, { next: { revalidate: 600 } });
  const data = await response.json();

  const weatherCodes: Record<number, string> = {
    0: "clear skies",
    1: "mostly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "foggy",
    48: "freezing fog",
    51: "light drizzle",
    53: "drizzle",
    55: "heavy drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    66: "freezing rain",
    67: "heavy freezing rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    77: "snow grains",
    80: "light showers",
    81: "showers",
    82: "heavy showers",
    85: "light snow showers",
    86: "heavy snow showers",
    95: "thunderstorms",
    96: "thunderstorms with hail",
    99: "severe thunderstorms",
  };

  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const forecast = data.daily.time
    .slice(1, 6)
    .map((date: string, i: number) => {
      const d = new Date(date);
      return {
        day: days[d.getDay()],
        high: Math.round(data.daily.temperature_2m_max[i + 1]),
        low: Math.round(data.daily.temperature_2m_min[i + 1]),
        description:
          weatherCodes[data.daily.weather_code[i + 1]] || "variable conditions",
      };
    });

  return {
    current: {
      temp: Math.round(data.current.temperature_2m),
      feelsLike: Math.round(data.current.apparent_temperature),
      humidity: data.current.relative_humidity_2m,
      windSpeed: Math.round(data.current.wind_speed_10m),
      description:
        weatherCodes[data.current.weather_code] || "variable conditions",
    },
    today: {
      high: Math.round(data.daily.temperature_2m_max[0]),
      low: Math.round(data.daily.temperature_2m_min[0]),
      description:
        weatherCodes[data.daily.weather_code[0]] || "variable conditions",
    },
    forecast,
  };
}

async function fetchRSSNews(): Promise<NewsItem[]> {
  const allNews: NewsItem[] = [];

  for (const feedUrl of NYC_RSS_FEEDS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(feedUrl, {
        next: { revalidate: 300 },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(
          `RSS feed returned ${response.status} for ${feedUrl}, skipping`
        );
        continue;
      }

      const xml = await response.text();
      const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

      for (const item of itemMatches.slice(0, 5)) {
        const titleMatch = item.match(
          /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/
        );
        const descMatch = item.match(
          /<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/
        );

        if (titleMatch) {
          allNews.push({
            title: titleMatch[1].replace(/<[^>]*>/g, "").trim(),
            description: descMatch
              ? descMatch[1]
                  .replace(/<[^>]*>/g, "")
                  .substring(0, 100)
                  .trim()
              : undefined,
          });
        }
      }
    } catch (error) {
      console.error(`Failed to fetch RSS from ${feedUrl}:`, error);
    }
  }

  return allNews.sort(() => Math.random() - 0.5).slice(0, 5);
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Rate limit check
  const clientId = getClientId(request);
  const key = createRateLimitKey(clientId, "/api/v1/newsroom/segment");
  const limit = checkRateLimit(key, RATE_LIMITS.conductor);
  if (!limit.success) {
    return rateLimited(limit.resetIn);
  }

  try {
    const body: NewsroomRequest = await request.json();

    // Validate type
    if (!body.type || !VALID_TYPES.includes(body.type as SegmentType)) {
      return badRequest(
        `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}`
      );
    }

    const segmentType = body.type as SegmentType;

    // Validate alerts required for alert-live
    if (segmentType === "alert-live") {
      if (!body.alerts || !Array.isArray(body.alerts) || body.alerts.length === 0) {
        return badRequest(
          "alerts array is required and must not be empty for type alert-live"
        );
      }
    }

    const category = CATEGORY_MAP[segmentType];
    const ttl = TTL_MAP[segmentType];
    const voice = VOICE_MAP[segmentType];

    // --- Generate text ---
    let text: string;

    switch (segmentType) {
      case "evergreen":
        text = await generateEvergreen();
        break;
      case "weather":
        text = await generateWeather();
        break;
      case "news":
        text = await generateNews();
        break;
      case "transit-insight":
        text = await generateTransitInsight();
        break;
      case "alert-live":
        text = await generateAlertLive(body.alerts!);
        break;
      default: {
        const _exhaustive: never = segmentType;
        return badRequest(`Unhandled type: ${_exhaustive}`);
      }
    }

    // --- SHA-256 hash of generated text ---
    const segmentId = createHash("sha256").update(text).digest("hex");

    // --- For alert-live: skip all caching ---
    if (segmentType === "alert-live") {
      const audioBase64 = await synthesizeSpeech(text, voice);
      const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;

      return NextResponse.json({
        text,
        audioUrl,
        segmentId,
        category,
        cached: false,
        ttl: 0,
      });
    }

    // --- Check Redis cache ---
    const audioCacheKey = `newsroom:audio:${segmentId}`;
    const cached = await getCache<CachedAudio>(audioCacheKey);

    if (cached) {
      return NextResponse.json({
        text: cached.text,
        audioUrl: `data:audio/mpeg;base64,${cached.audioBase64}`,
        segmentId,
        category,
        cached: true,
        ttl,
      });
    }

    // --- TTS synthesis ---
    const audioBase64 = await synthesizeSpeech(text, voice);
    const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;

    // --- Store in Redis ---
    const cachePayload: CachedAudio = {
      text,
      audioBase64,
      category,
      createdAt: Date.now(),
    };
    await setCache(audioCacheKey, cachePayload, ttl);

    // --- Add to library sorted set ---
    const libraryKey = `newsroom:library:${category}`;
    await zaddToSet(libraryKey, Date.now(), segmentId);

    return NextResponse.json({
      text,
      audioUrl,
      segmentId,
      category,
      cached: false,
      ttl,
    });
  } catch (error) {
    console.error("Newsroom segment error:", error);
    return internalError("Failed to generate newsroom segment");
  }
}
