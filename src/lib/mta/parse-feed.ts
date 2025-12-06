import path from 'path';
import protobuf from 'protobufjs';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const PROTO_PATH = path.join(DATA_DIR, 'gtfs-realtime.proto');

let FeedMessage: protobuf.Type | null = null;

export async function loadProtoSchema(): Promise<protobuf.Type> {
  if (FeedMessage) return FeedMessage;

  const root = await protobuf.load(PROTO_PATH);
  FeedMessage = root.lookupType('transit_realtime.FeedMessage');

  return FeedMessage;
}

export async function parseFeedBuffer(
  buffer: ArrayBuffer
): Promise<protobuf.Message> {
  const FeedMessage = await loadProtoSchema();
  return FeedMessage.decode(new Uint8Array(buffer));
}

/**
 * Convert a Unix timestamp (seconds) to an ISO 8601 string.
 */
export function formatTimestamp(ts: number | null | undefined): string | null {
  if (!ts) return null;
  try {
    return new Date(ts * 1000).toISOString();
  } catch {
    return null;
  }
}
