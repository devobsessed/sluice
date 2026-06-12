# Real-DB Test Files Join the Sequential 'db' Project

Any test file that uses `setupTestDb()` (the real `goldminer_test` Postgres database) MUST be added to the `db` project's `include` list in `vitest.config.ts` AND excluded from the `unit` project.

`setupTestDb()` TRUNCATEs all tables before each test. Vitest runs test files in parallel workers by default, so a parallel worker's `beforeEach` wipes another file's rows mid-test. This manifests as flaky concurrency/race tests that pass in isolation and fail intermittently in the full suite.

## Bad

```typescript
// new-feature.test.ts uses setupTestDb() but is not in the db project
// → runs in a parallel worker, truncates tables under other DB tests
```

## Good

```typescript
// vitest.config.ts — add the file to BOTH lists:
// db project include:    'src/lib/foo/__tests__/new-feature.test.ts'
// unit project exclude:  'src/lib/foo/__tests__/new-feature.test.ts'
```

Source: route.race.test.ts A1 flake (expected 1 better-auth call, got 2) - dedupe cache row wiped mid-race by a parallel worker's truncation. Fixed 2026-06-11 in cycle 44.
