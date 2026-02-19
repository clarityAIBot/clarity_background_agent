import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Export the type of our database instance
export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

// Hyperdrive binding type
interface Hyperdrive {
    connectionString: string;
}

/**
 * Creates a new database connection for each request.
 * In Cloudflare Workers, you should NOT use a global connection pool.
 * Each request needs its own connection via Hyperdrive.
 */
export function getDb(env: { HYPERDRIVE: Hyperdrive }): DrizzleDb {
    // Create a new postgres.js client per request
    const sql = postgres(env.HYPERDRIVE.connectionString, {
        // Limit connections per Worker request (Workers have limits on concurrent external connections)
        max: 5,

    });

    return drizzle(sql, { schema });
}
