import type { BrowserAdapter } from '../adapter/types';
import { PROMPT_TEXT } from '../theme/defaultTheme';
import { ansi } from './ansi';
import { LineEditor } from './lineEditor';
import { parseCommandLine, parseCompletionContext } from './parser';
import type {
  CommandContext,
  CommandRegistry,
  CompletionItem,
} from './registry';
import { stringDisplayWidth, truncateToWidth } from './width';

export interface TerminalIO {
  readonly cols: number;
  write(data: string): void;
  writeln(data: string): void;
  clear(): void;
  onData(listener: (data: string) => void): { dispose(): void };
}

function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) return '';
  let prefix = values[0]!;
  for (let i = 1; i < values.length; i++) {
    const current = values[i]!;
    let j = 0;
    const max = Math.min(prefix.length, current.length);
    while (j < max && prefix[j] === current[j]) {
      j += 1;
    }
    prefix = prefix.slice(0, j);
    if (prefix.length === 0) break;
  }
  return prefix;
}

export class ShellController {
  private readonly editor = new LineEditor();
  private renderedCursorRow = 0;
  private queue: Promise<void> = Promise.resolve();
  private dataSubscription: { dispose(): void } | null = null;
  private unsubscribeHistory: (() => void) | null = null;
  private disposed = false;

  constructor(
    private readonly terminal: TerminalIO,
    private readonly adapter: BrowserAdapter,
    private readonly registry: CommandRegistry,
  ) {}

  async start(): Promise<void> {
    try {
      const history = await this.adapter.loadHistory();
      this.editor.setHistory(history);
    } catch {
      // Ignore transient storage load errors on startup
    }

    this.unsubscribeHistory = this.adapter.onHistoryChanged((entries) => {
      this.editor.setHistory(entries);
    });

    this.dataSubscription = this.terminal.onData((data) => {
      void this.handleData(data);
    });

    this.writePrompt();
  }

  dispose(): void {
    this.disposed = true;
    this.dataSubscription?.dispose();
    this.dataSubscription = null;
    this.unsubscribeHistory?.();
    this.unsubscribeHistory = null;
  }

  handleData(data: string): Promise<void> {
    if (this.disposed || !data) {
      return this.queue;
    }
    this.queue = this.queue.then(() => this.processData(data));
    return this.queue;
  }

  private async processData(data: string): Promise<void> {
    if (this.disposed) return;

    // Bracketed paste mode: \x1b[200~ ... \x1b[201~
    if (data.startsWith('\x1b[200~') && data.endsWith('\x1b[201~')) {
      const pasted = data.slice(6, -6);
      this.editor.paste(pasted);
      this.redrawLine();
      return;
    }

    // Raw multi-line paste (newlines folded to spaces without executing)
    if (data.length > 1 && !data.startsWith('\x1b') && /[\r\n]/.test(data)) {
      this.editor.paste(data);
      this.redrawLine();
      return;
    }

    let i = 0;
    while (i < data.length) {
      if (data[i] === '\x1b') {
        const consumed = this.handleEscapeSequence(data, i);
        i += consumed;
        continue;
      }

      const ch = data[i]!;
      if (ch === '\r' || ch === '\n') {
        await this.submitCurrentLine();
        i += 1;
        continue;
      }
      if (ch === '\t') {
        await this.handleTabCompletion();
        i += 1;
        continue;
      }
      if (ch === '\x7f' || ch === '\b') {
        if (this.editor.backspace()) {
          this.redrawLine();
        }
        i += 1;
        continue;
      }
      if (ch === '\x03') {
        // Ctrl+C
        this.moveToLineEndBeforeNewline();
        this.terminal.write('^C\r\n');
        this.editor.reset();
        this.renderedCursorRow = 0;
        this.writePrompt();
        i += 1;
        continue;
      }
      if (ch === '\x0c') {
        // Ctrl+L
        this.clearScreen();
        this.redrawLine();
        i += 1;
        continue;
      }
      if (ch === '\x01') {
        // Ctrl+A
        if (this.editor.moveHome()) this.redrawLine();
        i += 1;
        continue;
      }
      if (ch === '\x05') {
        // Ctrl+E
        if (this.editor.moveEnd()) this.redrawLine();
        i += 1;
        continue;
      }
      if (ch === '\x15') {
        // Ctrl+U
        if (this.editor.killToStart()) this.redrawLine();
        i += 1;
        continue;
      }
      if (ch === '\x0b') {
        // Ctrl+K
        if (this.editor.killToEnd()) this.redrawLine();
        i += 1;
        continue;
      }
      if (ch === '\x17') {
        // Ctrl+W
        if (this.editor.killPrevWord()) this.redrawLine();
        i += 1;
        continue;
      }

      // Ignore other non-printable ASCII control bytes
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        i += 1;
        continue;
      }

      // Collect contiguous printable text (handling UTF-16 surrogate pairs cleanly)
      let end = i;
      while (end < data.length) {
        const c = data.charCodeAt(end);
        if (c < 0x20 || c === 0x7f) break;
        end += 1;
      }
      this.editor.insert(data.slice(i, end));
      this.redrawLine();
      i = end;
    }
  }

  private handleEscapeSequence(data: string, start: number): number {
    const rest = data.slice(start);

    if (rest.startsWith('\x1b[A')) {
      if (this.editor.historyUp()) this.redrawLine();
      return 3;
    }
    if (rest.startsWith('\x1b[B')) {
      if (this.editor.historyDown()) this.redrawLine();
      return 3;
    }
    if (rest.startsWith('\x1b[C')) {
      if (this.editor.moveRight()) this.redrawLine();
      return 3;
    }
    if (rest.startsWith('\x1b[D')) {
      if (this.editor.moveLeft()) this.redrawLine();
      return 3;
    }
    if (rest.startsWith('\x1b[H') || rest.startsWith('\x1bOH')) {
      if (this.editor.moveHome()) this.redrawLine();
      return 3;
    }
    if (rest.startsWith('\x1b[F') || rest.startsWith('\x1bOF')) {
      if (this.editor.moveEnd()) this.redrawLine();
      return 3;
    }
    if (rest.startsWith('\x1b[1~') || rest.startsWith('\x1b[7~')) {
      if (this.editor.moveHome()) this.redrawLine();
      return 4;
    }
    if (rest.startsWith('\x1b[4~') || rest.startsWith('\x1b[8~')) {
      if (this.editor.moveEnd()) this.redrawLine();
      return 4;
    }
    if (rest.startsWith('\x1b[3~')) {
      if (this.editor.deleteForward()) this.redrawLine();
      return 4;
    }

    // Consume generic CSI sequence (\x1b[ ... final byte 0x40-0x7e) without printing garbage
    if (rest.startsWith('\x1b[')) {
      let j = 2;
      while (j < rest.length) {
        const b = rest.charCodeAt(j);
        j += 1;
        if (b >= 0x40 && b <= 0x7e) break;
      }
      return j;
    }

    // Consume SS3 sequence (\x1bO + 1 byte)
    if (rest.startsWith('\x1bO') && rest.length >= 3) {
      return 3;
    }

    return 1;
  }

  private async submitCurrentLine(): Promise<void> {
    const line = this.editor.buffer;
    this.moveToLineEndBeforeNewline();
    this.terminal.write('\r\n');
    this.editor.reset();
    this.renderedCursorRow = 0;

    const trimmed = line.trim();
    if (!trimmed) {
      this.writePrompt();
      return;
    }

    if (this.editor.recordHistory(trimmed)) {
      try {
        await this.adapter.saveHistory(this.editor.getHistory());
      } catch {
        // Non-fatal: continue executing command even if storage write fails
      }
    }

    const parsed = parseCommandLine(trimmed);
    if (!parsed.ok) {
      this.terminal.writeln(ansi.error(`splash: ${parsed.error}`));
      this.writePrompt();
      return;
    }

    const [cmdName, ...args] = parsed.tokens;
    if (!cmdName) {
      this.writePrompt();
      return;
    }

    const cmd = this.registry.get(cmdName);
    if (!cmd) {
      this.terminal.writeln(ansi.error(`splash: command not found: ${cmdName}`));
      this.writePrompt();
      return;
    }

    const ctx = this.createCommandContext();
    try {
      await cmd.execute(ctx, args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.terminal.writeln(ansi.error(`splash: ${cmdName}: ${msg}`));
    }

    this.writePrompt();
  }

  private async handleTabCompletion(): Promise<void> {
    const before = this.editor.beforeCursor();
    const after = this.editor.afterCursor();
    const compCtx = parseCompletionContext(before);
    if (!compCtx) return;

    let items: CompletionItem[] = [];

    if (compCtx.isCommand) {
      items = this.registry
        .list()
        .filter((cmd) => cmd.name.startsWith(compCtx.currentToken))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((cmd) => ({ value: cmd.name, label: cmd.summary }));
    } else {
      const cmd = this.registry.get(compCtx.command);
      if (!cmd?.complete) return;
      try {
        items = await cmd.complete(
          this.createCommandContext(),
          compCtx.args,
          compCtx.currentToken,
        );
      } catch {
        return;
      }
    }

    if (items.length === 0) return;

    const prefixBeforeToken = before.slice(0, compCtx.tokenStart);

    if (items.length === 1) {
      const only = items[0]!;
      const needsTrailingSpace =
        compCtx.isCommand && (after.length === 0 || !/^\s/.test(after));
      const inserted = needsTrailingSpace ? `${only.value} ` : only.value;
      const nextBuffer = `${prefixBeforeToken}${inserted}${after}`;
      const nextCursor = prefixBeforeToken.length + inserted.length;
      this.editor.setBuffer(nextBuffer, nextCursor);
      this.redrawLine();
      return;
    }

    const lcp = longestCommonPrefix(items.map((item) => item.value));
    if (lcp.length > compCtx.currentToken.length) {
      const nextBuffer = `${prefixBeforeToken}${lcp}${after}`;
      const nextCursor = prefixBeforeToken.length + lcp.length;
      this.editor.setBuffer(nextBuffer, nextCursor);
    }

    // Print compact completion table below current prompt line, then redraw prompt
    this.moveToLineEndBeforeNewline();
    this.terminal.write('\r\n');
    this.renderedCursorRow = 0;

    const cols = Math.max(20, this.terminal.cols);
    const valWidth = Math.max(...items.map((item) => item.value.length));
    const labelBudget = Math.max(8, cols - valWidth - 4);

    for (const item of items) {
      const valText = ansi.accent(item.value.padEnd(valWidth, ' '));
      if (item.label) {
        const labelText = ansi.muted(truncateToWidth(item.label, labelBudget));
        this.terminal.writeln(`  ${valText}  ${labelText}`);
      } else {
        this.terminal.writeln(`  ${valText}`);
      }
    }

    this.redrawLine();
  }

  private createCommandContext(): CommandContext {
    return {
      adapter: this.adapter,
      registry: this.registry,
      cols: Math.max(20, this.terminal.cols),
      write: (text: string) => {
        this.terminal.write(text);
      },
      writeln: (text = '') => {
        this.terminal.writeln(text);
      },
      clear: () => {
        this.clearScreen();
      },
    };
  }

  private clearScreen(): void {
    this.terminal.write('\x1b[2J\x1b[3J\x1b[H');
    this.terminal.clear();
    this.renderedCursorRow = 0;
  }

  private writePrompt(): void {
    this.renderedCursorRow = 0;
    this.terminal.write(ansi.accent(PROMPT_TEXT));
  }

  private moveToLineEndBeforeNewline(): void {
    const cols = Math.max(1, this.terminal.cols);
    const promptWidth = stringDisplayWidth(PROMPT_TEXT);
    const totalWidth = promptWidth + stringDisplayWidth(this.editor.buffer);
    const endRow = totalWidth === 0 ? 0 : Math.floor((totalWidth - 1) / cols);
    const rowsDown = endRow - this.renderedCursorRow;
    if (rowsDown > 0) {
      this.terminal.write(`\x1b[${rowsDown}B`);
    }
  }

  private redrawLine(): void {
    const cols = Math.max(1, this.terminal.cols);
    const promptWidth = stringDisplayWidth(PROMPT_TEXT);
    const buffer = this.editor.buffer;
    const totalWidth = promptWidth + stringDisplayWidth(buffer);
    const cursorWidth =
      promptWidth + stringDisplayWidth(this.editor.beforeCursor());

    let seq = '';
    if (this.renderedCursorRow > 0) {
      seq += `\x1b[${this.renderedCursorRow}A`;
    }
    seq += `\r\x1b[J${ansi.accent(PROMPT_TEXT)}${buffer}`;

    const endRow = totalWidth === 0 ? 0 : Math.floor((totalWidth - 1) / cols);
    if (totalWidth > 0 && totalWidth % cols === 0 && cursorWidth === totalWidth) {
      this.renderedCursorRow = endRow;
      this.terminal.write(seq);
      return;
    }

    const targetRow = Math.floor(cursorWidth / cols);
    const targetCol = cursorWidth % cols;
    const rowsUp = endRow - targetRow;
    if (rowsUp > 0) {
      seq += `\x1b[${rowsUp}A`;
    } else if (rowsUp < 0) {
      seq += `\x1b[${-rowsUp}B`;
    }
    seq += '\r';
    if (targetCol > 0) {
      seq += `\x1b[${targetCol}C`;
    }

    this.renderedCursorRow = targetRow;
    this.terminal.write(seq);
  }
}
