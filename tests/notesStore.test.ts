import { describe, expect, it } from 'vitest';
import {
  EMPTY_NOTES_STATE,
  normalizeNotesState,
} from '../src/notes/types';

describe('normalizeNotesState', () => {
  it('returns empty state with nextId=1 for null, undefined, or invalid input', () => {
    expect(EMPTY_NOTES_STATE).toEqual({ nextId: 1, items: [] });
    expect(normalizeNotesState(null)).toEqual({ nextId: 1, items: [] });
    expect(normalizeNotesState('bad')).toEqual({ nextId: 1, items: [] });
  });

  it('normalizes CRLF line endings, filters malformed or duplicate items, and enforces monotonic nextId >= maxId + 1', () => {
    const normalized = normalizeNotesState({
      nextId: 2,
      items: [
        { id: 5, content: 'line1\r\nline2', createdAt: 100, updatedAt: 200 },
        { id: 5, content: 'duplicate id', createdAt: 101, updatedAt: 201 },
        { id: 0, content: 'invalid zero', createdAt: 100, updatedAt: 100 },
        { id: -2, content: 'negative', createdAt: 100, updatedAt: 100 },
        { id: 2, content: 'older', createdAt: 50, updatedAt: 60 },
        { id: 'bad', content: 'non-number' },
      ],
    });

    expect(normalized).toEqual({
      nextId: 6,
      items: [
        { id: 2, content: 'older', createdAt: 50, updatedAt: 60 },
        { id: 5, content: 'line1\nline2', createdAt: 100, updatedAt: 200 },
      ],
    });
  });

  it('preserves higher nextId when notes were deleted so IDs are never reused', () => {
    const normalized = normalizeNotesState({
      nextId: 10,
      items: [{ id: 3, content: 'kept', createdAt: 10, updatedAt: 10 }],
    });
    expect(normalized.nextId).toBe(10);
  });
});
