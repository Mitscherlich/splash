import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../src/commands';
import { DEFAULT_CONFIG, parseConfigText, serializeConfig } from '../src/config/schema';
import { getNoteMessages, resolveLocale } from '../src/i18n/locale';
import { formatNoteTimestamp } from '../src/notes/store';
import { ansi } from '../src/shell/ansi';
import { ShellController, type TerminalIO } from '../src/shell/controller';
import { FakeBrowserAdapter } from './fakeAdapter';

describe('resolveLocale and i18n messages', () => {
  it('resolves explicit LANG values including zh_CN.UTF-8, en_US.UTF-8, and en_US.UTS-8', () => {
    expect(resolveLocale('zh_CN.UTF-8', 'en-US')).toBe('zh');
    expect(resolveLocale('zh-Hans', 'en-US')).toBe('zh');
    expect(resolveLocale('en_US.UTF-8', 'zh-CN')).toBe('en');
    expect(resolveLocale('en_US.UTS-8', 'zh-CN')).toBe('en');
    expect(resolveLocale('en', 'zh-CN')).toBe('en');
  });

  it('follows browser default language when LANG is C, POSIX, empty, or unset, defaulting to English', () => {
    expect(resolveLocale('C', 'zh-CN')).toBe('zh');
    expect(resolveLocale('C', 'en-US')).toBe('en');
    expect(resolveLocale('C', 'ja-JP')).toBe('en');
    expect(resolveLocale('POSIX', 'zh-TW')).toBe('zh');
    expect(resolveLocale('', 'zh-CN')).toBe('zh');
    expect(resolveLocale(undefined, 'zh-CN')).toBe('zh');
    expect(resolveLocale(undefined, 'de-DE')).toBe('en');
    expect(resolveLocale(undefined, '')).toBe('en');
    expect(resolveLocale('fr_FR.UTF-8', 'zh-CN')).toBe('en');
  });

  it('provides complete English and Chinese GUI strings and localized timestamps', () => {
    const en = getNoteMessages('en');
    const zh = getNoteMessages('zh');
    expect(en.btnNew).toContain('New');
    expect(en.emptyTitle).toContain('No notes');
    expect(zh.btnNew).toContain('新建');
    expect(zh.emptyTitle).toContain('暂无备忘');

    const now = new Date(2026, 10, 27, 16, 0, 0).getTime();
    const todayTs = new Date(2026, 10, 27, 14, 5, 0).getTime();
    const yesterdayTs = new Date(2026, 10, 26, 9, 30, 0).getTime();

    expect(formatNoteTimestamp(todayTs, now, 'en')).toBe('Today 14:05');
    expect(formatNoteTimestamp(yesterdayTs, now, 'en')).toBe('Yesterday 09:30');
    expect(formatNoteTimestamp(todayTs, now, 'zh')).toBe('今天 14:05');
    expect(formatNoteTimestamp(yesterdayTs, now, 'zh')).toBe('昨天 09:30');
  });

  it('round-trips env.LANG in /etc/splash.d/config', () => {
    const cfg = {
      header: { ...DEFAULT_CONFIG.header },
      env: { EDITOR: 'vim', LANG: 'zh_CN.UTF-8' },
    };
    const serialized = serializeConfig(cfg);
    expect(serialized).toContain('env.LANG = zh_CN.UTF-8');
    expect(parseConfigText(serialized)).toEqual({ ok: true, config: cfg });
  });

  it('persists export LANG and unset LANG into /etc/splash.d/config while keeping inline LANG= one-shot', async () => {
    const adapter = new FakeBrowserAdapter();
    const writes: string[] = [];
    const term: TerminalIO = {
      cols: 100,
      rows: 24,
      write: (d) => writes.push(d),
      writeln: (d) => writes.push(`${d}\r\n`),
      clear() {},
      onData: () => ({ dispose() {} }),
    };

    const controller = new ShellController(term, adapter, createDefaultRegistry());
    await controller.start();

    const runLine = async (line: string) => {
      await controller.handleData(line);
      await controller.handleData('\r');
    };

    // export LANG=zh_CN.UTF-8 persists to config.env.LANG
    await runLine('export LANG=zh_CN.UTF-8');
    expect(adapter.config.env.LANG).toBe('zh_CN.UTF-8');

    // cat /etc/splash.d/config reflects persisted env.LANG
    writes.length = 0;
    await runLine('cat /etc/splash.d/config');
    expect(ansi.strip(writes.join(''))).toContain('env.LANG = zh_CN.UTF-8');

    // Inline LANG=en_US.UTF-8 env is one-shot and does NOT overwrite persisted config
    await runLine('LANG=en_US.UTF-8 env');
    expect(adapter.config.env.LANG).toBe('zh_CN.UTF-8');

    // export LANG=C persists C
    await runLine('export LANG=C');
    expect(adapter.config.env.LANG).toBe('C');

    // unset LANG clears persisted config.env.LANG
    await runLine('unset LANG');
    expect(adapter.config.env.LANG).toBe('');

    controller.dispose();
  });
});
