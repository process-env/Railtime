import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from "@/lib/api/rate-limit";
import { badRequest, internalError, rateLimited } from "@/lib/api/errors";
import { getCache, zrangeFromSet, zcardOfSet } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SegmentCategory = "evergreen" | "semi-live";

const VALID_CATEGORIES: SegmentCategory[] = ["evergreen", "semi-live"];

interface CachedAudio {
  text: string;
  audioBase64: string;
  category: string;
  createdAt: number;
}

interface LibrarySegment {
  segmentId: string;
  text: string;
  category: SegmentCategory;
  createdAt: number;
}

interface LibraryResponse {
  segments: LibrarySegment[];
  stats: {
    evergreen: number;
    semiLive: number;
    total: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Rate limit check
  const clientId = getClientId(request);
  const key = createRateLimitKey(clientId, "/api/v1/newsroom/library");
  const limit = checkRateLimit(key, RATE_LIMITS.static);
  if (!limit.success) {
    return rateLimited(limit.resetIn);
  }

  try {
    const { searchParams } = request.nextUrl;

    // --- Validate category ---
    const categoryParam = searchParams.get("category");
    let category: SegmentCategory | null = null;

    if (categoryParam !== null) {
      if (!VALID_CATEGORIES.includes(categoryParam as SegmentCategory)) {
        return badRequest(
          `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`
        );
      }
      category = categoryParam as SegmentCategory;
    }

    // --- Validate limit ---
    const limitParam = searchParams.get("limit");
    let pageLimit = DEFAULT_LIMIT;

    if (limitParam !== null) {
      const parsed = parseInt(limitParam, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        return badRequest(
          `Invalid limit. Must be a number between 1 and ${MAX_LIMIT}`
        );
      }
      pageLimit = parsed;
    }

    // --- Validate offset ---
    const offsetParam = searchParams.get("offset");
    let offset = 0;

    if (offsetParam !== null) {
      const parsed = parseInt(offsetParam, 10);
      if (isNaN(parsed) || parsed < 0) {
        return badRequest("Invalid offset. Must be a non-negative number");
      }
      offset = parsed;
    }

    // --- Get stats from both sorted sets ---
    const [evergreenCount, semiLiveCount] = await Promise.all([
      zcardOfSet("newsroom:library:evergreen"),
      zcardOfSet("newsroom:library:semi-live"),
    ]);

    const stats = {
      evergreen: evergreenCount,
      semiLive: semiLiveCount,
      total: evergreenCount + semiLiveCount,
    };

    // --- Fetch segment hashes ---
    let hashes: string[];

    if (category) {
      // Single category: direct range query with pagination
      const setKey = `newsroom:library:${category}`;
      hashes = await zrangeFromSet(setKey, offset, offset + pageLimit - 1);
    } else {
      // No category filter: merge both sets by fetching from each,
      // then hydrate and sort by createdAt. We over-fetch to account
      // for expired entries that will be filtered out.
      const fetchCount = offset + pageLimit;
      const [evergreenHashes, semiLiveHashes] = await Promise.all([
        zrangeFromSet("newsroom:library:evergreen", 0, fetchCount - 1),
        zrangeFromSet("newsroom:library:semi-live", 0, fetchCount - 1),
      ]);
      // Deduplicate (a hash could theoretically appear in both sets)
      hashes = [...new Set([...evergreenHashes, ...semiLiveHashes])];
    }

    // --- Hydrate segments from audio cache ---
    const hydratePromises = hashes.map(async (hash): Promise<LibrarySegment | null> => {
      const cached = await getCache<CachedAudio>(`newsroom:audio:${hash}`);
      if (!cached) return null; // Audio expired

      return {
        segmentId: hash,
        text: cached.text,
        category: cached.category as SegmentCategory,
        createdAt: cached.createdAt,
      };
    });

    const hydrated = await Promise.all(hydratePromises);

    // Filter out expired entries (null) and apply category filter for
    // the merged case (redundant for single-category but harmless)
    let segments = hydrated.filter(
      (seg): seg is LibrarySegment => seg !== null
    );

    if (!category) {
      // Sort merged results by createdAt descending (newest first)
      segments.sort((a, b) => b.createdAt - a.createdAt);
      // Apply pagination for the merged case
      segments = segments.slice(offset, offset + pageLimit);
    }

    const response: LibraryResponse = {
      segments,
      stats,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Newsroom library error:", error);
    return internalError("Failed to fetch newsroom library");
  }
}
