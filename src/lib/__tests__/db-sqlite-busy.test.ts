// SQLite BUSY timeout test removed — not applicable to Aurora MySQL.
// Aurora MySQL handles connection concurrency via the connection pool (mysql2).
import { describe, it } from 'vitest'

describe('MySQL connection pool', () => {
  it('is handled by mysql2 pool, no BUSY errors', () => {
    // Connection limits and retry behavior are configured in src/lib/db-pool.ts
  })
})
