import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVEN_LABS_KEY || process.env.ELEVENLABS_API_KEY;
// Use user's custom voice or fallback to "Adam" (built-in premade voice)
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';

// Simple in-memory cache for audio (expires after 5 minutes)
const audioCache = new Map<string, { text: string; audioUrl: string; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Route data cache
let routeDataCache: Map<string, { longName: string; description: string }> | null = null;
let stationsEnrichedCache: Record<string, { crossStreet?: string }> | null = null;
let subwayFactsCache: SubwayFacts | null = null;

// Subway facts type
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

// Announcement types for variety
const ANNOUNCEMENT_TYPES = [
  'welcome',
  'arrival',
  'fun_fact',
  'poi_spotlight',
  'cross_street',
  'transfer_tip',
] as const;

type AnnouncementType = typeof ANNOUNCEMENT_TYPES[number];

interface AnnounceRequest {
  routeId: string;
  stationId?: string;
  stationName: string;
  direction?: string;
  headsign?: string;
  poiName?: string;
  crossStreet?: string;
  announcementType?: AnnouncementType;
}

/**
 * Expand common NYC subway station name abbreviations
 */
function expandStationName(name: string): string {
  let expanded = name
    // Common abbreviations
    .replace(/\bSt\b/g, 'Street')
    .replace(/\bAv\b/g, 'Avenue')
    .replace(/\bAve\b/g, 'Avenue')
    .replace(/\bPkwy\b/g, 'Parkway')
    .replace(/\bBlvd\b/g, 'Boulevard')
    .replace(/\bHts\b/g, 'Heights')
    .replace(/\bPl\b/g, 'Place')
    .replace(/\bSq\b/g, 'Square')
    .replace(/\bJct\b/g, 'Junction')
    .replace(/\bCtr\b/g, 'Center')
    .replace(/\bBch\b/g, 'Beach')
    .replace(/\bRd\b/g, 'Road')
    .replace(/\bExpwy\b/g, 'Expressway')
    .replace(/\bPk\b/g, 'Park')
    .replace(/\bFt\b/g, 'Fort')
    .replace(/\bMt\b/g, 'Mount')
    .replace(/\bN\b/g, 'North')
    .replace(/\bS\b/g, 'South')
    .replace(/\bE\b/g, 'East')
    .replace(/\bW\b/g, 'West');

  // Add ordinal suffixes to numbers before Street/Avenue
  // "125 Street" -> "125th Street"
  expanded = expanded.replace(/(\d+)\s+(Street|Avenue)/g, (match, num, type) => {
    const n = parseInt(num);
    let suffix: string;
    if ([11, 12, 13].includes(n % 100)) {
      suffix = 'th';
    } else if (n % 10 === 1) {
      suffix = 'st';
    } else if (n % 10 === 2) {
      suffix = 'nd';
    } else if (n % 10 === 3) {
      suffix = 'rd';
    } else {
      suffix = 'th';
    }
    return `${num}${suffix} ${type}`;
  });

  return expanded;
}

/**
 * Load route data from routes.txt
 */
async function loadRouteData(): Promise<Map<string, { longName: string; description: string }>> {
  if (routeDataCache) return routeDataCache;

  try {
    const filePath = path.join(process.cwd(), 'public', 'data', 'routes.txt');
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').slice(1); // Skip header

    routeDataCache = new Map();
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.split(',');
      // agency_id,route_id,route_short_name,route_long_name,route_type,route_desc,...
      const routeId = parts[1];
      const longName = parts[3] || '';
      const description = parts[5] || '';
      if (routeId) {
        routeDataCache.set(routeId, { longName, description });
      }
    }
    return routeDataCache;
  } catch (error) {
    console.error('Failed to load route data:', error);
    return new Map();
  }
}

/**
 * Load enriched station data
 */
async function loadStationsEnriched(): Promise<Record<string, { crossStreet?: string }>> {
  if (stationsEnrichedCache) return stationsEnrichedCache;

  try {
    const filePath = path.join(process.cwd(), 'public', 'data', 'stations-enriched.json');
    const content = await fs.readFile(filePath, 'utf-8');
    stationsEnrichedCache = JSON.parse(content);
    return stationsEnrichedCache!;
  } catch (error) {
    console.error('Failed to load enriched stations:', error);
    return {};
  }
}

/**
 * Load subway facts data
 */
async function loadSubwayFacts(): Promise<SubwayFacts | null> {
  if (subwayFactsCache) return subwayFactsCache;

  try {
    const filePath = path.join(process.cwd(), 'public', 'data', 'subway-facts.json');
    const content = await fs.readFile(filePath, 'utf-8');
    subwayFactsCache = JSON.parse(content);
    return subwayFactsCache;
  } catch (error) {
    console.error('Failed to load subway facts:', error);
    return null;
  }
}

/**
 * Get a relevant fact for the current context
 */
function getRelevantFact(
  facts: SubwayFacts,
  routeId: string,
  stationName: string,
  announcementType: AnnouncementType
): string | null {
  // Try to find station-specific fact first
  for (const [stationKey, stationFacts] of Object.entries(facts.stations)) {
    if (stationName.includes(stationKey) || stationKey.includes(stationName.split(' ')[0])) {
      if (stationFacts.length > 0) {
        return stationFacts[Math.floor(Math.random() * stationFacts.length)];
      }
    }
  }

  // Try route-specific fact
  const routeFacts = facts.routes[routeId];
  if (routeFacts && routeFacts.length > 0) {
    return routeFacts[Math.floor(Math.random() * routeFacts.length)];
  }

  // Fall back to category based on announcement type
  switch (announcementType) {
    case 'fun_fact': {
      const allFunFacts = [...facts.general, ...facts.trivia, ...facts.history];
      return allFunFacts[Math.floor(Math.random() * allFunFacts.length)];
    }
    case 'transfer_tip': {
      const transferFacts = [...facts.engineering, ...facts.history];
      return transferFacts[Math.floor(Math.random() * transferFacts.length)];
    }
    default: {
      const generalFacts = [...facts.general, ...facts.trivia];
      return generalFacts[Math.floor(Math.random() * generalFacts.length)];
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: AnnounceRequest = await request.json();
    const { routeId, stationId, stationName, direction, headsign, poiName, crossStreet, announcementType } = body;

    if (!routeId || !stationName) {
      return NextResponse.json(
        { error: 'Missing required fields: routeId, stationName' },
        { status: 400 }
      );
    }

    // Expand station name
    const expandedStationName = expandStationName(stationName);
    const expandedHeadsign = headsign ? expandStationName(headsign) : undefined;

    // Load route data for long name
    const routeData = await loadRouteData();
    const routeInfo = routeData.get(routeId);
    const routeLongName = routeInfo?.longName || `${routeId} train`;

    // Get cross street from enriched data if not provided
    let finalCrossStreet = crossStreet;
    if (!finalCrossStreet && stationId) {
      const enrichedStations = await loadStationsEnriched();
      const parentStationId = stationId.replace(/[NS]$/, ''); // Remove N/S suffix
      finalCrossStreet = enrichedStations[parentStationId]?.crossStreet;
    }
    const expandedCrossStreet = finalCrossStreet ? expandStationName(finalCrossStreet) : undefined;

    // Pick announcement type if not specified
    const type = announcementType || ANNOUNCEMENT_TYPES[Math.floor(Math.random() * ANNOUNCEMENT_TYPES.length)];

    // Create cache key
    const cacheKey = `${routeId}-${stationName}-${direction}-${headsign}-${poiName || ''}-${type}`;
    const cached = audioCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return NextResponse.json({
        text: cached.text,
        audioUrl: cached.audioUrl,
        cached: true,
      });
    }

    // Generate announcement text with OpenAI
    const announcementText = await generateAnnouncement({
      routeId,
      routeLongName,
      stationName: expandedStationName,
      crossStreet: expandedCrossStreet,
      direction,
      headsign: expandedHeadsign,
      poiName,
      announcementType: type,
    });

    // Synthesize speech with ElevenLabs
    const audioBase64 = await synthesizeSpeech(announcementText);
    const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;

    // Cache the result
    audioCache.set(cacheKey, {
      text: announcementText,
      audioUrl: audioUrl,
      expires: Date.now() + CACHE_TTL,
    });

    // Clean old cache entries
    if (audioCache.size > 100) {
      const now = Date.now();
      for (const [key, value] of audioCache.entries()) {
        if (value.expires < now) {
          audioCache.delete(key);
        }
      }
    }

    return NextResponse.json({
      text: announcementText,
      audioUrl: audioUrl,
      cached: false,
    });
  } catch (error) {
    console.error('Conductor announce error:', error);
    return NextResponse.json(
      { error: 'Failed to generate announcement' },
      { status: 500 }
    );
  }
}

interface GenerateAnnouncementParams {
  routeId: string;
  routeLongName: string;
  stationName: string;
  crossStreet?: string;
  direction?: string;
  headsign?: string;
  poiName?: string;
  announcementType: AnnouncementType;
}

async function generateAnnouncement(params: GenerateAnnouncementParams): Promise<string> {
  const { routeId, routeLongName, stationName, crossStreet, direction, headsign, poiName, announcementType } = params;

  if (!OPENAI_API_KEY) {
    // Fallback if no API key
    return `The ${routeId} train is arriving at ${stationName}${headsign ? `, headed to ${headsign}` : ''}.`;
  }

  // Load subway facts and get a relevant one
  const facts = await loadSubwayFacts();
  let relevantFact = '';
  if (facts && (announcementType === 'fun_fact' || announcementType === 'transfer_tip')) {
    relevantFact = getRelevantFact(facts, routeId, stationName, announcementType) || '';
  }

  const prompt = `You are an enthusiastic NYC subway tour guide making entertaining announcements. Your personality: Friendly, knowledgeable, witty. You LOVE the subway!

Current train info:
- Route: ${routeId} train (${routeLongName})
- Station: ${stationName}
${crossStreet ? `- Cross-streets: ${crossStreet}` : ''}
- Direction: ${direction || 'unknown'}
${headsign ? `- Destination: ${headsign}` : ''}
${poiName ? `- Nearby attraction: ${poiName}` : ''}
${relevantFact ? `\nREAL FACT TO INCORPORATE: "${relevantFact}"` : ''}

Generate a ${announcementType.replace('_', ' ')} announcement.

${announcementType === 'welcome' ? 'Welcome the user to RailTime NYC - a real-time NYC subway tracker! Be excited and mention we track over 400 stations and show live train positions. Make it feel like stepping into the subway system.' : ''}
${announcementType === 'arrival' ? 'Focus on the train arriving and where it\'s headed.' : ''}
${announcementType === 'fun_fact' ? `Share the REAL FACT provided above in an entertaining way. Rephrase it naturally.` : ''}
${announcementType === 'poi_spotlight' ? `Highlight ${poiName || 'a nearby attraction'} - make it sound exciting!` : ''}
${announcementType === 'cross_street' ? `Tell riders about the cross-streets (${crossStreet || 'the neighborhood'}) in an interesting way.` : ''}
${announcementType === 'transfer_tip' ? 'Give a helpful transfer tip or share the REAL FACT provided above.' : ''}

Rules:
- Keep it under 30 words
- NEVER use abbreviations - say "Street" not "St", "Avenue" not "Av"
- Be entertaining but informative
- Sound natural, like talking to a friend
- No quotes around your response
- If a REAL FACT is provided, USE IT - don't make up different facts`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 80,
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    console.error('OpenAI API error:', await response.text());
    return `The ${routeId} train is arriving at ${stationName}.`;
  }

  const data = await response.json();
  return data.choices[0]?.message?.content?.trim() || `The ${routeId} train is arriving at ${stationName}.`;
}

async function synthesizeSpeech(text: string): Promise<string> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('ElevenLabs API error:', errorText);
    throw new Error('Failed to synthesize speech');
  }

  // Convert audio buffer to base64
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return base64;
}
