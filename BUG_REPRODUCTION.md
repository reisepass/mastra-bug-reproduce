# Bug Reproduction: #13057 — Logs page table instability

## Issue

https://github.com/mastra-ai/mastra/issues/13057

**The table in the Logs page is unstable after a few clicks.**

## Expected vs Actual Behavior

| | Expected | Actual |
|---|---|---|
| **Row count** | 5 rows (API returns 5 traces) | 15+ rows — grows by 5 every 3 seconds |
| **Duplicates** | Each trace appears once | Each trace duplicated 3-4× after ~10 seconds |
| **Selection** | 1 highlighted row after click | Multiple highlighted rows (duplicate traceIds) |
| **Details pane** | Shows selected trace | Can show wrong trace due to index shifting |

## Root Cause

`packages/playground/src/domains/observability/hooks/use-traces.tsx` combines `useInfiniteQuery` with `refetchInterval: 3000`. Every 3 seconds React Query refetches page 0. Because `staleTime: 0` and `gcTime: 0`, each refetch result is **appended** as a new page in the infinite query's `pages` array. The `select: data => data.pages.flatMap(page => page)` then flattens all accumulated pages, causing the list to grow unboundedly with duplicate entries.

## Steps to Reproduce

```bash
# 1. Clone and set up the monorepo
git clone git@github.com:reisepass/mastra-bug-reproduce.git
cd mastra-bug-reproduce
git checkout 13057-Logs-page-table-instability
pnpm run setup

# 2. Run the failing E2E tests
cd packages/playground
pnpm test:e2e -- observability/table-instability.spec.ts
```

All 3 tests will **FAIL**, demonstrating the bug:

```
FAIL: rows duplicate after refetch — list grows unboundedly
  Expected: 5
  Received: 15

FAIL: each trace appears exactly once — no duplicates
  Expected: 1
  Received: 4

FAIL: selected row highlight becomes unreliable after refetch
  Expected: 1
  Received: 3
```

## What the Tests Do

The tests use Playwright's `page.route()` to intercept the `/api/observability/traces` endpoint and return controlled mock data (5 traces, always the same). They then wait for `refetchInterval` to fire and assert the symptoms:

1. **`rows duplicate after refetch`** — After 7.5 seconds (2+ refetch cycles), asserts there should be exactly 5 rows. Fails with 15 because each cycle appends 5 duplicates.

2. **`each trace appears exactly once`** — Counts how many `<li>` elements contain "Agent Run Alpha". Should be 1, but is 4 due to accumulation.

3. **`selected row highlight becomes unreliable`** — Clicks a trace, waits for refetch. The `isSelected` check (`selectedTraceId === trace.traceId`) matches multiple `<li>` elements because the same traceId appears in multiple duplicate rows.

## Affected Files

- **Bug location**: `packages/playground/src/domains/observability/hooks/use-traces.tsx` (line 57: `refetchInterval: 3000`)
- **Test file**: `packages/playground/e2e/tests/observability/table-instability.spec.ts`

## Environment

- Node: v24.13.0
- pnpm: 10.29.3
- OS: macOS (Darwin arm64)
- Playwright: @playwright/test ^1.56.0
