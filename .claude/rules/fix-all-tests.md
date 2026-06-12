---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
---
# Fix All Failing Tests

Fix ALL failing tests before completing a story, even pre-existing failures unrelated to the current changes.

When a test fails in the full suite but passes in isolation, check vitest parallelism FIRST: it may be racing another test file's database setup in a parallel worker. If the test uses `setupTestDb()`, add it to the sequential 'db' project in vitest.config.ts and exclude it from the parallel project (see `db-tests-sequential-project` rule).

If tests outside your changes are failing, fix them as part of the current work. Never dismiss test failures as "unrelated to this story."
