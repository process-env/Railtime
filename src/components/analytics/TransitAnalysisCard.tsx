'use client';

import {
  Brain,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTransitAnalysis } from '@/hooks/use-transit-analysis';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse analysis text into individual bullet points.
 * The model outputs markdown bullets starting with "- ".
 */
function parseBulletPoints(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.replace(/^[-*•]\s*/, '').trim())
    .filter(line => line.length > 0);
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
  const { data, isLoading, isRefetching, error, refetch } = useTransitAnalysis();

  // --- Error or no-data state (never a skeleton) ---
  if (error || (!data && !isLoading)) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Transit Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
            <Brain className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {error ? 'Transit analysis unavailable' : 'Analysis generating — updates every 5 minutes'}
            </p>
            {error && (
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Loading state (no cached data yet) ---
  if (!data) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Transit Analysis
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
            <Brain className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Analysis generating — updates every 5 minutes
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Success state ---
  const insights = parseBulletPoints(data.analysis);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          AI Transit Analysis
          {isRefetching && (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />
          )}
        </CardTitle>
        <Badge variant="secondary" className="text-[10px] w-fit">
          Powered by {data.model}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-3">
        {insights.map((insight, i) => (
          <div key={i} className="flex gap-3">
            <Brain className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              {insight}
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
