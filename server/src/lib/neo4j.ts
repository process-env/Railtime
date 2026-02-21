import neo4j, { type Driver, type Session } from 'neo4j-driver';

let driver: Driver | null = null;

/**
 * Returns the Neo4j driver singleton.
 * Creates the driver on first call. Returns null if NEO4J_URI is not set
 * (graceful degradation — the app works without Neo4j, just without
 * graph-powered features).
 */
export function getDriver(): Driver | null {
  if (driver) return driver;

  try {
    const uri = process.env.NEO4J_URI;
    if (!uri) return null;

    const user = process.env.NEO4J_USER ?? 'neo4j';
    const password = process.env.NEO4J_PASSWORD ?? '';

    driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 10_000,
      connectionTimeout: 5_000,
    });

    return driver;
  } catch {
    return null;
  }
}

/**
 * Returns a new Neo4j session. Caller is responsible for closing it.
 * Defaults to the 'neo4j' database. Returns null if the driver is
 * unavailable.
 */
export function getSession(database = 'neo4j'): Session | null {
  const d = getDriver();
  if (!d) return null;

  return d.session({ database });
}

/**
 * Runs a callback with an auto-closing session. The session is closed
 * in a finally block regardless of success or failure.
 * Returns null if the driver is unavailable.
 */
export async function withSession<T>(
  callback: (session: Session) => Promise<T>,
  database = 'neo4j',
): Promise<T | null> {
  const session = getSession(database);
  if (!session) return null;

  try {
    return await callback(session);
  } finally {
    await session.close();
  }
}

/**
 * Checks that Neo4j is reachable and logs the result.
 * Returns true if connectivity is verified, false otherwise.
 */
export async function verifyConnectivity(): Promise<boolean> {
  const d = getDriver();
  if (!d) {
    console.warn('[neo4j] Driver not initialised — NEO4J_URI may be unset');
    return false;
  }

  try {
    await d.verifyConnectivity();
    console.log('[neo4j] Connection verified');
    return true;
  } catch (err) {
    console.error('[neo4j] Connectivity check failed:', err);
    return false;
  }
}

/**
 * Gracefully closes the driver and resets the singleton.
 * Safe to call multiple times.
 */
export async function closeDriver(): Promise<void> {
  if (!driver) return;

  try {
    await driver.close();
  } finally {
    driver = null;
  }
}
