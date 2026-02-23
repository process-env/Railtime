import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIdentifier, createRateLimitHeaders } from "@/lib/rate-limit";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// NYC RSS feeds to pull from
const NYC_RSS_FEEDS = [
  "https://rss.nytimes.com/services/xml/rss/nyt/NYRegion.xml",
  "https://gothamist.com/feed",
];

interface NewsItem {
  title: string;
  description?: string;
}

async function fetchRSSNews(): Promise<NewsItem[]> {
  const allNews: NewsItem[] = [];

  for (const feedUrl of NYC_RSS_FEEDS) {
    try {
      const response = await fetch(feedUrl, { next: { revalidate: 300 } });
      const xml = await response.text();

      // Simple XML parsing for RSS items
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

  // Shuffle and take top 5
  return allNews.sort(() => Math.random() - 0.5).slice(0, 5);
}

async function generateNewsScript(news: NewsItem[]): Promise<string> {
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

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    return "You're listening to RailTime News. Stay tuned for updates. Back to your trains.";
  }

  const data = await response.json();
  return (
    data.choices[0]?.message?.content?.trim() ||
    "RailTime News - back to your trains."
  );
}

async function synthesizeNews(text: string): Promise<string> {
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
      voice: "nova", // Female voice for news
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to synthesize news");
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

export async function GET(request: NextRequest) {
  // Rate limit check
  const clientId = getClientIdentifier(request);
  const { allowed, remaining, resetIn } = checkRateLimit(clientId, '/api/v1/conductor/news');
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: createRateLimitHeaders(false, remaining, resetIn, '/api/v1/conductor/news') }
    );
  }

  try {
    // Fetch news from RSS
    const news = await fetchRSSNews();

    // Generate news script
    const script = await generateNewsScript(news);

    // Synthesize with nova voice
    const audioBase64 = await synthesizeNews(script);

    return NextResponse.json({
      text: script,
      audioUrl: `data:audio/mpeg;base64,${audioBase64}`,
      headlines: news.map((n) => n.title),
    });
  } catch (error) {
    console.error("News generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate news" },
      { status: 500 }
    );
  }
}
