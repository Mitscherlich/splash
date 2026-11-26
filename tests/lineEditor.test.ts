import { describe, expect, it } from 'vitest';
import { LineEditor, MAX_HISTORY } from '../src/shell/lineEditor';

describe('LineEditor cursor and editing', () => {
  it('inserts at cursor and supports left/right/home/end movement', () => {
    const ed = new LineEditor();
    ed.insert('open github');
    expect(ed.buffer).toBe('open github');
    expect(ed.cursor).toBe(11);

    ed.moveLeft();
    ed.moveLeft();
    ed.insert('X');
    expect(ed.buffer).toBe('open githXub');

    ed.moveHome();
    expect(ed.cursor).toBe(0);
    ed.insert('!');
    expect(ed.buffer).toBe('!open githXub');

    ed.moveEnd();
    expect(ed.cursor).toBe(ed.buffer.length);
  });

  it('handles backspace and deleteForward across ASCII, CJK, and surrogate-pair emoji', () => {
    const ed = new LineEditor();
    ed.insert('a中🚀b');
    ed.moveLeft(); // before 'b'
    ed.backspace(); // removes '🚀' as one whole code point
    expect(ed.buffer).toBe('a中b');
    expect(ed.beforeCursor()).toBe('a中');

    ed.moveHome();
    ed.deleteForward(); // removes 'a'
    expect(ed.buffer).toBe('中b');
    ed.backspace(); // no-op at start
    expect(ed.buffer).toBe('中b');
  });

  it('supports Ctrl+U (killToStart), Ctrl+K (killToEnd), and Ctrl+W (killPrevWord)', () => {
    const ed = new LineEditor();
    ed.insert('open docs.rs tokio');
    ed.killPrevWord();
    expect(ed.buffer).toBe('open docs.rs ');

    ed.killPrevWord(); // skips trailing space, removes 'docs.rs'
    expect(ed.buffer).toBe('open ');

    ed.insert('github.com/org/repo');
    ed.moveHome();
    ed.moveRight();
    ed.moveRight();
    ed.moveRight();
    ed.moveRight();
    ed.moveRight(); // after 'open '
    ed.killToEnd();
    expect(ed.buffer).toBe('open ');

    ed.insert('abc');
    ed.killToStart();
    expect(ed.buffer).toBe('');
    expect(ed.cursor).toBe(0);
  });

  it('sanitizes newlines to single spaces on paste', () => {
    const ed = new LineEditor();
    ed.insert('open ');
    ed.paste('hello\r\nworld\nfoo');
    expect(ed.buffer).toBe('open hello world foo');
  });

  it('replaces buffer range cleanly via setBuffer and clears via reset', () => {
    const ed = new LineEditor();
    ed.setBuffer('cd 12345');
    expect(ed.buffer).toBe('cd 12345');
    expect(ed.cursor).toBe(8);

    ed.reset();
    expect(ed.buffer).toBe('');
    expect(ed.cursor).toBe(0);
  });
});

describe('LineEditor history', () => {
  it('navigates history up/down and preserves unsent draft', () => {
    const ed = new LineEditor(['ls', 'cd 42', 'open github.com']);
    ed.insert('draft cmd');

    expect(ed.historyUp()).toBe(true);
    expect(ed.buffer).toBe('open github.com');

    expect(ed.historyUp()).toBe(true);
    expect(ed.buffer).toBe('cd 42');

    expect(ed.historyUp()).toBe(true);
    expect(ed.buffer).toBe('ls');

    // Already at oldest entry
    expect(ed.historyUp()).toBe(false);
    expect(ed.buffer).toBe('ls');

    expect(ed.historyDown()).toBe(true);
    expect(ed.buffer).toBe('cd 42');

    expect(ed.historyDown()).toBe(true);
    expect(ed.buffer).toBe('open github.com');

    expect(ed.historyDown()).toBe(true);
    expect(ed.buffer).toBe('draft cmd');

    // Already at bottom
    expect(ed.historyDown()).toBe(false);
  });

  it('skips blank lines, deduplicates consecutive commands, and caps at MAX_HISTORY', () => {
    const ed = new LineEditor();
    expect(ed.recordHistory('   ')).toBe(false);
    expect(ed.recordHistory('ls')).toBe(true);
    expect(ed.recordHistory('ls')).toBe(false);
    expect(ed.recordHistory('cd 1')).toBe(true);
    expect(ed.recordHistory('ls')).toBe(true);
    expect(ed.getHistory()).toEqual(['ls', 'cd 1', 'ls']);

    const bulk = new LineEditor();
    for (let i = 0; i < MAX_HISTORY + 25; i++) {
      bulk.recordHistory(`cmd-${i}`);
    }
    const hist = bulk.getHistory();
    expect(hist.length).toBe(MAX_HISTORY);
    expect(hist[0]).toBe('cmd-25');
    expect(hist[hist.length - 1]).toBe(`cmd-${MAX_HISTORY + 24}`);
  });

  it('syncs external history updates without clobbering current input buffer', () => {
    const ed = new LineEditor(['ls']);
    ed.insert('typing...');
    ed.setHistory(['ls', 'open docs.rs']);
    expect(ed.buffer).toBe('typing...');
    expect(ed.historyUp()).toBe(true);
    expect(ed.buffer).toBe('open docs.rs');
  });
});
