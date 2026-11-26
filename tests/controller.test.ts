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
    expect(lsOut).toContain('1001');
    expect(lsOut).toContain('1002');
    expect(lsOut).toContain('GitHub');

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
