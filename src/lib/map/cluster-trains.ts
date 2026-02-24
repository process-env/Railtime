/**
 * Train clustering utilities for handling overlapping train markers
 *
 * When multiple trains are at the same location, this module provides
 * offset calculations so all train colors remain visible.
 */

/**
 * Threshold in degrees (approximately 50 meters at NYC latitude)
 * Trains closer than this will be considered overlapping
 */
const CLUSTER_THRESHOLD_DEGREES = 0.0005;

/**
 * Offset in pixels between stacked train markers
 */
const MARKER_OFFSET_PX = 12;

/**
 * Maximum number of offsets to apply (to prevent markers from going too far)
 */
const MAX_OFFSET_LEVELS = 5;

/**
 * A train with position information
 */
export interface TrainWithPosition {
  tripId: string;
  lat: number;
  lon: number;
  routeId: string;
}

/**
 * Cluster of overlapping trains
 */
export interface TrainCluster {
  /** Center latitude of the cluster */
  centerLat: number;
  /** Center longitude of the cluster */
  centerLon: number;
  /** Trains in this cluster, sorted by route for consistent ordering */
  trains: TrainWithPosition[];
}

/**
 * Offset calculation result for a specific train
 */
export interface TrainOffset {
  /** Offset in pixels on X axis */
  offsetX: number;
  /** Offset in pixels on Y axis */
  offsetY: number;
  /** Z-index for stacking order */
  zIndex: number;
}

/**
 * Map from tripId to offset
 */
export type TrainOffsetMap = Map<string, TrainOffset>;

/**
 * Create a spatial grid key for efficient neighbor lookups.
 *
 * Note: The grid uses a fixed degree-based cell size, so the physical width of
 * each cell varies with latitude. At the equator, 1 degree of longitude is ~111 km,
 * but at NYC's latitude (~40.7N) it is only ~84 km. This is acceptable for our use
 * case because (1) all trains are within the NYC metro area where cos(lat) is roughly
 * constant, and (2) the 3x3 neighborhood check in clusterTrains compensates for
 * boundary effects. A more precise approach would scale the longitude grid size by
 * 1/cos(lat), but the added complexity is not warranted for a single-city application.
 */
function getGridKey(lat: number, lon: number): string {
  // Use a grid cell size slightly larger than threshold for overlap detection
  const gridSize = CLUSTER_THRESHOLD_DEGREES * 2;
  const gridLat = Math.floor(lat / gridSize);
  const gridLon = Math.floor(lon / gridSize);
  return `${gridLat}:${gridLon}`;
}

/**
 * Check if two trains are within clustering distance
 */
function areTrainsClose(
  train1: TrainWithPosition,
  train2: TrainWithPosition
): boolean {
  const latDiff = Math.abs(train1.lat - train2.lat);
  const lonDiff = Math.abs(train1.lon - train2.lon);
  return latDiff < CLUSTER_THRESHOLD_DEGREES && lonDiff < CLUSTER_THRESHOLD_DEGREES;
}

/**
 * Cluster trains that are at overlapping positions
 *
 * Uses a spatial grid for O(n) average performance instead of O(n²)
 *
 * @param trains Array of trains with positions
 * @returns Array of train clusters
 */
export function clusterTrains(trains: TrainWithPosition[]): TrainCluster[] {
  if (trains.length === 0) return [];

  // Build spatial grid for efficient neighbor lookup
  const grid = new Map<string, TrainWithPosition[]>();

  for (const train of trains) {
    const key = getGridKey(train.lat, train.lon);
    if (!grid.has(key)) {
      grid.set(key, []);
    }
    grid.get(key)!.push(train);
  }

  // Track which trains have been assigned to clusters
  const assigned = new Set<string>();
  const clusters: TrainCluster[] = [];

  for (const train of trains) {
    if (assigned.has(train.tripId)) continue;

    // Start a new cluster with this train
    const clusterTrains: TrainWithPosition[] = [train];
    assigned.add(train.tripId);

    // Check neighboring grid cells for nearby trains
    const centerKey = getGridKey(train.lat, train.lon);
    const [gridLat, gridLon] = centerKey.split(':').map(Number);

    // Check 3x3 grid neighborhood
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        const neighborKey = `${gridLat + dLat}:${gridLon + dLon}`;
        const neighbors = grid.get(neighborKey);
        if (!neighbors) continue;

        for (const neighbor of neighbors) {
          if (assigned.has(neighbor.tripId)) continue;
          if (neighbor.tripId === train.tripId) continue;

          // Check if within clustering distance
          if (areTrainsClose(train, neighbor)) {
            clusterTrains.push(neighbor);
            assigned.add(neighbor.tripId);
          }
        }
      }
    }

    // Sort trains in cluster by route for consistent ordering
    clusterTrains.sort((a, b) => a.routeId.localeCompare(b.routeId));

    // Calculate cluster center (average position)
    const centerLat = clusterTrains.reduce((sum, t) => sum + t.lat, 0) / clusterTrains.length;
    const centerLon = clusterTrains.reduce((sum, t) => sum + t.lon, 0) / clusterTrains.length;

    clusters.push({
      centerLat,
      centerLon,
      trains: clusterTrains,
    });
  }

  return clusters;
}

/**
 * Calculate pixel offsets for trains in clusters
 *
 * Trains in clusters of 2+ get diagonal offsets so all colors are visible.
 * Single trains get no offset.
 *
 * @param trains Array of trains with positions
 * @returns Map from tripId to offset values
 */
export function calculateTrainOffsets(trains: TrainWithPosition[]): TrainOffsetMap {
  const offsets: TrainOffsetMap = new Map();

  // Initialize all trains with no offset
  for (const train of trains) {
    offsets.set(train.tripId, { offsetX: 0, offsetY: 0, zIndex: 1 });
  }

  // Get clusters
  const clusters = clusterTrains(trains);

  // Apply offsets to clustered trains
  for (const cluster of clusters) {
    if (cluster.trains.length === 1) {
      // Single train - no offset needed
      continue;
    }

    // Multiple trains - apply diagonal offsets
    // First train stays at center, subsequent trains get offset
    cluster.trains.forEach((train, index) => {
      if (index === 0) {
        // First train stays at center
        offsets.set(train.tripId, { offsetX: 0, offsetY: 0, zIndex: cluster.trains.length });
        return;
      }

      // Calculate offset level (capped at max)
      const level = Math.min(index, MAX_OFFSET_LEVELS);

      // Diagonal offset (up-right direction)
      // This creates a stacked effect where each train is visible
      const offset = level * MARKER_OFFSET_PX;

      offsets.set(train.tripId, {
        offsetX: offset,
        offsetY: -offset, // Negative Y moves up
        zIndex: cluster.trains.length - index, // Lower z-index for offset trains
      });
    });
  }

  return offsets;
}

/**
 * Check if a train needs an offset (is part of a cluster)
 */
export function isTrainClustered(
  tripId: string,
  offsets: TrainOffsetMap
): boolean {
  const offset = offsets.get(tripId);
  if (!offset) return false;
  return offset.offsetX !== 0 || offset.offsetY !== 0;
}
