import { describe, it, expect } from 'vitest';

/**
 * Tests for the pure logic extracted from useTraces hook:
 * - getNextPageParam: determines if there's another page to fetch
 * - select: flattens pages, deduplicates by traceId
 */

// Reproduce the getNextPageParam logic from use-traces.tsx
function getNextPageParam(
  lastPage: { pagination?: { hasMore?: boolean } } | undefined,
  _allPages: unknown,
  lastPageParam: number,
) {
  if (lastPage?.pagination?.hasMore) {
    return lastPageParam + 1;
  }
  return undefined;
}

// Reproduce the select logic from use-traces.tsx
function selectTraces(data: { pages: Array<{ spans?: Array<{ traceId: string }> }> }) {
  const seen = new Set<string>();
  return data.pages
    .flatMap(page => page.spans ?? [])
    .filter(span => {
      if (seen.has(span.traceId)) return false;
      seen.add(span.traceId);
      return true;
    });
}

function makeSpan(traceId: string, name = `Trace ${traceId}`) {
  return { traceId, name };
}

describe('useTraces logic', () => {
  describe('getNextPageParam', () => {
    it('returns next page number when hasMore is true', () => {
      const result = getNextPageParam({ pagination: { hasMore: true } }, [], 0);
      expect(result).toBe(1);
    });

    it('returns undefined when hasMore is false', () => {
      const result = getNextPageParam({ pagination: { hasMore: false } }, [], 2);
      expect(result).toBeUndefined();
    });

    it('returns undefined when pagination is missing', () => {
      const result = getNextPageParam({}, [], 0);
      expect(result).toBeUndefined();
    });

    it('returns undefined when lastPage is undefined', () => {
      const result = getNextPageParam(undefined, [], 0);
      expect(result).toBeUndefined();
    });

    it('increments from the current page param', () => {
      expect(getNextPageParam({ pagination: { hasMore: true } }, [], 5)).toBe(6);
    });
  });

  describe('select (deduplication)', () => {
    it('flattens a single page of spans', () => {
      const data = {
        pages: [{ spans: [makeSpan('aaa'), makeSpan('bbb'), makeSpan('ccc')] }],
      };
      const result = selectTraces(data);
      expect(result).toHaveLength(3);
      expect(result.map(s => s.traceId)).toEqual(['aaa', 'bbb', 'ccc']);
    });

    it('flattens multiple pages preserving order', () => {
      const data = {
        pages: [{ spans: [makeSpan('aaa'), makeSpan('bbb')] }, { spans: [makeSpan('ccc'), makeSpan('ddd')] }],
      };
      const result = selectTraces(data);
      expect(result).toHaveLength(4);
      expect(result.map(s => s.traceId)).toEqual(['aaa', 'bbb', 'ccc', 'ddd']);
    });

    it('removes duplicates that appear across pages (offset pagination drift)', () => {
      // Simulates: page 0 had [aaa, bbb, ccc], new data arrived,
      // page 1 now starts with bbb and ccc again due to offset shift
      const data = {
        pages: [
          { spans: [makeSpan('aaa'), makeSpan('bbb'), makeSpan('ccc')] },
          { spans: [makeSpan('bbb'), makeSpan('ccc'), makeSpan('ddd')] },
        ],
      };
      const result = selectTraces(data);
      expect(result).toHaveLength(4);
      expect(result.map(s => s.traceId)).toEqual(['aaa', 'bbb', 'ccc', 'ddd']);
    });

    it('keeps first occurrence when same traceId appears on multiple pages', () => {
      const data = {
        pages: [{ spans: [makeSpan('aaa', 'First Alpha')] }, { spans: [makeSpan('aaa', 'Stale Alpha')] }],
      };
      const result = selectTraces(data);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('First Alpha');
    });

    it('handles empty pages gracefully', () => {
      const data = {
        pages: [{ spans: [makeSpan('aaa')] }, { spans: [] }, { spans: [makeSpan('bbb')] }],
      };
      const result = selectTraces(data);
      expect(result).toHaveLength(2);
    });

    it('handles pages with undefined spans', () => {
      const data = {
        pages: [
          { spans: [makeSpan('aaa')] },
          { spans: undefined as unknown as Array<{ traceId: string }> },
          { spans: [makeSpan('bbb')] },
        ],
      };
      const result = selectTraces(data);
      expect(result).toHaveLength(2);
    });

    it('handles completely empty data', () => {
      const data = { pages: [] };
      const result = selectTraces(data);
      expect(result).toHaveLength(0);
    });

    it('removes all duplicates in a worst-case scenario (all pages identical)', () => {
      const page = { spans: [makeSpan('aaa'), makeSpan('bbb'), makeSpan('ccc')] };
      const data = { pages: [page, page, page] };
      const result = selectTraces(data);
      expect(result).toHaveLength(3);
      expect(result.map(s => s.traceId)).toEqual(['aaa', 'bbb', 'ccc']);
    });
  });
});
