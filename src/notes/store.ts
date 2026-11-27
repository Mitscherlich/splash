import type { BrowserAdapter } from '../adapter/types';
import type { SupportedLocale } from '../i18n/locale';
import { sanitizeTerminalText } from '../shell/width';
import { normalizeNotesState, type NoteItem } from './types';

export function stripSingleTrailingNewline(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  return normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
}

export function formatNoteSummary(content: string): string {
  const firstLine = content.replace(/\r\n?/g, '\n').split('\n')[0] ?? '';
  const cleaned = sanitizeTerminalText(firstLine).trim();
  return cleaned.length > 0 ? cleaned : '(empty)';
}

export function formatNoteTimestamp(
  ts: number,
  now = Date.now(),
  locale: SupportedLocale = 'en',
): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const date = new Date(ts);
  const current = new Date(now);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');

  const sameYear = date.getFullYear() === current.getFullYear();
  const sameMonth = sameYear && date.getMonth() === current.getMonth();
  if (sameMonth && date.getDate() === current.getDate()) {
    return locale === 'zh' ? `今天 ${hh}:${mm}` : `Today ${hh}:${mm}`;
  }

  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return locale === 'zh' ? `昨天 ${hh}:${mm}` : `Yesterday ${hh}:${mm}`;
  }

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day} ${hh}:${mm}`;
}

export async function createNoteInAdapter(
  adapter: BrowserAdapter,
  content: string,
  now = Date.now(),
): Promise<NoteItem> {
  const current = normalizeNotesState(await adapter.loadNotes());
  const normalizedContent = content.replace(/\r\n?/g, '\n');
  const note: NoteItem = {
    id: current.nextId,
    content: normalizedContent,
    createdAt: now,
    updatedAt: now,
  };
  await adapter.saveNotes({
    nextId: current.nextId + 1,
    items: [...current.items, note],
  });
  return note;
}

export async function updateNoteInAdapter(
  adapter: BrowserAdapter,
  id: number,
  content: string,
  now = Date.now(),
): Promise<NoteItem | null> {
  const current = normalizeNotesState(await adapter.loadNotes());
  const index = current.items.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }

  const existing = current.items[index]!;
  const updated: NoteItem = {
    ...existing,
    content: content.replace(/\r\n?/g, '\n'),
    updatedAt: now,
  };
  const nextItems = [...current.items];
  nextItems[index] = updated;

  await adapter.saveNotes({
    nextId: current.nextId,
    items: nextItems,
  });
  return updated;
}

export type RemoveNotesResult =
  | { ok: true; removedIds: number[] }
  | { ok: false; missingId: number };

export async function removeNotesInAdapter(
  adapter: BrowserAdapter,
  ids: number[],
): Promise<RemoveNotesResult> {
  const current = normalizeNotesState(await adapter.loadNotes());
  const uniqueIds = Array.from(new Set(ids));
  const existingIds = new Set(current.items.map((item) => item.id));

  for (const id of uniqueIds) {
    if (!existingIds.has(id)) {
      return { ok: false, missingId: id };
    }
  }

  const toDelete = new Set(uniqueIds);
  const remaining = current.items.filter((item) => !toDelete.has(item.id));
  await adapter.saveNotes({
    nextId: current.nextId,
    items: remaining,
  });

  return { ok: true, removedIds: uniqueIds };
}

export interface SaveWithConflictResult {
  note: NoteItem;
  recreatedFromDeletedId: number | null;
}

export async function saveNoteWithConflictPolicy(
  adapter: BrowserAdapter,
  targetId: number | null,
  content: string,
  now = Date.now(),
): Promise<SaveWithConflictResult> {
  const current = normalizeNotesState(await adapter.loadNotes());
  const normalizedContent = content.replace(/\r\n?/g, '\n');

  if (targetId !== null) {
    const idx = current.items.findIndex((item) => item.id === targetId);
    if (idx !== -1) {
      const existing = current.items[idx]!;
      const updated: NoteItem = {
        ...existing,
        content: normalizedContent,
        updatedAt: now,
      };
      const nextItems = [...current.items];
      nextItems[idx] = updated;
      await adapter.saveNotes({
        nextId: current.nextId,
        items: nextItems,
      });
      return { note: updated, recreatedFromDeletedId: null };
    }
  }

  // Either creating a new note (targetId === null) or targetId was deleted in another tab:
  // allocate a fresh monotonic ID and never resurrect a deleted ID.
  const created: NoteItem = {
    id: current.nextId,
    content: normalizedContent,
    createdAt: now,
    updatedAt: now,
  };
  await adapter.saveNotes({
    nextId: current.nextId + 1,
    items: [...current.items, created],
  });
  return {
    note: created,
    recreatedFromDeletedId: targetId,
  };
}
