import { describe, it, expect } from 'vitest';

/**
 * Tests for the pure logic extracted from useWorkflowRuns hook:
 * - getNextPageParam: determines if there's another page to fetch
 * - select: flattens pages, deduplicates by runId
 */

const PER_PAGE = 20;

// Reproduce the getNextPageParam logic from use-workflow-runs.ts
function getNextPageParam(
  lastPage: { runs: Array<{ runId: string }> },
  _allPages: unknown,
  lastPageParam: number,
) {
  if (lastPage.runs.length < PER_PAGE) {
    return undefined;
  }
  return lastPageParam + 1;
}

// Reproduce the select logic from use-workflow-runs.ts
function selectRuns(data: { pages: Array<{ runs: Array<{ runId: string }> }> }) {
  const seen = new Set<string>();
  return data.pages.flatMap(page => page.runs).filter(run => {
    if (seen.has(run.runId)) return false;
    seen.add(run.runId);
    return true;
  });
}

function makeRun(runId: string, name = `Run ${runId}`) {
  return { runId, workflowName: name, createdAt: new Date() };
}

describe('useWorkflowRuns logic', () => {
  describe('getNextPageParam', () => {
    it('returns next page when page is full', () => {
      const fullPage = { runs: Array.from({ length: PER_PAGE }, (_, i) => makeRun(`run-${i}`)) };
      expect(getNextPageParam(fullPage, [], 0)).toBe(1);
    });

    it('returns undefined when page is not full', () => {
      const partialPage = { runs: [makeRun('run-1'), makeRun('run-2')] };
      expect(getNextPageParam(partialPage, [], 0)).toBeUndefined();
    });

    it('returns undefined when page is empty', () => {
      expect(getNextPageParam({ runs: [] }, [], 0)).toBeUndefined();
    });

    it('increments from the current page param', () => {
      const fullPage = { runs: Array.from({ length: PER_PAGE }, (_, i) => makeRun(`run-${i}`)) };
      expect(getNextPageParam(fullPage, [], 3)).toBe(4);
    });
  });

  describe('select (deduplication)', () => {
    it('flattens a single page of runs', () => {
      const data = {
        pages: [{ runs: [makeRun('aaa'), makeRun('bbb'), makeRun('ccc')] }],
      };
      const result = selectRuns(data);
      expect(result).toHaveLength(3);
      expect(result.map(r => r.runId)).toEqual(['aaa', 'bbb', 'ccc']);
    });

    it('flattens multiple pages preserving order', () => {
      const data = {
        pages: [{ runs: [makeRun('aaa'), makeRun('bbb')] }, { runs: [makeRun('ccc'), makeRun('ddd')] }],
      };
      const result = selectRuns(data);
      expect(result).toHaveLength(4);
      expect(result.map(r => r.runId)).toEqual(['aaa', 'bbb', 'ccc', 'ddd']);
    });

    it('removes duplicates that appear across pages', () => {
      const data = {
        pages: [
          { runs: [makeRun('aaa'), makeRun('bbb'), makeRun('ccc')] },
          { runs: [makeRun('bbb'), makeRun('ccc'), makeRun('ddd')] },
        ],
      };
      const result = selectRuns(data);
      expect(result).toHaveLength(4);
      expect(result.map(r => r.runId)).toEqual(['aaa', 'bbb', 'ccc', 'ddd']);
    });

    it('keeps first occurrence when same runId appears on multiple pages', () => {
      const data = {
        pages: [
          { runs: [{ runId: 'aaa', workflowName: 'First' } as any] },
          { runs: [{ runId: 'aaa', workflowName: 'Stale' } as any] },
        ],
      };
      const result = selectRuns(data);
      expect(result).toHaveLength(1);
      expect(result[0].workflowName).toBe('First');
    });

    it('handles empty pages', () => {
      const data = {
        pages: [{ runs: [makeRun('aaa')] }, { runs: [] }, { runs: [makeRun('bbb')] }],
      };
      const result = selectRuns(data);
      expect(result).toHaveLength(2);
    });

    it('handles completely empty data', () => {
      const data = { pages: [] as Array<{ runs: Array<{ runId: string }> }> };
      const result = selectRuns(data);
      expect(result).toHaveLength(0);
    });

    it('removes all duplicates when all pages are identical', () => {
      const page = { runs: [makeRun('aaa'), makeRun('bbb')] };
      const data = { pages: [page, page, page, page] };
      const result = selectRuns(data);
      expect(result).toHaveLength(2);
      expect(result.map(r => r.runId)).toEqual(['aaa', 'bbb']);
    });
  });
});
