'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  Bell,
  Lightbulb,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TransitAnalysisResponse {
  analysis: string;
  generatedAt: string;
  model: string;
}

interface AnalysisSection {
  title: string;
  content: string;
  icon: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Auto-refresh interval: 10 minutes in ms */
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/** Module-level cache — survives component remounts (tab switches) */
let cachedResult: TransitAnalysisResponse | null = null;
let cacheTimestamp = 0;
const CACHE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

function getCachedResult(): TransitAnalysisResponse | null {
  if (cachedResult && Date.now() - cacheTimestamp < CACHE_MAX_AGE_MS) {
    return cachedResult;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the analysis text into sections. Sections are delimited by
 * **Section Name** headers. Content between headers belongs to that section.
 */
function parseAnalysisSections(text: string): AnalysisSection[] {
  // Match **Section Name** patterns and split on them
  const sectionRegex = /\*\*(.+?)\*\*/g;
  const parts: { title: string; startIndex: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(text)) !== null) {
    parts.push({ title: match[1].trim(), startIndex: match.index + match[0].length });
  }

  if (parts.length === 0) {
    // No sections found — treat the entire text as a single section
    return [
      {
        title: 'Analysis',
        content: text.trim(),
        icon: <Brain className="h-4 w-4 text-muted-foreground" />,
      },
    ];
  }

  return parts.map((part, i) => {
    const endIndex = i < parts.length - 1
      ? text.lastIndexOf('**', parts[i + 1].startIndex - parts[i + 1].title.length - 4)
      : text.length;
    const content = text.slice(part.startIndex, endIndex).trim();

    return {
      title: part.title,
      content,
      icon: getSectionIcon(part.title),
    };
  });
}

function getSectionIcon(title: string): React.ReactNode {
  const lower = title.toLowerCase();

  if (lower.includes('status')) {
    return <StatusDot title={title} />;
  }
  if (lower.includes('performer') || lower.includes('top')) {
    return <TrendingUp className="h-4 w-4 text-green-500" />;
  }
  if (lower.includes('problem') || lower.includes('worst') || lower.includes('issue')) {
    return <AlertTriangle className="h-4 w-4 text-red-500" />;
  }
  if (lower.includes('alert') || lower.includes('impact')) {
    return <Bell className="h-4 w-4 text-yellow-500" />;
  }
  if (lower.includes('tip') || lower.includes('rider') || lower.includes('recommend')) {
    return <Lightbulb className="h-4 w-4 text-blue-500" />;
  }

  return <Brain className="h-4 w-4 text-muted-foreground" />;
}

/**
 * Renders a green / yellow / red status dot based on keywords in the
 * section title (and heuristically in the content, if needed).
 */
function StatusDot({ title }: { title: string }) {
  const lower = title.toLowerCase();
  let color = 'bg-green-500'; // default: assume good
  if (lower.includes('degrad') || lower.includes('partial') || lower.includes('moderate')) {
    color = 'bg-yellow-500';
  }
  if (lower.includes('disrupt') || lower.includes('major') || lower.includes('critical')) {
    color = 'bg-red-500';
  }
  return <span className={cn('inline-block h-3 w-3 rounded-full shrink-0', color)} />;
}

/**
 * Returns a human-readable relative time string, e.g. "2 min ago".
 */
function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  return `${hours} hours ago`;
}

function formatTime(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return isoDate;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TransitAnalysisCard() {
  const [data, setData] = useState<TransitAnalysisResponse | null>(getCachedResult);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAnalysis = useCallback(async () => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!wsUrl) {
      setError('WebSocket server URL not configured');
      return;
    }

    setRefreshing(true);

    try {
      const res = await fetch(`${wsUrl}/api/transit-analysis`);
      if (!res.ok) {
        throw new Error(`Server responded with ${res.status}`);
      }
      const json: TransitAnalysisResponse = await res.json();

      // Update module-level cache
      cachedResult = json;
      cacheTimestamp = Date.now();

      setData(json);
      setError(null);
    } catch (err) {
      // Only set error if we have no cached data to show
      if (!cachedResult) {
        setError(err instanceof Error ? err.message : 'Failed to fetch analysis');
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Fetch if cache is stale/empty + auto-refresh every 10 minutes
  useEffect(() => {
    // Only fetch if cache is stale or empty
    const cached = getCachedResult();
    if (!cached) {
      fetchAnalysis();
    }

    intervalRef.current = setInterval(() => {
      fetchAnalysis();
    }, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchAnalysis]);

  // --- Error or no-data state (never a skeleton) ---
  if (error || !data) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Transit Analysis
            {refreshing && (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
            <Brain className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {error ? 'Transit analysis unavailable' : 'Analysis generating — updates every 5 minutes'}
            </p>
            {error && (
              <Button variant="outline" size="sm" onClick={() => fetchAnalysis()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Success state ---
  const sections = parseAnalysisSections(data.analysis);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          AI Transit Analysis
          {refreshing && (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />
          )}
        </CardTitle>
        <Badge variant="secondary" className="text-[10px] w-fit">
          Powered by {data.model}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {sections.map((section, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex items-center gap-2">
              {section.icon}
              <span className="text-sm font-semibold">{section.title}</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed pl-6">
              {section.content}
            </p>
          </div>
        ))}
      </CardContent>

      <CardFooter className="text-xs text-muted-foreground gap-2">
        <span>Generated at {formatTime(data.generatedAt)}</span>
        <span className="text-muted-foreground/50">|</span>
        <span>Last updated {relativeTime(data.generatedAt)}</span>
      </CardFooter>
    </Card>
  );
}
