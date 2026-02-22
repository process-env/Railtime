import { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';

const s3 = new S3Client({});
const BUCKET = process.env.S3_BUCKET;
if (!BUCKET) throw new Error('Missing required environment variable: S3_BUCKET');

interface GroupedRecords {
  metrics: Record<string, unknown>[];
  events: Record<string, unknown>[];
}

function classifyRecord(record: DynamoDBRecord): 'metrics' | 'events' | null {
  const image = record.dynamodb?.NewImage;
  if (!image) return null;

  const item = unmarshall(image as Record<string, AttributeValue>);

  // metrics table has routeId as PK; events table has pk (e.g. "DELAY#A")
  if ('routeId' in item && 'trainCount' in item) return 'metrics';
  if ('pk' in item) return 'events';
  return null;
}

function getS3Key(type: 'metrics' | 'events', now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hour = String(now.getUTCHours()).padStart(2, '0');
  const ts = now.getTime();
  const id = randomUUID().slice(0, 8);

  if (type === 'metrics') {
    return `raw/metrics/year=${year}/month=${month}/day=${day}/hour=${hour}/${ts}-${id}.ndjson`;
  }
  return `raw/events/year=${year}/month=${month}/day=${day}/${ts}-${id}.ndjson`;
}

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  const grouped: GroupedRecords = { metrics: [], events: [] };

  for (const record of event.Records) {
    if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') continue;

    const image = record.dynamodb?.NewImage;
    if (!image) continue;

    const type = classifyRecord(record);
    if (!type) continue;

    const item = unmarshall(image as Record<string, AttributeValue>);
    grouped[type].push(item);
  }

  const now = new Date();
  const uploads: Promise<unknown>[] = [];

  for (const type of ['metrics', 'events'] as const) {
    const records = grouped[type];
    if (records.length === 0) continue;

    const ndjson = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    const key = getS3Key(type, now);

    uploads.push(
      s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: ndjson,
          ContentType: 'application/x-ndjson',
        }),
      ),
    );

    console.log(`[stream-to-s3] Writing ${records.length} ${type} records to s3://${BUCKET}/${key}`);
  }

  try {
    await Promise.all(uploads);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stream-to-s3] Failed to write to S3: ${message}`);
    throw err; // Re-throw so Lambda retries from DynamoDB stream
  }
}
