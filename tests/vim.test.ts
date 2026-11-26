import { describe, expect, it, vi } from 'vitest';
import { ansi } from '../src/shell/ansi';
import type { SessionIO } from '../src/shell/registry';
import { VimSession, type VimSaveResult } from '../src/shell/vimSession';

function createSessionHost(cols = 80, rows = 12) {
  const writes: string[] = [];
  let exited = false;
  const io: SessionIO = {
    get cols() {
      return cols;
    },
    get rows() {
      return rows;
    },
    write(data: string) {
      writes.push(data);
    },
    exit() {
      exited = true;
    },
  };
  return {
    io,
    writes,
    isExited: () => exited,
    raw: () => writes.join(''),
    plain: () => ansi.strip(writes.join('')),
    clearCapture: () => {
      writes.length = 0;
    },
    resize: (nextCols: number, nextRows: number) => {
      cols = nextCols;
      rows = nextRows;
    },
  };
}

describe('VimSession', () => {
  it('enters alternate screen on start and exits cleanly on :q when unmodified', async () => {
    const host = createSessionHost(80, 10);
    const onSave = vi.fn(async (): Promise<VimSaveResult> => ({ ok: true }));
    const vim = new VimSession({
      filePath: '/etc/splash.d/config',
      initialContent: 'header.piece = big-text\nheader.text = SPLASH',
      onSave,
    });

    vim.start(host.io);
    expect(host.raw()).toContain('\x1b[?1049h');
    expect(host.plain()).toContain('NORMAL');
    expect(host.plain()).toContain('/etc/splash.d/config');
    expect(host.plain()).toContain('header.piece = big-text');

    host.clearCapture();
    await vim.handleData(':q\r');
    expect(host.isExited()).toBe(true);
    expect(host.raw()).toContain('\x1b[?1049l');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('supports Normal navigation (hjkl, 0, $, gg, G) and editing (x, dd, u)', async () => {
    const host = createSessionHost(80, 12);
    let saved = '';
    const vim = new VimSession({
      filePath: '/etc/splash.d/config',
      initialContent: 'line1\nline2\nline3',
      onSave: async (content) => {
        saved = content;
        return { ok: true };
      },
    });

    vim.start(host.io);
    // Jump to bottom (G), delete line3 (dd), jump to top (gg), move to end ($), delete '1' (x)
    await vim.handleData('G');
    await vim.handleData('dd');
    await vim.handleData('gg');
    await vim.handleData('$');
    await vim.handleData('x');
    await vim.handleData(':w\r');
    expect(saved).toBe('line\nline2');

    // Undo restores '1', undo again restores 'line3'
    await vim.handleData('u');
    await vim.handleData('u');
    await vim.handleData(':wq\r');
    expect(saved).toBe('line1\nline2\nline3');
    expect(host.isExited()).toBe(true);
  });

  it('supports Insert mode (i, a, I, A, o, O, Backspace merge, Enter split, CJK, Esc)', async () => {
    const host = createSessionHost(80, 12);
    let saved = '';
    const vim = new VimSession({
      filePath: '/etc/splash.d/config',
      initialContent: 'abc\ndef',
      onSave: async (content) => {
        saved = content;
        return { ok: true };
      },
    });

    vim.start(host.io);
    // Insert at line start (I)
    await vim.handleData('I');
    await vim.handleData('# ');
    await vim.handleData('\x1b');
    // Append at line end (A) with CJK and split with Enter
    await vim.handleData('A');
    await vim.handleData('中文\rnew');
    await vim.handleData('\x1b');
    // Open line below (o)
    await vim.handleData('o');
    await vim.handleData('added');
    await vim.handleData('\x1b');
    // Move to col 0 and Backspace in insert mode merges with previous line
    await vim.handleData('I');
    await vim.handleData('\x7f');
    await vim.handleData('\x1b');

    await vim.handleData('ZZ');
    expect(saved).toBe('# abc中文\nnewadded\ndef');
    expect(host.isExited()).toBe(true);
  });

  it('guards unsaved changes on :q with E37, allows :q! and ZQ, and stays open on invalid :wq', async () => {
    const host = createSessionHost(80, 12);
    const onSave = vi.fn(async (text: string): Promise<VimSaveResult> => {
      if (text.includes('BAD')) {
        return { ok: false, error: 'line 1: invalid header.piece "BAD"' };
      }
      return { ok: true };
    });

    const vim = new VimSession({
      filePath: '/etc/splash.d/config',
      initialContent: 'header.piece = big-text',
      onSave,
    });

    vim.start(host.io);
    await vim.handleData('A');
    await vim.handleData('BAD');
    await vim.handleData('\x1b');

    // :q refuses while dirty
    host.clearCapture();
    await vim.handleData(':q\r');
    expect(host.isExited()).toBe(false);
    expect(host.plain()).toContain('E37');

    // :wq refuses to exit when save validation fails
    host.clearCapture();
    await vim.handleData(':wq\r');
    expect(host.isExited()).toBe(false);
    expect(host.plain()).toContain('line 1: invalid header.piece "BAD"');

    // :q! force quits without saving
    await vim.handleData(':q!\r');
    expect(host.isExited()).toBe(true);

    // ZQ also force quits when dirty
    const host2 = createSessionHost(80, 12);
    const vim2 = new VimSession({
      filePath: '/etc/splash.d/config',
      initialContent: 'abc',
      onSave,
    });
    vim2.start(host2.io);
    await vim2.handleData('x');
    await vim2.handleData('ZQ');
    expect(host2.isExited()).toBe(true);
  });

  it('scrolls vertically on small viewports and handles resize without crashing', async () => {
    const host = createSessionHost(40, 5); // 3 content rows + status + cmdline
    const lines = Array.from({ length: 10 }, (_, i) => `row-${i + 1}`).join('\n');
    const vim = new VimSession({
      filePath: '/etc/splash.d/config',
      initialContent: lines,
      onSave: async () => ({ ok: true }),
    });

    vim.start(host.io);
    expect(host.plain()).toContain('row-1');
    expect(host.plain()).not.toContain('row-10');

    host.clearCapture();
    await vim.handleData('G');
    expect(host.plain()).toContain('row-10');

    // Tiny resize (rows = 3) must remain safe
    host.resize(20, 3);
    expect(() => vim.handleResize(20, 3)).not.toThrow();
    await vim.handleData(':q\r');
    expect(host.isExited()).toBe(true);
  });

  it('cancels Command mode cleanly on Esc and Ctrl+C, preserves dirty on failed :w, and aligns CJK cursor columns', async () => {
    const host = createSessionHost(80, 12);
    const onSave = vi.fn(async (): Promise<VimSaveResult> => ({
      ok: false,
      error: 'line 1: invalid value',
    }));
    const vim = new VimSession({
      filePath: '/etc/splash.d/config',
      initialContent: 'a中文b',
      onSave,
    });

    vim.start(host.io);

    // Move right onto '中' (gutter " 1 " = 3 cols -> 'a' is col 4, '中' is col 5),
    // then right onto '文' (col 5 + width('中') 2 = col 7)
    host.clearCapture();
    await vim.handleData('l');
    expect(host.raw()).toContain('\x1b[1;5H');

    host.clearCapture();
    await vim.handleData('l');
    expect(host.raw()).toContain('\x1b[1;7H');

    // Delete '文' with x -> 'a中b', cursor now on 'b' at col 7; move left onto '中' at col 5
    await vim.handleData('x');
    host.clearCapture();
    await vim.handleData('h');
    expect(host.raw()).toContain('\x1b[1;5H');

    // Esc cancels Command mode without invoking onSave
    host.clearCapture();
    await vim.handleData(':wq\x1b');
    expect(host.isExited()).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    expect(host.plain()).toContain('NORMAL');

    // Ctrl+C cancels Command mode without invoking onSave
    host.clearCapture();
    await vim.handleData(':q!\x03');
    expect(host.isExited()).toBe(false);
    expect(host.plain()).toContain('NORMAL');

    // Failed :w keeps dirty [+] marker and stays in Vim
    host.clearCapture();
    await vim.handleData(':w\r');
    expect(onSave).toHaveBeenCalledWith('a中b');
    expect(host.isExited()).toBe(false);
    expect(host.plain()).toContain('[+]');
    expect(host.plain()).toContain('line 1: invalid value');

    await vim.handleData(':q!\r');
    expect(host.isExited()).toBe(true);
  });
});
