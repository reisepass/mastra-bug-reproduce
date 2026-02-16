import { test, expect, type Route } from '@playwright/test';
import { resetStorage } from '../__utils__/reset-storage';

/**
 * #13057 — Logs page table instability
 *
 * Reported bugs:
 *   1. After scrolling/clicking, rows show a DIFFERENT trace's data
 *   2. Ordering is inconsistent — traces not sorted by creation time
 *   3. Details pane shows a different log than the one selected
 *
 * Root cause: `useInfiniteQuery` with `refetchInterval: 3000` in use-traces.tsx.
 * Every 3 s, React Query refetches all pages. Because `staleTime: 0` and
 * `gcTime: 0`, each refetch result is treated as fresh data and **accumulated**
 * (flatMap'd) alongside previous pages. This causes duplicate rows, shifting
 * indices, and visual desync between the selected trace and the detail pane.
 *
 * Strategy: intercept the API with controlled data and observe the symptoms.
 */

// ---------------------------------------------------------------------------
// Helpers — mock trace data
// ---------------------------------------------------------------------------

function makeSpan(id: string, name: string, createdAt: string) {
  return {
    traceId: id,
    spanId: id,
    parentSpanId: null,
    name,
    scope: null,
    spanType: null,
    attributes: { status: 'success' },
    metadata: null,
    links: null,
    tags: null,
    startedAt: createdAt,
    endedAt: createdAt,
    input: null,
    output: null,
    error: null,
    createdAt,
    updatedAt: createdAt,
    isEvent: false,
    entityType: 'agent',
    entityId: 'test-agent',
    entityName: 'Test Agent',
    userId: null,
    organizationId: null,
    resourceId: null,
    runId: null,
    sessionId: null,
    threadId: null,
    requestId: null,
    environment: null,
    source: null,
    serviceName: null,
  };
}

function tracesResponse(spans: ReturnType<typeof makeSpan>[], page = 0) {
  return {
    spans,
    pagination: { page, perPage: 25, total: 5, hasMore: false },
  };
}

/** Route handler that returns TRACES for page 0 and empty for page > 0 */
function paginatedHandler(onFetch?: () => void) {
  return async (route: Route) => {
    onFetch?.();
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON?.() ?? {};
    const page = Number(url.searchParams.get('page') ?? body?.pagination?.page ?? 0);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(tracesResponse(page === 0 ? TRACES : [], page)),
    });
  };
}

const TRACES = [
  makeSpan('aaa', 'Agent Run Alpha', '2026-02-16T10:00:05Z'),
  makeSpan('bbb', 'Agent Run Bravo', '2026-02-16T10:00:04Z'),
  makeSpan('ccc', 'Agent Run Charlie', '2026-02-16T10:00:03Z'),
  makeSpan('ddd', 'Agent Run Delta', '2026-02-16T10:00:02Z'),
  makeSpan('eee', 'Agent Run Echo', '2026-02-16T10:00:01Z'),
];

/** Scoped locator: only the <li> rows inside the main content trace list. */
function traceRows(page: import('@playwright/test').Page) {
  return page.locator('main li').filter({ has: page.locator('button') });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.afterEach(async () => {
  await resetStorage();
});

test.describe('#13057 — Logs table instability', () => {
  /**
   * BUG: Rows duplicate on every refetch cycle.
   *
   * Because `useInfiniteQuery` with `refetchInterval: 3000` refetches page 0
   * and the result is flatMap'd across all accumulated pages, the list grows
   * unboundedly. After one 3-second refetch cycle the 5 traces become 10+.
   */
  test('rows duplicate after refetch — list grows unboundedly', async ({ page }) => {
    let fetchCount = 0;
    await page.route(
      '**/api/observability/traces**',
      paginatedHandler(() => fetchCount++),
    );

    await page.goto('/observability');

    const rows = traceRows(page);

    // Wait for initial render
    await expect(rows.first()).toContainText('Alpha', { timeout: 10_000 });

    // Wait for multiple refetch cycles (3 s each)
    await page.waitForTimeout(7_500);
    expect(fetchCount).toBeGreaterThanOrEqual(3);

    const rowCount = await rows.count();

    // ✅ Expected: exactly 5 rows — API always returns the same 5 traces
    // ❌ Actual:   15+ rows — each refetch cycle appends 5 duplicates
    expect(rowCount).toBe(5);
  });

  /**
   * BUG: The text content of the first row changes after refetch even though
   * the API keeps returning the same data.
   *
   * This happens because duplicated rows shift positions. Even without new
   * traces, the accumulation means "row 0" may correspond to a different
   * chunk of the duplicated list.
   */
  test('each trace appears exactly once — no duplicates', async ({ page }) => {
    let fetchCount = 0;
    await page.route(
      '**/api/observability/traces**',
      paginatedHandler(() => fetchCount++),
    );

    await page.goto('/observability');

    const rows = traceRows(page);
    await expect(rows.first()).toContainText('Alpha', { timeout: 10_000 });

    // Wait for multiple refetch cycles
    await page.waitForTimeout(7_500);
    expect(fetchCount).toBeGreaterThanOrEqual(3);

    // Count how many rows contain each trace name.
    // ✅ Expected: each trace appears exactly once
    // ❌ Actual:   each trace appears 3+ times because refetches accumulate
    const alphaRows = page.locator('main li', { hasText: 'Agent Run Alpha' });
    const bravoRows = page.locator('main li', { hasText: 'Agent Run Bravo' });
    const charlieRows = page.locator('main li', { hasText: 'Agent Run Charlie' });

    expect(await alphaRows.count()).toBe(1);
    expect(await bravoRows.count()).toBe(1);
    expect(await charlieRows.count()).toBe(1);
  });

  /**
   * BUG: Selected row highlight (bg-accent1Dark) disappears or moves
   * to a different row after refetch.
   *
   * The user clicks "Charlie" (row 2). After refetch, the accumulated list
   * has "Charlie" at MULTIPLE positions. The `isSelected` prop compares by
   * traceId which matches multiple <li> elements, or the highlighted row
   * visually shifts because the underlying array changed.
   */
  test('selected row highlight becomes unreliable after refetch', async ({ page }) => {
    await page.route('**/api/observability/traces**', paginatedHandler());

    await page.goto('/observability');

    const rows = traceRows(page);
    await expect(rows.first()).toContainText('Alpha', { timeout: 10_000 });

    // Click "Charlie" (row index 2)
    const charlie = rows.nth(2);
    await expect(charlie).toContainText('Charlie');
    await charlie.locator('button').click();

    // Wait for refetch to duplicate rows (3 s + buffer)
    await page.waitForTimeout(4_500);

    // ✅ Expected: exactly 1 highlighted row showing "Charlie"
    // ❌ Actual:   multiple highlighted rows — the traceId "ccc" now matches
    //             multiple <li> elements because the list has duplicates
    const highlighted = page.locator('main li.bg-accent1Dark');
    const highlightCount = await highlighted.count();

    expect(highlightCount).toBe(1);
  });
});
