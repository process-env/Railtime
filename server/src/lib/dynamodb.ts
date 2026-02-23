/**
 * DynamoDB Document Client singleton.
 *
 * Lazy initialization — returns null when AWS_REGION is not set,
 * allowing the server to run without analytics.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createLogger } from './logger.js';

const log = createLogger('dynamodb');

let docClient: DynamoDBDocumentClient | null = null;
let initialized = false;

export function getDynamoClient(): DynamoDBDocumentClient | null {
  if (initialized) return docClient;
  initialized = true;

  const region = process.env.AWS_REGION;
  if (!region) {
    log.warn('AWS_REGION not set — analytics persistence disabled');
    return null;
  }

  const client = new DynamoDBClient({ region });
  docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  log.info('client initialized');
  return docClient;
}

export function closeDynamoClient(): void {
  if (docClient) {
    docClient.destroy();
    docClient = null;
    initialized = false;
    log.info('client closed');
  }
}
