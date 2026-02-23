import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const {
      DynamoDBClient,
      DescribeTableCommand,
      DescribeTimeToLiveCommand,
    } = await import('@aws-sdk/client-dynamodb');
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
    });

    const tables = ['railtime-metrics', 'railtime-events'];
    const results = [];

    for (const tableName of tables) {
      const [desc, ttl] = await Promise.all([
        client.send(new DescribeTableCommand({ TableName: tableName })),
        client.send(new DescribeTimeToLiveCommand({ TableName: tableName })),
      ]);
      const ttlSpec = ttl.TimeToLiveDescription;
      results.push({
        table: tableName,
        ttlEnabled: ttlSpec?.TimeToLiveStatus === 'ENABLED',
        ttlAttribute: ttlSpec?.AttributeName,
        itemCount: desc.Table?.ItemCount,
      });
    }

    return NextResponse.json({ success: true, tables: results });
  } catch (err) {
    console.error('[cron/ttl-health-check] TTL health check failed:', err);
    return NextResponse.json(
      { error: 'Health check failed' },
      { status: 500 },
    );
  }
}
