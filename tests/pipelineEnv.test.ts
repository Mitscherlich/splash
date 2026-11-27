import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../src/commands';
import { DEFAULT_CONFIG } from '../src/config/schema';
import { ansi } from '../src/shell/ansi';
import { ShellController, type TerminalIO } from '../src/shell/controller';
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

describe('Shell pipelines and echo/cat built-ins', () => {
  it('executes echo, echo -n, and multi-stage plain-text pipelines through cat', async () => {
    const adapter = new FakeBrowserAdapter();
    const term = new FakeTerminal();
    const registry = createDefaultRegistry();
    const receivedStdin: Array<string | undefined> = [];
    registry.register({
      name: 'capture',
      summary: 'Capture stdin',
      usage: 'capture',
      execute(ctx) {
        receivedStdin.push(ctx.stdin);
        if (ctx.stdin !== undefined) {
          ctx.write(ctx.stdin);
        }
      },
    });

    const controller = new ShellController(term, adapter, registry);
    await controller.start();

    term.reset();
    await runLine(controller, 'echo hello world | cat | capture');
    expect(receivedStdin[0]).toBe('hello world\n');
    expect(term.plainOutput()).toContain('hello world');

    term.reset();
    await runLine(controller, 'echo -n "no newline" | capture');
    expect(receivedStdin[1]).toBe('no newline');

    // ANSI codes from cat /etc/splash.d/config are stripped before reaching downstream stdin
    term.reset();
    await runLine(controller, 'cat /etc/splash.d/config | capture');
    expect(receivedStdin[2]).toContain('# Splash configuration');
    expect(receivedStdin[2]).not.toContain('\x1b');

    controller.dispose();
  });

  it('aborts downstream pipeline stages and keeps errors out of stdin when an upstream stage fails', async () => {
    const adapter = new FakeBrowserAdapter();
    const term = new FakeTerminal();
    const registry = createDefaultRegistry();
    let sinkCalls = 0;
    registry.register({
      name: 'sink',
      summary: 'Test sink',
      usage: 'sink',
      execute() {
        sinkCalls += 1;
      },
    });

    const controller = new ShellController(term, adapter, registry);
    await controller.start();

    term.reset();
    await runLine(controller, 'cat /etc/does-not-exist | sink');
    expect(sinkCalls).toBe(0);
    expect(term.plainOutput()).toContain('No such file or directory');

    term.reset();
    await runLine(controller, 'unknowncmd | sink');
    expect(sinkCalls).toBe(0);
    expect(term.plainOutput()).toContain('command not found: unknowncmd');

    controller.dispose();
  });
});

describe('Layered environment variables (config < session < inline)', () => {
  it('resolves config.env, export, unset tombstones, inline overrides, bare assignments, and config hot-reload', async () => {
    const adapter = new FakeBrowserAdapter({
      config: {
        header: { ...DEFAULT_CONFIG.header },
        env: { EDITOR: 'vim' },
      },
    });
    const term = new FakeTerminal();
    const registry = createDefaultRegistry();
    const observedEditors: Array<string | undefined> = [];
    registry.register({
      name: 'probe',
      summary: 'Probe EDITOR env',
      usage: 'probe',
      execute(ctx) {
        observedEditors.push(ctx.env.EDITOR);
      },
    });

    const controller = new ShellController(term, adapter, registry);
    await controller.start();

    // 1. Config default applies
    await runLine(controller, 'probe');
    expect(observedEditors.at(-1)).toBe('vim');

    term.reset();
    await runLine(controller, 'env');
    expect(term.plainOutput()).toContain('EDITOR=vim');

    // 2. Inline empty override clears EDITOR for one call only
    await runLine(controller, 'EDITOR= probe');
    expect(observedEditors.at(-1)).toBe('');
    await runLine(controller, 'probe');
    expect(observedEditors.at(-1)).toBe('vim');

    // 3. unset masks config default with session tombstone
    await runLine(controller, 'unset EDITOR');
    await runLine(controller, 'probe');
    expect(observedEditors.at(-1)).toBeUndefined();

    // 4. Bare assignment sets session env
    await runLine(controller, 'EDITOR=vim');
    await runLine(controller, 'probe');
    expect(observedEditors.at(-1)).toBe('vim');

    // 5. export overrides and survives config hot-reload
    await runLine(controller, 'export EDITOR=custom FOO=bar');
    await adapter.saveConfig({
      header: { ...DEFAULT_CONFIG.header },
      env: { EDITOR: 'from-config' },
    });
    await runLine(controller, 'probe');
    expect(observedEditors.at(-1)).toBe('custom');

    // 6. unset then falls back? Wait: unset masks config too, while fresh key from config appears
    await runLine(controller, 'unset EDITOR');
    await runLine(controller, 'probe');
    expect(observedEditors.at(-1)).toBeUndefined();

    // 7. Invalid export identifier reports error
    term.reset();
    await runLine(controller, 'export 123BAD=x');
    expect(term.plainOutput()).toContain('export: invalid identifier');

    controller.dispose();
  });
});
