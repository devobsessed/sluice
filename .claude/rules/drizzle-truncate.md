---
paths:
  - "src/lib/db/__tests__/**"
---
# Use Drizzle for TRUNCATE in Tests

Use `db.execute(sql`TRUNCATE ...`)` for database cleanup in tests, not `pool.query()`.

Drizzle's `db.execute()` and `pool.query()` use different connection management paths. Mixing them causes FK violations because operations may run on different connections with different transaction states.

## Bad

```typescript
await pool.query('TRUNCATE videos CASCADE')
```

## Good

```typescript
await db.execute(sql`TRUNCATE videos CASCADE`)
```

**ALSO:** any test file that uses `setupTestDb()` must join the sequential 'db' project in vitest.config.ts AND be excluded from the parallel 'unit' project - see the `db-tests-sequential-project` rule. Parallel workers truncating the shared test DB race each other mid-test.
