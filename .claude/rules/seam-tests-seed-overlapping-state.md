---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
---
# Client/Server Seam Tests: Seed Overlapping State

When a server endpoint returns a merged/reconciled collection and a client consumes it, regression tests MUST include cases where local and server state OVERLAP. Empty-local-state tests cannot distinguish append from replace semantics - both pass, and the double-merge bug hides until production.

The same applies to ordering/window constraints: a test fixture that never exercises the constraint path (e.g. history that fits the window) cannot catch an iteration-direction bug.

## Bad

```typescript
it('saves merged facts', async () => {
  // existingFacts = [] - append and replace are indistinguishable
  // server returns ['a', 'b']; both semantics produce ['a', 'b']
})
```

## Good

```typescript
it('REPLACES facts with the server-merged set (no double-merge duplicates)', async () => {
  const existingFacts = ['a']           // seeded local state
  // server returns ['a', 'b']          // merged set, 'a' already inside
  expect(result).toEqual(['a', 'b'])    // replace ✓; append would give ['a', 'a', 'b']
})
```

Source: rule pass 2026-06-11 - fixes `fact-duplication-double-merge`, `getcontextwindow-newest-first-iteration`
