import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../src/commands';
import { ansi } from '../src/shell/ansi';
import { ShellController, type TerminalIO } from '../src/shell/controller';
import { FakeBrowserAdapter } from './fakeAdapter';

class FakeTerminal implements TerminalIO {
  cols: number;
  writes: string[] = [];
  clears = 0;
  private listeners = new Set<(data: string) => void>();

  constructor(cols = 80) {
    this.cols = cols;
  }

  write(data: string): void {
    this.writes.push(data);
  }

  writeln(data: string): void {
    this.writes.push(`${data}\r\n`);
  }

  clear(): void {
    this.clears += 1;
  }

  onData(listener: (data: string) => void): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  plainOutput(): string {
    return ansi.strip(this.writes.join(''));
  }

  rawOutput(): string {
    return this.writes.join('');
  }

  resetCapture(): void {
    this.writes = [];
  }
}

describe('ShellController end-to-end', () => {
  it('prints clean prompt on start and executes ls, cd, open, and unknown command', async () => {
    const adapter = new FakeBrowserAdapter({
      currentWindowId: 1,
      currentTabId: 1001,
      tabs: [
        { id: 1001, windowId: 1, index: 0, active: true, title: 'splash', url: 'chrome://newtab' },
        { id: 1002, windowId: 1, index: 1, active: false, title: 'GitHub', url: 'https://github.com' },
      ],
    });
    const term = new FakeTerminal(100);
    const controller = new ShellController(term, adapter, createDefaultRegistry());

    await controller.start();
    expect(term.plainOutput()).toBe('$ ');

    term.resetCapture();
    await controller.handleData('ls');
    await controller.handleData('\r');
    const lsOut = term.plainOutput();
    expect(lsOut).not.toContain('1001');
    expect(lsOut).toContain('1002');
    expect(lsOut).toContain('GitHub');

    term.resetCapture();
    await controller.handleData('ls -a');
    await controller.handleData('\r');
    const lsAllOut = term.plainOutput();
    expect(lsAllOut).toContain('1001');
    expect(lsAllOut).toContain('1002');

    term.resetCapture();
    await controller.handleData('cd 1002');
    await controller.handleData('\r');
    expect(adapter.activatedTabIds).toEqual([1002]);

    term.resetCapture();
    await controller.handleData('open docs.rs');
    await controller.handleData('\r');
    expect(adapter.openedUrls).toEqual(['https://docs.rs']);

    term.resetCapture();
    await controller.handleData('unknowncmd');
    await controller.handleData('\r');
    expect(term.plainOutput()).toContain('splash: command not found: unknowncmd');

    controller.dispose();
  });

  it('completes command names and cd tab IDs with LCP and candidate table', async () => {
    const adapter = new FakeBrowserAdapter({
      currentWindowId: 1,
      currentTabId: 1201,
      tabs: [
        { id: 1201, windowId: 1, index: 0, active: true, title: 'splash', url: 'chrome://newtab' },
        { id: 1209, windowId: 1, index: 1, active: false, title: 'GitHub', url: 'https://github.com' },
        { id: 8800, windowId: 1, index: 2, active: false, title: 'Docs', url: 'https://docs.rs' },
      ],
    });
    const term = new FakeTerminal(100);
    const controller = new ShellController(term, adapter, createDefaultRegistry());
    await controller.start();

    // Unique command completion: "op" + Tab -> "open "
    await controller.handleData('op');
    await controller.handleData('\t');
    await controller.handleData('github.com');
    await controller.handleData('\r');
    expect(adapter.openedUrls).toEqual(['https://github.com']);

    // Multi-match cd completion: "cd 1" + Tab -> extends to LCP "120" and prints candidate table
    term.resetCapture();
    await controller.handleData('cd 1');
    await controller.handleData('\t');
    const tableOut = term.plainOutput();
    expect(tableOut).toContain('1201');
    expect(tableOut).toContain('1209');
    expect(tableOut).toContain('GitHub');
    expect(tableOut).not.toContain('8800');

    // Type "9" + Enter -> executes "cd 1209"
    await controller.handleData('9');
    await controller.handleData('\r');
    expect(adapter.activatedTabIds).toEqual([1209]);

    // Unique cd completion: "cd 8" + Tab -> fills "8800"
    await controller.handleData('cd 8');
    await controller.handleData('\t');
    await controller.handleData('\r');
    expect(adapter.activatedTabIds).toEqual([1209, 8800]);

    controller.dispose();
  });

  it('handles Ctrl+C cancellation, Ctrl+L screen clear preserving buffer, and multiline paste', async () => {
    const adapter = new FakeBrowserAdapter();
    const term = new FakeTerminal(80);
    const controller = new ShellController(term, adapter, createDefaultRegistry());
    await controller.start();

    // Ctrl+C cancels current input
    term.resetCapture();
    await controller.handleData('open abc');
    await controller.handleData('\x03');
    expect(term.plainOutput()).toContain('^C');
    await controller.handleData('\r');
    expect(adapter.openedUrls).toEqual([]);
    expect(adapter.searches).toEqual([]);

    // Ctrl+L clears screen while keeping current typed buffer
    await controller.handleData('open docs.rs');
    term.resetCapture();
    await controller.handleData('\x0c');
    expect(term.clears).toBeGreaterThan(0);
    expect(term.plainOutput()).toContain('$ open docs.rs');
    await controller.handleData('\r');
    expect(adapter.openedUrls).toEqual(['https://docs.rs']);

    // Multiline paste folds newlines to spaces without executing prematurely
    await controller.handleData('open ');
    await controller.handleData('hello\nworld');
    expect(adapter.searches).toEqual([]);
    await controller.handleData('\r');
    expect(adapter.searches).toEqual(['hello world']);

    controller.dispose();
  });

  it('positions cursor accurately for CJK input during left arrow and mid-line edit', async () => {
    const adapter = new FakeBrowserAdapter();
    const term = new FakeTerminal(80);
    const controller = new ShellController(term, adapter, createDefaultRegistry());
    await controller.start();

    await controller.handleData('open 中文');
    term.resetCapture();
    // Move left once (before '文'): prompt "$ " (2) + "open " (5) + "中" (2) = col 9
    await controller.handleData('\x1b[D');
    expect(term.rawOutput()).toContain('\x1b[9C');

    // Insert '字' between 中 and 文 -> "open 中字文"
    await controller.handleData('字');
    await controller.handleData('\r');
    expect(adapter.searches).toEqual(['中字文']);

    controller.dispose();
  });

  it('tracks wrapped wide-char boundary shifts and UnicodeV6 emoji cursor widths', async () => {
    const adapter = new FakeBrowserAdapter();
    // On 10 cols: "$ " (2) + "1234567" (7) puts cursor at col 9; inserting '中' (width 2)
    // wraps '中' onto row 1 cols 0..1, placing cursor at row 1 col 2.
    const narrowTerm = new FakeTerminal(10);
    const narrowCtrl = new ShellController(narrowTerm, adapter, createDefaultRegistry());
    await narrowCtrl.start();

    await narrowCtrl.handleData('1234567');
    narrowTerm.resetCapture();
    await narrowCtrl.handleData('中');
    // End of line is row 1 col 2, so cursor must move to col 2 (\x1b[2C), NOT col 1 (\x1b[1C)
    expect(narrowTerm.rawOutput()).toContain('\x1b[2C');

    // Backspace from row 1 must move up 1 row (\x1b[1A) so no ghost line remains
    narrowTerm.resetCapture();
    await narrowCtrl.handleData('\x7f');
    expect(narrowTerm.rawOutput()).toContain('\x1b[1A');
    narrowCtrl.dispose();

    // Emoji matches xterm UnicodeV6 width (1): "$ " (2) + "open " (5) + "🚀" (1) = col 8
    const emojiTerm = new FakeTerminal(80);
    const emojiCtrl = new ShellController(emojiTerm, adapter, createDefaultRegistry());
    await emojiCtrl.start();
    await emojiCtrl.handleData('open 🚀a');
    emojiTerm.resetCapture();
    await emojiCtrl.handleData('\x1b[D');
    expect(emojiTerm.rawOutput()).toContain('\x1b[8C');
    emojiCtrl.dispose();
  });

  it('handles mid-line, leading-space, unclosed-quote, and 0/1-tab Tab completion safely', async () => {
    const emptyAdapter = new FakeBrowserAdapter({ tabs: [] });
    const term = new FakeTerminal(80);
    const ctrl = new ShellController(term, emptyAdapter, createDefaultRegistry());
    await ctrl.start();

    // 0-tab cd completion is a clean no-op
    await ctrl.handleData('cd ');
    term.resetCapture();
    await ctrl.handleData('\t');
    expect(term.rawOutput()).toBe('');
    await ctrl.handleData('\x03');

    // Leading whitespace command completion ("  op" + Tab -> "  open ")
    await ctrl.handleData('  op');
    await ctrl.handleData('\t');
    await ctrl.handleData('example.com');
    await ctrl.handleData('\r');
    expect(emptyAdapter.openedUrls).toEqual(['https://example.com']);

    // Unclosed quote completion is a no-op
    await ctrl.handleData('open "unclosed');
    term.resetCapture();
    await ctrl.handleData('\t');
    expect(term.rawOutput()).toBe('');
    await ctrl.handleData('\x03');

    // Mid-line completion keeps trailing text intact
    await ctrl.handleData('op docs.rs');
    // Move cursor right after "op" (8 chars left from end)
    for (let i = 0; i < 8; i++) {
      await ctrl.handleData('\x1b[D');
    }
    await ctrl.handleData('\t');
    await ctrl.handleData('\r');
    expect(emptyAdapter.openedUrls).toEqual(['https://example.com', 'https://docs.rs']);

    ctrl.dispose();
  });

  it('serializes keystrokes queued while an async command awaits browser promises', async () => {
    let releaseListTabs!: () => void;
    const listTabsGate = new Promise<void>((resolve) => {
      releaseListTabs = resolve;
    });
    const baseAdapter = new FakeBrowserAdapter({
      currentWindowId: 1,
      currentTabId: 1001,
      tabs: [
        { id: 1001, windowId: 1, index: 0, active: true, title: 'splash', url: 'chrome://newtab' },
        { id: 1002, windowId: 1, index: 1, active: false, title: 'Target', url: 'https://target.dev' },
      ],
    });
    const origListTabs = baseAdapter.listTabs.bind(baseAdapter);
    baseAdapter.listTabs = async (scope) => {
      await listTabsGate;
      return origListTabs(scope);
    };

    const term = new FakeTerminal(80);
    const ctrl = new ShellController(term, baseAdapter, createDefaultRegistry());
    await ctrl.start();

    await ctrl.handleData('ls');
    const lsPromise = ctrl.handleData('\r');
    // Queue next command while ls is still awaiting listTabs
    const cdTextPromise = ctrl.handleData('cd 1002');
    const cdEnterPromise = ctrl.handleData('\r');
    expect(baseAdapter.activatedTabIds).toEqual([]);

    releaseListTabs();
    await Promise.all([lsPromise, cdTextPromise, cdEnterPromise]);
    expect(baseAdapter.activatedTabIds).toEqual([1002]);
    ctrl.dispose();
  });

  it('persists history on execute and syncs external history changes across tabs', async () => {
    const adapter = new FakeBrowserAdapter({ history: ['ls'] });
    const term = new FakeTerminal(80);
    const controller = new ShellController(term, adapter, createDefaultRegistry());
    await controller.start();

    await controller.handleData('open example.com');
    await controller.handleData('\r');
    expect(adapter.history).toEqual(['ls', 'open example.com']);

    // External tab writes a new command into storage
    adapter.emitExternalHistoryChange(['ls', 'open example.com', 'open docs.rs']);

    // Up arrow should recall the externally synced entry
    await controller.handleData('\x1b[A');
    await controller.handleData('\r');
    expect(adapter.openedUrls).toEqual(['https://example.com', 'https://docs.rs']);

    controller.dispose();
  });
});
