/**
 * S3 Client singleton.
 *
 * Lazy initialization — returns null when S3_ANALYTICS_BUCKET is not set,
 * allowing the server to run without S3 analytics storage.
 */
import { S3Client } from '@aws-sdk/client-s3';
import { createLogger } from './logger.js';

const log = createLogger('s3');

let s3Client: S3Client | null = null;
let bucket: string | null = null;
let initialized = false;

export function getS3Client(): S3Client | null {
  if (initialized) return s3Client;
  initialized = true;

  const region = process.env.AWS_REGION;
  if (!region) {
    log.warn('AWS_REGION not set — S3 analytics disabled');
    return null;
  }

  const bucketName = process.env.S3_ANALYTICS_BUCKET;
  if (!bucketName) {
    log.warn('S3_ANALYTICS_BUCKET not set — S3 analytics disabled');
    return null;
  }

  s3Client = new S3Client({ region });
  bucket = bucketName;
  log.info('client initialized (bucket: %s)', bucket);
  return s3Client;
}

export function getAnalyticsBucket(): string | null {
  if (!initialized) getS3Client();
  return bucket;
}

export function closeS3Client(): void {
  if (s3Client) {
    s3Client.destroy();
    s3Client = null;
    bucket = null;
    initialized = false;
    log.info('client closed');
  }
}
