import { describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry } from '../src/commands';
import {
  saveNoteWithConflictPolicy,
  stripSingleTrailingNewline,
} from '../src/notes/store';
import { ansi } from '../src/shell/ansi';
import { ShellController, type TerminalIO } from '../src/shell/controller';
import type { ShellOverlayHost } from '../src/shell/registry';
import { FakeBrowserAdapter } from './fakeAdapter';

class FakeTerminal implements TerminalIO {
  cols = 100;
  rows = 24;
  writes: string[] = [];
  onData(_listener: (data: string) => void): { dispose(): void } {
    return { dispose() {} };
  }
  write(data: string): void {
    this.writes.push(data);
  }
  writeln(data: string): void {
    this.writes.push(`${data}\r\n`);
  }
  clear(): void {}
  plainOutput(): string {
    return ansi.strip(this.writes.join(''));
  }
  reset(): void {
    this.writes = [];
  }
}

async function runLine(controller: ShellController, line: string): Promise<void> {
  await controller.handleData(line);
  await controller.handleData('\r');
}

describe('note store helpers and conflict policy', () => {
  it('strips at most one trailing newline while preserving internal multi-line newlines', () => {
    expect(stripSingleTrailingNewline('hello\n')).toBe('hello');
    expect(stripSingleTrailingNewline('hello\r\n')).toBe('hello');
    expect(stripSingleTrailingNewline('a\nb\n')).toBe('a\nb');
    expect(stripSingleTrailingNewline('a\nb\n\n')).toBe('a\nb\n');
    expect(stripSingleTrailingNewline('no-newline')).toBe('no-newline');
  });

  it('read-modify-writes existing notes and mints a fresh ID instead of resurrecting a deleted ID', async () => {
    const adapter = new FakeBrowserAdapter({
      notes: {
        nextId: 3,
        items: [
          { id: 1, content: 'first', createdAt: 10, updatedAt: 10 },
          { id: 2, content: 'second', createdAt: 20, updatedAt: 20 },
        ],
      },
    });

    // Normal save preserves unrelated notes added in another tab
    const normalSave = await saveNoteWithConflictPolicy(adapter, 1, 'first-edited', 100);
    expect(normalSave).toEqual({
      note: { id: 1, content: 'first-edited', createdAt: 10, updatedAt: 100 },
      recreatedFromDeletedId: null,
    });

    // Another tab deletes note #1 and adds note #3 while #1 is open in editor
    adapter.emitExternalNotesChange({
      nextId: 4,
      items: [
        { id: 2, content: 'second', createdAt: 20, updatedAt: 20 },
        { id: 3, content: 'from-other-tab', createdAt: 30, updatedAt: 30 },
      ],
    });

    // Saving #1 must NOT resurrect #1; must allocate #4 and keep #2 and #3 intact
    const recreated = await saveNoteWithConflictPolicy(adapter, 1, 'recovered draft', 200);
    expect(recreated).toEqual({
      note: { id: 4, content: 'recovered draft', createdAt: 200, updatedAt: 200 },
      recreatedFromDeletedId: 1,
    });
    expect(adapter.notes.nextId).toBe(5);
    expect(adapter.notes.items.map((n) => n.id)).toEqual([2, 3, 4]);
  });
});

describe('note command end-to-end via ShellController', () => {
  it('supports note new, echo | note new, note ls, note rm (non-reused IDs), and note <id> read/write/pipe', async () => {
    const adapter = new FakeBrowserAdapter();
    const term = new FakeTerminal();
    const controller = new ShellController(term, adapter, createDefaultRegistry());
    await controller.start();

    // Empty ls
    term.reset();
    await runLine(controller, 'note ls');
    expect(term.plainOutput()).toContain('(no notes)');

    // note new <content>
    term.reset();
    await runLine(controller, 'note new buy coffee beans');
    expect(term.plainOutput()).toContain('created note #1');

    // echo <content> | note new
    term.reset();
    await runLine(controller, 'echo "ship splash note" | note new');
    expect(term.plainOutput()).toContain('created note #2');

    // note ls displays both in ascending id order
    term.reset();
    await runLine(controller, 'note ls');
    const lsOut = term.plainOutput();
    expect(lsOut).toContain('#1');
    expect(lsOut).toContain('buy coffee beans');
    expect(lsOut).toContain('#2');
    expect(lsOut).toContain('ship splash note');
    expect(lsOut.indexOf('#1')).toBeLessThan(lsOut.indexOf('#2'));

    // note <id> read
    term.reset();
    await runLine(controller, 'note 1');
    expect(term.plainOutput()).toContain('buy coffee beans');

    // note <id> <...content> overwrites
    term.reset();
    await runLine(controller, 'note 1 buy dark roast');
    expect(term.plainOutput()).toContain('updated note #1');
    expect(adapter.notes.items.find((n) => n.id === 1)?.content).toBe('buy dark roast');

    // echo <content> | note <id> overwrites identically
    term.reset();
    await runLine(controller, 'echo "piped replacement" | note 1');
    expect(term.plainOutput()).toContain('updated note #1');
    expect(adapter.notes.items.find((n) => n.id === 1)?.content).toBe('piped replacement');

    // Multi-line pipe (cat /etc/splash.d/config | note 2) preserves internal newlines
    await runLine(controller, 'cat /etc/splash.d/config | note 2');
    const note2 = adapter.notes.items.find((n) => n.id === 2)!;
    expect(note2.content).toContain('header.piece = big-text');
    expect(note2.content).toContain('\n');

    // note rm deletes and does NOT reuse IDs
    term.reset();
    await runLine(controller, 'note rm 2');
    expect(term.plainOutput()).toContain('removed note #2');
    await runLine(controller, 'note new third');
    expect(adapter.notes.items.map((n) => n.id)).toEqual([1, 3]);

    // Missing ID errors cleanly on read, write, and rm
    term.reset();
    await runLine(controller, 'note 99');
    expect(term.plainOutput()).toContain('not found');
    term.reset();
    await runLine(controller, 'note 99 text');
    expect(term.plainOutput()).toContain('not found');
    term.reset();
    await runLine(controller, 'note rm 99');
    expect(term.plainOutput()).toContain('not found');

    controller.dispose();
  });

  it('handles EDITOR=vim floating modal, piped-out plain read, EDITOR= override, unsupported EDITOR, and --gui/-g', async () => {
    const adapter = new FakeBrowserAdapter({
      notes: {
        nextId: 2,
        items: [{ id: 1, content: 'initial text', createdAt: 10, updatedAt: 10 }],
      },
    });
    const term = new FakeTerminal();
    const ui: ShellOverlayHost = {
      openNoteGui: vi.fn(async () => {}),
      openNoteVimEditor: vi.fn(async () => ({ savedId: 1 })),
    };

    const controller = new ShellController(term, adapter, createDefaultRegistry(), ui);
    await controller.start();

    // EDITOR=vim note 1 opens floating Vim modal
    await runLine(controller, 'EDITOR=vim note 1');
    expect(ui.openNoteVimEditor).toHaveBeenCalledWith(adapter, {
      noteId: 1,
      initialContent: 'initial text',
      locale: expect.any(String),
    });

    // export EDITOR=vim + note 1 | cat forces plain-text stdout without opening modal
    await runLine(controller, 'export EDITOR=vim');
    term.reset();
    await runLine(controller, 'note 1 | cat');
    expect(ui.openNoteVimEditor).toHaveBeenCalledTimes(1);
    expect(term.plainOutput()).toContain('initial text');

    // Inline EDITOR= overrides exported EDITOR=vim for plain read
    term.reset();
    await runLine(controller, 'EDITOR= note 1');
    expect(ui.openNoteVimEditor).toHaveBeenCalledTimes(1);
    expect(term.plainOutput()).toContain('initial text');

    // note new with no args/stdin when EDITOR=vim opens floating Vim composer
    await runLine(controller, 'note new');
    expect(ui.openNoteVimEditor).toHaveBeenCalledWith(adapter, {
      noteId: null,
      initialContent: '',
      locale: expect.any(String),
    });

    // Unsupported EDITOR errors clearly
    term.reset();
    await runLine(controller, 'EDITOR=nano note 1');
    expect(term.plainOutput()).toContain('unsupported EDITOR "nano"');

    // note --gui and note -g open Corkboard overlay and respect export LANG=zh_CN.UTF-8 / en_US.UTS-8 / C
    await runLine(controller, 'export LANG=zh_CN.UTF-8');
    await runLine(controller, 'note --gui');
    expect(ui.openNoteGui).toHaveBeenLastCalledWith(adapter, { locale: 'zh' });

    await runLine(controller, 'export LANG=en_US.UTS-8');
    await runLine(controller, 'note -g');
    expect(ui.openNoteGui).toHaveBeenLastCalledWith(adapter, { locale: 'en' });

    await runLine(controller, 'export LANG=C');
    await runLine(controller, 'note --gui');
    expect(ui.openNoteGui).toHaveBeenCalledTimes(3);

    // note --gui cannot be piped out
    term.reset();
    await runLine(controller, 'note --gui | cat');
    expect(ui.openNoteGui).toHaveBeenCalledTimes(3);
    expect(term.plainOutput()).toContain('cannot be piped');

    controller.dispose();
  });

  it('provides Tab completions for note subcommands, IDs, note rm IDs, and man/help entries', async () => {
    const adapter = new FakeBrowserAdapter({
      notes: {
        nextId: 3,
        items: [
          { id: 1, content: 'First title\nsecond line', createdAt: 10, updatedAt: 10 },
          { id: 2, content: 'Second memo', createdAt: 20, updatedAt: 20 },
        ],
      },
    });
    const registry = createDefaultRegistry();
    const noteCmd = registry.get('note');
    expect(noteCmd).toBeDefined();

    const term = new FakeTerminal();
    const controller = new ShellController(term, adapter, registry);
    await controller.start();

    // help & man include note
    term.reset();
    await runLine(controller, 'man note');
    expect(term.plainOutput()).toContain('NAME');
    expect(term.plainOutput()).toContain('note --gui');

    // Tab completion after `EDITOR=vim note ` completes note IDs and subcommands
    term.reset();
    await controller.handleData('note rm 2');
    // Test complete() directly on subcommands and rm
    const fakeCtx = {
      adapter,
      registry,
      cols: 100,
      isPipedOut: false,
      env: {},
      envStore: { getAll: () => ({}), set() {}, unset() {} },
      write() {},
      writeln() {},
      writeError() {},
      clear() {},
      async runSession() {},
    };
    const rootItems = await noteCmd!.complete!(fakeCtx, [], '');
    expect(rootItems.map((i) => i.value)).toEqual(
      expect.arrayContaining(['new', 'ls', 'rm', '--gui', '1', '2']),
    );
    expect(rootItems.find((i) => i.value === '1')?.label).toBe('First title');

    const rmItems = await noteCmd!.complete!(fakeCtx, ['rm'], '2');
    expect(rmItems).toEqual([{ value: '2', label: 'Second memo' }]);

    controller.dispose();
  });
});
