export interface NoteItem {
  id: number;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface NotesState {
  nextId: number;
  items: NoteItem[];
}

export const EMPTY_NOTES_STATE: NotesState = {
  nextId: 1,
  items: [],
};

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    Number.isSafeInteger(value) &&
    value >= 1
  );
}

export function normalizeNotesState(raw: unknown): NotesState {
  if (!raw || typeof raw !== 'object') {
    return { nextId: 1, items: [] };
  }

  const obj = raw as { nextId?: unknown; items?: unknown };
  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const seenIds = new Set<number>();
  const items: NoteItem[] = [];
  let maxId = 0;

  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (!isPositiveInteger(item.id) || seenIds.has(item.id)) continue;
    if (typeof item.content !== 'string') continue;

    seenIds.add(item.id);
    if (item.id > maxId) maxId = item.id;

    const createdAt =
      typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
        ? item.createdAt
        : 0;
    const updatedAt =
      typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt)
        ? item.updatedAt
        : createdAt;

    items.push({
      id: item.id,
      content: item.content.replace(/\r\n?/g, '\n'),
      createdAt,
      updatedAt,
    });
  }

  items.sort((a, b) => a.id - b.id);

  const rawNextId = isPositiveInteger(obj.nextId) ? obj.nextId : 1;
  const nextId = Math.max(1, rawNextId, maxId + 1);

  return { nextId, items };
}
