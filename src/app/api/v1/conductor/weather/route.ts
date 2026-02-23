import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIdentifier, createRateLimitHeaders } from "@/lib/rate-limit";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// NYC coordinates
const NYC_LAT = 40.7128;
const NYC_LON = -74.006;

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

async function fetchWeather(): Promise<WeatherData> {
  // Using Open-Meteo (free, no API key needed)
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${NYC_LAT}&longitude=${NYC_LON}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=America/New_York&forecast_days=6&temperature_unit=fahrenheit&wind_speed_unit=mph`;

  const response = await fetch(url, { next: { revalidate: 600 } }); // Cache 10 min
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

async function generateWeatherScript(weather: WeatherData): Promise<string> {
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

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 250,
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    return `RailTime Weather - it's ${weather.current.temp} degrees in New York City with ${weather.current.description}. Today's high ${weather.today.high}, low ${weather.today.low}. Stay safe out there.`;
  }

  const data = await response.json();
  return (
    data.choices[0]?.message?.content?.trim() ||
    `It's ${weather.current.temp} degrees in NYC.`
  );
}

async function synthesizeWeather(text: string): Promise<string> {
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
      voice: "echo", // Smooth male voice for weather
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to synthesize weather");
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

export async function GET(request: NextRequest) {
  // Rate limit check
  const clientId = getClientIdentifier(request);
  const { allowed, remaining, resetIn } = checkRateLimit(clientId, '/api/v1/conductor/weather');
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: createRateLimitHeaders(false, remaining, resetIn, '/api/v1/conductor/weather') }
    );
  }

  try {
    const weather = await fetchWeather();
    const script = await generateWeatherScript(weather);
    const audioBase64 = await synthesizeWeather(script);

    return NextResponse.json({
      text: script,
      audioUrl: `data:audio/mpeg;base64,${audioBase64}`,
      weather,
    });
  } catch (error) {
    console.error("Weather generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate weather" },
      { status: 500 }
    );
  }
}
