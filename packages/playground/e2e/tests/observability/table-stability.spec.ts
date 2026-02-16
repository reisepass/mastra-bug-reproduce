import { test, expect, type Route } from '@playwright/test';
import { resetStorage } from '../__utils__/reset-storage';

/**
 * #13057 — Logs page table stability after fix
 *
 * These tests intercept the traces API with controlled mock data and
 * verify that the table remains stable across refetch cycles:
 *   - No duplicate rows after refetchInterval fires
 *   - Selected row stays highlighted correctly
 *   - Row count matches the API response
 */

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
    status: 'success',
  };
}

const TRACES = [
  makeSpan('aaa', 'Agent Run Alpha', '2026-02-16T10:00:05Z'),
  makeSpan('bbb', 'Agent Run Bravo', '2026-02-16T10:00:04Z'),
  makeSpan('ccc', 'Agent Run Charlie', '2026-02-16T10:00:03Z'),
  makeSpan('ddd', 'Agent Run Delta', '2026-02-16T10:00:02Z'),
  makeSpan('eee', 'Agent Run Echo', '2026-02-16T10:00:01Z'),
];

function tracesResponse(spans: ReturnType<typeof makeSpan>[]) {
  return {
    spans,
    pagination: { page: 0, perPage: 25, total: spans.length, hasMore: false },
  };
}

/** Route handler that always returns the same 5 traces and tracks fetch count. */
function stableHandler(onFetch?: () => void) {
  return async (route: Route) => {
    onFetch?.();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(tracesResponse(TRACES)),
    });
  };
}

/** Locator for trace rows (li elements containing a button) inside the main content area. */
function traceRows(page: import('@playwright/test').Page) {
  return page.locator('main li').filter({ has: page.locator('button') });
}

test.afterEach(async () => {
  await resetStorage();
});

test.describe('#13057 — Logs table stability (post-fix)', () => {
  test('row count remains stable after multiple refetch cycles', async ({ page }) => {
    let fetchCount = 0;
    await page.route(
      '**/api/observability/traces**',
      stableHandler(() => fetchCount++),
    );

    await page.goto('/observability');

    const rows = traceRows(page);
    await expect(rows.first()).toContainText('Alpha', { timeout: 10_000 });

    // Initial state: exactly 5 rows
    await expect(rows).toHaveCount(5);

    // Wait for multiple refetch cycles (refetchInterval is 3s)
    await page.waitForTimeout(7_500);
    expect(fetchCount).toBeGreaterThanOrEqual(3);

    // After refetches: still exactly 5 rows, no duplicates
    await expect(rows).toHaveCount(5);
  });

  test('each trace appears exactly once after refetch', async ({ page }) => {
    await page.route('**/api/observability/traces**', stableHandler());

    await page.goto('/observability');

    const rows = traceRows(page);
    await expect(rows.first()).toContainText('Alpha', { timeout: 10_000 });

    // Wait for refetch cycles
    await page.waitForTimeout(7_500);

    // Each trace name should appear exactly once
    for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']) {
      const matching = page.locator('main li', { hasText: `Agent Run ${name}` });
      await expect(matching).toHaveCount(1);
    }
  });

  test('selected row stays highlighted after refetch', async ({ page }) => {
    await page.route('**/api/observability/traces**', stableHandler());

    await page.goto('/observability');

    const rows = traceRows(page);
    await expect(rows.first()).toContainText('Alpha', { timeout: 10_000 });

    // Click "Charlie" (row index 2)
    const charlie = rows.nth(2);
    await expect(charlie).toContainText('Charlie');
    await charlie.locator('button').click();

    // Verify selection is applied
    const highlighted = page.locator('main li.bg-accent1Dark');
    await expect(highlighted).toHaveCount(1);
    await expect(highlighted).toContainText('Charlie');

    // Wait for refetch cycles
    await page.waitForTimeout(7_500);

    // After refetch: still exactly 1 highlighted row, still Charlie
    await expect(highlighted).toHaveCount(1);
    await expect(highlighted).toContainText('Charlie');
  });
});
