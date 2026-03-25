import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Survive Next.js HMR in dev mode — reuse pool across module re-evaluations
const globalForDb = globalThis as unknown as { pgPool?: Pool }

function getPool() {
  if (globalForDb.pgPool) return globalForDb.pgPool

  const isNeon = process.env.DATABASE_URL?.includes('neon.tech')

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: isNeon ? 3 : 10,
    idleTimeoutMillis: isNeon ? 10000 : 30000,
    connectionTimeoutMillis: 5000,
  })

  pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err)
  })

  globalForDb.pgPool = pool
  return pool
}

const pool = getPool()

export const db = drizzle(pool, { schema });

// Export pool for direct SQL when needed
export { pool };

// Re-export schema
export * from './schema'

// Re-export search functions
export { searchVideos, getVideoStats, getDistinctChannels, DEFAULT_PAGE_SIZE, type VideoListItem, type PaginatedResult, type PaginationCursor } from './search'
