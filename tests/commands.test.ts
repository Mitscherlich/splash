import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../src/commands';
import { resolveOpenTarget } from '../src/commands/open';
import { ansi } from '../src/shell/ansi';
import type { CommandContext } from '../src/shell/registry';
import { FakeBrowserAdapter } from './fakeAdapter';

function createContext(adapter: FakeBrowserAdapter, cols = 100) {
  const registry = createDefaultRegistry();
  const lines: string[] = [];
  let cleared = 0;

  const ctx: CommandContext = {
    adapter,
    registry,
    cols,
    write(text: string) {
      lines.push(text);
    },
    writeln(text = '') {
      lines.push(`${text}\n`);
    },
    clear() {
      cleared += 1;
    },
  };

  return {
    ctx,
    registry,
    output: () => ansi.strip(lines.join('')),
    rawOutput: () => lines.join(''),
    clearedCount: () => cleared,
  };
}

describe('ls command', () => {
  it('excludes newtab extension pages by default and shows all tabs with -a / --all', async () => {
    const adapter = new FakeBrowserAdapter({
      currentWindowId: 10,
      currentTabId: 102,
      tabs: [
        { id: 201, windowId: 20, index: 0, active: true, title: 'Docs', url: 'https://docs.rs' },
        { id: 102, windowId: 10, index: 1, active: true, title: 'splash', url: 'chrome://newtab/' },
        {
          id: 103,
          windowId: 10,
          index: 2,
          active: false,
          title: 'splash',
          url: 'chrome-extension://abcdefghijklmnop/newtab.html',
        },
        { id: 101, windowId: 10, index: 0, active: false, title: 'GitHub', url: 'https://github.com' },
      ],
    });

    // Default ls hides newtab extension pages (102, 103)
    const defaultRun = createContext(adapter, 100);
    await defaultRun.registry.get('ls')!.execute(defaultRun.ctx, []);
    const defaultRows = defaultRun.output().trim().split('\n');
    expect(defaultRows).toHaveLength(2);
    expect(defaultRows[0]).toContain('101');
    expect(defaultRows[0]).toContain('GitHub');
    expect(defaultRows[1]).toContain('W2');
    expect(defaultRows[1]).toContain('201');
    expect(defaultRows[1]).toContain('Docs');

    // ls -a and ls --all include newtab extension pages and mark current tab with *
    for (const flag of ['-a', '--all']) {
      const allRun = createContext(adapter, 100);
      await allRun.registry.get('ls')!.execute(allRun.ctx, [flag]);
      const allRows = allRun.output().trim().split('\n');
      expect(allRows).toHaveLength(4);
      expect(allRows[1]).toMatch(/^\*/);
      expect(allRows[1]).toContain('102');
      expect(allRows[2]).toContain('103');
    }
  });

  it('rejects removed -c / --current options as unknown options', async () => {
    const adapter = new FakeBrowserAdapter({
      currentWindowId: 10,
      currentTabId: 101,
      tabs: [
        { id: 101, windowId: 10, index: 0, active: true, title: 'Local', url: 'http://localhost:3000' },
      ],
    });

    for (const flag of ['-c', '--current']) {
      const { ctx, registry, output } = createContext(adapter, 100);
      await registry.get('ls')!.execute(ctx, [flag]);
      expect(output()).toContain(`ls: unknown option: ${flag}`);
    }
  });

  it('wraps ls links in OSC 8 splash-tab://<tabId> hyperlinks (and title on narrow viewports)', async () => {
    const adapter = new FakeBrowserAdapter({
      currentWindowId: 1,
      currentTabId: 999,
      tabs: [
        { id: 999, windowId: 1, index: 0, active: true, title: 'splash', url: 'chrome://newtab/' },
        { id: 1002, windowId: 1, index: 1, active: false, title: 'GitHub', url: 'https://github.com' },
      ],
    });

    const wide = createContext(adapter, 100);
    await wide.registry.get('ls')!.execute(wide.ctx, []);
    expect(wide.rawOutput()).toContain('\x1b]8;;splash-tab://1002\x07');
    expect(wide.rawOutput()).toContain('\x1b]8;;\x07');
    expect(wide.output()).toContain('https://github.com');
    expect(wide.output()).not.toContain('splash-tab://');

    // Narrow viewport omits URL column, so title itself carries the OSC 8 tab link
    const narrow = createContext(adapter, 45);
    await narrow.registry.get('ls')!.execute(narrow.ctx, []);
    expect(narrow.rawOutput()).toContain('\x1b]8;;splash-tab://1002\x07GitHub\x1b]8;;\x07');
  });

  it('handles untitled tabs, CJK title truncation on narrow cols, and unknown options', async () => {
    const adapter = new FakeBrowserAdapter({
      currentWindowId: 1,
      currentTabId: 1001,
      tabs: [
        { id: 1001, windowId: 1, index: 0, active: true, title: 'splash', url: 'chrome://newtab/' },
        { id: 1002, windowId: 1, index: 1, active: false, title: '', url: 'about:blank' },
        {
          id: 1003,
          windowId: 1,
          index: 2,
          active: false,
          title: '这是一个非常非常长的中文标签页标题用于测试截断',
          url: 'https://example.com/very/long/path/that/should/truncate',
        },
      ],
    });

    const narrow = createContext(adapter, 45);
    await narrow.registry.get('ls')!.execute(narrow.ctx, []);
    const out = narrow.output();
    expect(out).toContain('(untitled)');
    expect(out).toContain('…');

    const bad = createContext(adapter, 100);
    await bad.registry.get('ls')!.execute(bad.ctx, ['-z']);
    expect(bad.output()).toContain('ls: unknown option: -z');
  });

  it('sanitizes control characters from webpage titles and URLs in ls and cd completion', async () => {
    const adapter = new FakeBrowserAdapter({
      currentWindowId: 1,
      currentTabId: 999,
      tabs: [
        { id: 999, windowId: 1, index: 0, active: true, title: 'splash', url: 'chrome://newtab/' },
        {
          id: 1001,
          windowId: 1,
          index: 1,
          active: false,
          title: 'Safe\x1b[2JTitle\x07',
          url: 'https://evil.example/\x1b]52;c;xx\x07',
        },
      ],
    });

    const { ctx, registry, rawOutput } = createContext(adapter, 100);
    await registry.get('ls')!.execute(ctx, []);
    expect(rawOutput()).not.toContain('\x1b[2J');
    expect(rawOutput()).not.toContain('\x1b]52');
    // Note: OSC 8 uses \x07 as terminator, so verify the injected BEL inside title/url did not survive
    expect(ansi.strip(rawOutput())).not.toContain('\x07');

    const completions = await registry.get('cd')!.complete!(ctx, [], '1001');
    expect(completions[0]?.label).toBe('Safe[2JTitle');
  });
});

describe('cd command', () => {
  it('activates exact tab.id and keeps current shell tab intact', async () => {
    const adapter = new FakeBrowserAdapter({
      currentWindowId: 1,
      currentTabId: 1001,
      tabs: [
        { id: 1001, windowId: 1, index: 0, active: true, title: 'splash', url: 'chrome://newtab' },
        { id: 1002, windowId: 2, index: 0, active: false, title: 'GitHub', url: 'https://github.com' },
      ],
    });
    const { ctx, registry, output } = createContext(adapter);

    await registry.get('cd')!.execute(ctx, ['1002']);
    expect(adapter.activatedTabIds).toEqual([1002]);
    expect(adapter.tabs.some((t) => t.id === 1001)).toBe(true);
    expect(output()).toBe('');
  });

  it('returns silently when targeting the already current tab', async () => {
    const adapter = new FakeBrowserAdapter({
      currentWindowId: 1,
      currentTabId: 1001,
      tabs: [
        { id: 1001, windowId: 1, index: 0, active: true, title: 'splash', url: 'chrome://newtab' },
      ],
    });
    const { ctx, registry, output } = createContext(adapter);

    await registry.get('cd')!.execute(ctx, ['1001']);
    expect(output()).toBe('');
    expect(adapter.activatedTabIds).toEqual([]);
  });

  it('validates missing, non-integer, negative, extra, and non-existent tab ids', async () => {
    const adapter = new FakeBrowserAdapter({
      currentWindowId: 1,
      currentTabId: 1001,
      tabs: [
        { id: 1001, windowId: 1, index: 0, active: true, title: 'splash', url: 'chrome://newtab' },
      ],
    });

    const missing = createContext(adapter);
    await missing.registry.get('cd')!.execute(missing.ctx, []);
    expect(missing.output()).toContain('usage: cd <tabId>');

    for (const invalid of [['github'], ['-1'], ['0'], ['12.5'], ['1001', '1002']]) {
      const res = createContext(adapter);
      await res.registry.get('cd')!.execute(res.ctx, invalid);
      expect(res.output()).toContain('cd: invalid tab id');
    }

    const notFound = createContext(adapter);
    await notFound.registry.get('cd')!.execute(notFound.ctx, ['999999']);
    expect(notFound.output()).toContain('cd: tab not found: 999999');
  });

  it('completes tab IDs by prefix with tab title labels', async () => {
    const adapter = new FakeBrowserAdapter({
      currentWindowId: 1,
      currentTabId: 1201,
      tabs: [
        { id: 1201, windowId: 1, index: 0, active: true, title: 'splash', url: 'chrome://newtab' },
        { id: 1209, windowId: 1, index: 1, active: false, title: 'GitHub', url: 'https://github.com' },
        { id: 5500, windowId: 1, index: 2, active: false, title: 'Docs', url: 'https://docs.rs' },
      ],
    });
    const { ctx, registry } = createContext(adapter);

    const items = await registry.get('cd')!.complete!(ctx, [], '12');
    expect(items).toEqual([
      { value: '1201', label: 'splash' },
      { value: '1209', label: 'GitHub' },
    ]);

    // Second positional argument should not offer completions
    const secondArg = await registry.get('cd')!.complete!(ctx, ['1201'], '');
    expect(secondArg).toEqual([]);
  });
});

describe('open command and resolveOpenTarget', () => {
  it('blocks dangerous schemes case-insensitively', () => {
    expect(resolveOpenTarget(['javascript:alert(1)'])).toEqual({
      kind: 'error',
      message: 'open: unsupported scheme',
    });
    expect(resolveOpenTarget(['JAVASCRIPT:void(0)'])).toEqual({
      kind: 'error',
      message: 'open: unsupported scheme',
    });
    expect(resolveOpenTarget(['data:text/html,<h1>x</h1>'])).toEqual({
      kind: 'error',
      message: 'open: unsupported scheme',
    });
  });

  it('passes explicit allowed schemes directly to openUrl', () => {
    for (const url of [
      'https://github.com/org/repo',
      'http://localhost:5173',
      'chrome://extensions',
      'chrome-extension://abcdef/newtab.html',
      'file:///tmp/index.html',
      'about:blank',
    ]) {
      expect(resolveOpenTarget([url])).toEqual({ kind: 'url', url });
    }
  });

  it('prepends http:// for localhost and IPv4, and https:// for bare domains', () => {
    expect(resolveOpenTarget(['localhost'])).toEqual({ kind: 'url', url: 'http://localhost' });
    expect(resolveOpenTarget(['localhost:3000/api'])).toEqual({
      kind: 'url',
      url: 'http://localhost:3000/api',
    });
    expect(resolveOpenTarget(['127.0.0.1:8080/health'])).toEqual({
      kind: 'url',
      url: 'http://127.0.0.1:8080/health',
    });
    expect(resolveOpenTarget(['github.com'])).toEqual({
      kind: 'url',
      url: 'https://github.com',
    });
    expect(resolveOpenTarget(['docs.rs/tokio/latest?q=1#top'])).toEqual({
      kind: 'url',
      url: 'https://docs.rs/tokio/latest?q=1#top',
    });
  });

  it('prepends http:// for bare bracketed IPv6 literals and routes invalid bracketed strings to search', () => {
    expect(resolveOpenTarget(['[::1]'])).toEqual({ kind: 'url', url: 'http://[::1]' });
    expect(resolveOpenTarget(['[::1]:3000/api'])).toEqual({
      kind: 'url',
      url: 'http://[::1]:3000/api',
    });
    expect(resolveOpenTarget(['[2001:db8::1]/health'])).toEqual({
      kind: 'url',
      url: 'http://[2001:db8::1]/health',
    });
    expect(resolveOpenTarget(['[::1::2]:3000'])).toEqual({
      kind: 'search',
      query: '[::1::2]:3000',
    });
  });

  it('routes multi-word queries and non-domain words to default search', () => {
    expect(resolveOpenTarget(['weather'])).toEqual({ kind: 'search', query: 'weather' });
    expect(resolveOpenTarget(['v1.2'])).toEqual({ kind: 'search', query: 'v1.2' });
    expect(resolveOpenTarget(['xterm', 'fit', 'addon'])).toEqual({
      kind: 'search',
      query: 'xterm fit addon',
    });
    expect(resolveOpenTarget(['hello world'])).toEqual({
      kind: 'search',
      query: 'hello world',
    });
  });

  it('executes openUrl / search via adapter and prints usage when empty', async () => {
    const adapter = new FakeBrowserAdapter();

    const empty = createContext(adapter);
    await empty.registry.get('open')!.execute(empty.ctx, []);
    expect(empty.output()).toContain('usage: open <url | search query>');

    const urlRun = createContext(adapter);
    await urlRun.registry.get('open')!.execute(urlRun.ctx, ['github.com']);
    expect(adapter.openedUrls).toEqual(['https://github.com']);

    const searchRun = createContext(adapter);
    await searchRun.registry.get('open')!.execute(searchRun.ctx, ['chrome', 'mv3', 'search']);
    expect(adapter.searches).toEqual(['chrome mv3 search']);
  });
});

describe('clear and help commands', () => {
  it('clear calls ctx.clear()', async () => {
    const adapter = new FakeBrowserAdapter();
    const { ctx, registry, clearedCount } = createContext(adapter);

    await registry.get('clear')!.execute(ctx, []);
    expect(clearedCount()).toBe(1);
  });

  it('help lists all registered commands and shows detailed usage for one command', async () => {
    const adapter = new FakeBrowserAdapter();
    const all = createContext(adapter);
    await all.registry.get('help')!.execute(all.ctx, []);
    const listOut = all.output();
    for (const cmd of ['ls', 'cd', 'open', 'clear', 'help']) {
      expect(listOut).toContain(cmd);
    }

    const detail = createContext(adapter);
    await detail.registry.get('help')!.execute(detail.ctx, ['cd']);
    expect(detail.output()).toContain('cd <tabId>');

    const unknown = createContext(adapter);
    await unknown.registry.get('help')!.execute(unknown.ctx, ['nope']);
    expect(unknown.output()).toContain('help: unknown command: nope');
  });
});
