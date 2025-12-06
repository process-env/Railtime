'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getRouteColor, FEED_GROUPS } from '@/lib/constants';

interface FeedStatus {
  feedId: string;
  lastPoll: string;
  tripCount: number;
  status: 'healthy' | 'stale' | 'error';
}

interface FeedStatusCardProps {
  feeds: FeedStatus[];
}

export function FeedStatusCard({ feeds }: FeedStatusCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Feed Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {feeds.map((feed) => {
            const feedGroup = FEED_GROUPS.find((g) => g.id === feed.feedId);
            const color = feedGroup?.color || '#888';

            return (
              <div
                key={feed.feedId}
                className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-medium">{feed.feedId}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {feed.tripCount} trips
                  </span>
                  <Badge
                    variant={
                      feed.status === 'healthy'
                        ? 'default'
                        : feed.status === 'stale'
                        ? 'secondary'
                        : 'destructive'
                    }
                  >
                    {feed.status}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
