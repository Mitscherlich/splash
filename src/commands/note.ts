import {
  createNoteInAdapter,
  formatNoteSummary,
  formatNoteTimestamp,
  removeNotesInAdapter,
  stripSingleTrailingNewline,
  updateNoteInAdapter,
} from '../notes/store';
import { ansi } from '../shell/ansi';
import type { CommandDefinition, CompletionItem } from '../shell/registry';
import { padRightToWidth, stringDisplayWidth, truncateToWidth } from '../shell/width';

const POSITIVE_INT_RE = /^[1-9]\d*$/;
const SUBCOMMANDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'new', label: 'Create a new note' },
  { value: 'ls', label: 'List all notes and IDs' },
  { value: 'rm', label: 'Delete one or more notes by ID' },
  { value: '--gui', label: 'Open ASCII corkboard overlay' },
];

function parsePositiveId(token: string): number | null {
  if (!POSITIVE_INT_RE.test(token)) return null;
  const num = Number(token);
  return Number.isSafeInteger(num) && num >= 1 ? num : null;
}

const NOTE_USAGE =
  'usage: note <new <content> | ls | rm <id...> | <id> [...content] | --gui>';

export const noteCommand: CommandDefinition = {
  name: 'note',
  summary: 'Create, list, read, edit, and manage local notes (CLI & ASCII GUI)',
  usage: 'note <new <content> | ls | rm <id...> | <id> [...content] | --gui>',
  manual: {
    description:
      'Manages persistent local notes synced across open Splash tabs. Supports quick one-line capture, shell pipelines (`echo ... | note <id>`), floating Vim editing when `EDITOR=vim`, and an ASCII skeuomorphic pinboard overlay (`note --gui`).',
    options: [
      { flag: 'new <content>', description: 'Create a new note from arguments or piped stdin.' },
      { flag: 'ls', description: 'List all notes in ascending ID order with summaries.' },
      { flag: 'rm <id...>', description: 'Delete specified note(s) without reusing IDs.' },
      {
        flag: '<id> [...content]',
        description:
          'Overwrite note <id> when arguments or piped stdin are supplied; otherwise print content (or open floating Vim when EDITOR=vim).',
      },
      {
        flag: '--gui, -g',
        description:
          'Open the ASCII corkboard floating overlay with create, delete, and Vim editing.',
      },
    ],
    examples: [
      'note new Buy coffee beans',
      'note ls',
      'note 1',
      'note 1 Updated reminder text',
      'echo "Updated from pipe" | note 1',
      'EDITOR=vim note 1',
      'note 1 | cat',
      'note rm 1',
      'note --gui',
    ],
    notes: [
      'When `EDITOR=vim` is set persistently (via `export` or `/etc/splash.d/config`), use `EDITOR= note <id>` or `note <id> | cat` to read plain text.',
      'Press Tab after `note ` or `note rm ` to complete subcommands and existing note IDs.',
    ],
  },

  async execute(ctx, args) {
    if (args.length === 0) {
      ctx.writeln(NOTE_USAGE);
      return;
    }

    const sub = args[0]!;

    // 1. note --gui / note -g
    if (sub === '--gui' || sub === '-g') {
      if (args.length > 1) {
        ctx.writeError('usage: note --gui');
        return;
      }
      if (ctx.isPipedOut) {
        ctx.writeError('note: --gui interactive overlay cannot be piped');
        return;
      }
      if (!ctx.ui) {
        ctx.writeError('note: GUI overlay is unavailable in this environment');
        return;
      }
      await ctx.ui.openNoteGui(ctx.adapter);
      return;
    }

    // 2. note new [...content]
    if (sub === 'new') {
      const rest = args.slice(1);
      if (rest.length > 0) {
        const created = await createNoteInAdapter(ctx.adapter, rest.join(' '));
        ctx.writeln(ansi.active(`created note #${created.id}`));
        return;
      }
      if (ctx.stdin !== undefined) {
        const created = await createNoteInAdapter(
          ctx.adapter,
          stripSingleTrailingNewline(ctx.stdin),
        );
        ctx.writeln(ansi.active(`created note #${created.id}`));
        return;
      }

      const editor = (ctx.env.EDITOR ?? '').trim();
      if (!ctx.isPipedOut && editor === 'vim') {
        if (!ctx.ui) {
          ctx.writeError('note: GUI editor is unavailable in this environment');
          return;
        }
        const res = await ctx.ui.openNoteVimEditor(ctx.adapter, {
          noteId: null,
          initialContent: '',
        });
        if (res.savedId !== null) {
          ctx.writeln(ansi.active(`created note #${res.savedId}`));
        }
        return;
      }

      ctx.writeError('usage: note new <content>');
      return;
    }

    // 3. note ls
    if (sub === 'ls') {
      if (args.length > 1) {
        ctx.writeError('usage: note ls');
        return;
      }
      const state = await ctx.adapter.loadNotes();
      if (state.items.length === 0) {
        if (!ctx.isPipedOut) {
          ctx.writeln(ansi.muted('(no notes)'));
        }
        return;
      }

      const idWidth = Math.max(
        2,
        ...state.items.map((item) => `#${item.id}`.length),
      );
      const now = Date.now();
      for (const item of state.items) {
        const idCol = `#${item.id}`.padEnd(idWidth, ' ');
        const summary = formatNoteSummary(item.content);
        if (ctx.isPipedOut) {
          ctx.writeln(`${idCol}  ${summary}`);
          continue;
        }

        const timeLabel = formatNoteTimestamp(item.updatedAt, now);
        const timeWidth = stringDisplayWidth(timeLabel);
        const showTime = timeLabel.length > 0 && ctx.cols >= idWidth + timeWidth + 14;
        const summaryBudget = Math.max(
          8,
          ctx.cols - idWidth - 2 - (showTime ? timeWidth + 2 : 0),
        );
        const clippedSummary = truncateToWidth(summary, summaryBudget);
        if (showTime) {
          const paddedSummary = padRightToWidth(clippedSummary, summaryBudget);
          ctx.writeln(
            `${ansi.accent(idCol)}  ${paddedSummary}  ${ansi.muted(timeLabel)}`,
          );
        } else {
          ctx.writeln(`${ansi.accent(idCol)}  ${clippedSummary}`);
        }
      }
      return;
    }

    // 4. note rm <id...>
    if (sub === 'rm') {
      const idTokens = args.slice(1);
      if (idTokens.length === 0) {
        ctx.writeError('usage: note rm <id...>');
        return;
      }
      const ids: number[] = [];
      for (const token of idTokens) {
        const parsedId = parsePositiveId(token);
        if (parsedId === null) {
          ctx.writeError(`note: invalid note id "${token}"`);
          return;
        }
        ids.push(parsedId);
      }

      const result = await removeNotesInAdapter(ctx.adapter, ids);
      if (!result.ok) {
        ctx.writeError(`note: #${result.missingId} not found`);
        return;
      }
      for (const id of result.removedIds) {
        ctx.writeln(ansi.active(`removed note #${id}`));
      }
      return;
    }

    // 5. note <id> [...content]
    const targetId = parsePositiveId(sub);
    if (targetId === null) {
      ctx.writeError(`note: unknown subcommand "${sub}" (try: help note)`);
      return;
    }

    const trailingContent = args.slice(1);
    const hasWriteArgs = trailingContent.length > 0;
    const hasPipedInput = ctx.stdin !== undefined;

    if (hasWriteArgs || hasPipedInput) {
      const nextContent = hasWriteArgs
        ? trailingContent.join(' ')
        : stripSingleTrailingNewline(ctx.stdin!);
      const updated = await updateNoteInAdapter(ctx.adapter, targetId, nextContent);
      if (!updated) {
        ctx.writeError(`note: #${targetId} not found`);
        return;
      }
      ctx.writeln(ansi.active(`updated note #${targetId}`));
      return;
    }

    // Read or Edit mode
    const state = await ctx.adapter.loadNotes();
    const note = state.items.find((item) => item.id === targetId);
    if (!note) {
      ctx.writeError(`note: #${targetId} not found`);
      return;
    }

    if (ctx.isPipedOut) {
      ctx.writeln(note.content);
      return;
    }

    const editor = (ctx.env.EDITOR ?? '').trim();
    if (editor === '') {
      for (const line of note.content.split('\n')) {
        ctx.writeln(line);
      }
      return;
    }

    if (editor === 'vim') {
      if (!ctx.ui) {
        ctx.writeError('note: GUI editor is unavailable in this environment');
        return;
      }
      await ctx.ui.openNoteVimEditor(ctx.adapter, {
        noteId: note.id,
        initialContent: note.content,
      });
      return;
    }

    ctx.writeError(`note: unsupported EDITOR "${editor}" (supported: vim)`);
  },

  async complete(ctx, args, currentToken): Promise<CompletionItem[]> {
    const state = await ctx.adapter.loadNotes();
    const noteItems: CompletionItem[] = state.items.map((item) => ({
      value: String(item.id),
      label: formatNoteSummary(item.content),
    }));

    if (args.length === 0) {
      const all: CompletionItem[] = [...SUBCOMMANDS, ...noteItems];
      return all.filter((item) => item.value.startsWith(currentToken));
    }

    if (args[0] === 'rm') {
      const alreadyListed = new Set(args.slice(1));
      return noteItems.filter(
        (item) =>
          !alreadyListed.has(item.value) &&
          item.value.startsWith(currentToken),
      );
    }

    return [];
  },
};
