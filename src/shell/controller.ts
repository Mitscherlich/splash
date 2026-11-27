import type { BrowserAdapter } from '../adapter/types';
import { PROMPT_TEXT } from '../theme/defaultTheme';
import { ansi } from './ansi';
import { LineEditor } from './lineEditor';
import { parseCommandLine, parseCompletionContext } from './parser';
import type {
  CommandContext,
  CommandRegistry,
  CompletionItem,
  InteractiveSession,
  SessionIO,
} from './registry';
import { measureWrappedPosition, truncateToWidth } from './width';

export interface TerminalIO {
  readonly cols: number;
  readonly rows?: number;
  write(data: string): void;
  writeln(data: string): void;
  clear(): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onResize?(listener: (size: { cols: number; rows: number }) => void): {
    dispose(): void;
  };
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

const COMMAND_PREFIX_RE = /^\s*(?:'[^']*'|"[^"]*"|\S+)\s+/;

function splitCommandArgsPrefix(
  lineBeforeCursor: string,
): { prefixBeforeArgs: string; wholeArgs: string } | null {
  const match = COMMAND_PREFIX_RE.exec(lineBeforeCursor);
  if (!match) return null;
  return {
    prefixBeforeArgs: match[0],
    wholeArgs: lineBeforeCursor.slice(match[0].length),
  };
}

interface InlineSuggestionState {
  value: string;
  prefixBeforeToken: string;
  after: string;
}

interface CompletionCycleState {
  items: CompletionItem[];
  index: number;
  prefixBeforeToken: string;
  after: string;
}

export class ShellController {
  private readonly editor = new LineEditor();
  private renderedCursorRow = 0;
  private inlineSuggestion: InlineSuggestionState | null = null;
  private completionCycle: CompletionCycleState | null = null;
  private queue: Promise<void> = Promise.resolve();
  private sessionQueue: Promise<void> = Promise.resolve();
  private activeSession: {
    session: InteractiveSession;
    resolve: () => void;
  } | null = null;
  private dataSubscription: { dispose(): void } | null = null;
  private resizeSubscription: { dispose(): void } | null = null;
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

    this.resizeSubscription =
      this.terminal.onResize?.(({ cols, rows }) => {
        this.activeSession?.session.handleResize?.(cols, rows);
      }) ?? null;

    this.writePrompt();
  }

  dispose(): void {
    this.disposed = true;
    this.activeSession?.resolve();
    this.activeSession = null;
    this.dataSubscription?.dispose();
    this.dataSubscription = null;
    this.resizeSubscription?.dispose();
    this.resizeSubscription = null;
    this.unsubscribeHistory?.();
    this.unsubscribeHistory = null;
  }

  handleData(data: string): Promise<void> {
    if (this.disposed || !data) {
      return this.activeSession ? this.sessionQueue : this.queue;
    }
    if (this.activeSession) {
      const current = this.activeSession;
      this.sessionQueue = this.sessionQueue
        .then(async () => {
          if (!this.disposed && this.activeSession === current) {
            await current.session.handleData(data);
          }
        })
        .catch(() => {});
      return this.sessionQueue;
    }
    this.queue = this.queue.then(() => this.processData(data));
    return this.queue;
  }

  private async processData(data: string): Promise<void> {
    if (this.disposed) return;

    // Bracketed paste mode: \x1b[200~ ... \x1b[201~
    if (data.startsWith('\x1b[200~') && data.endsWith('\x1b[201~')) {
      const pasted = data.slice(6, -6);
      this.clearCompletionState();
      this.editor.paste(pasted);
      await this.refreshInlineSuggestion();
      this.redrawLine();
      return;
    }

    // Raw multi-line paste (newlines folded to spaces without executing)
    if (data.length > 1 && !data.startsWith('\x1b') && /[\r\n]/.test(data)) {
      this.clearCompletionState();
      this.editor.paste(data);
      await this.refreshInlineSuggestion();
      this.redrawLine();
      return;
    }

    let i = 0;
    while (i < data.length) {
      if (data[i] === '\x1b') {
        const consumed = await this.handleEscapeSequence(data, i);
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
        this.clearCompletionState();
        if (this.editor.backspace()) {
          await this.refreshInlineSuggestion();
          this.redrawLine();
        }
        i += 1;
        continue;
      }
      if (ch === '\x03') {
        // Ctrl+C
        this.clearGhostFromTerminal();
        this.clearCompletionState();
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
        this.clearCompletionState();
        if (this.editor.moveHome()) {
          await this.refreshInlineSuggestion();
          this.redrawLine();
        }
        i += 1;
        continue;
      }
      if (ch === '\x05') {
        // Ctrl+E
        this.clearCompletionState();
        if (this.editor.moveEnd()) {
          await this.refreshInlineSuggestion();
          this.redrawLine();
        }
        i += 1;
        continue;
      }
      if (ch === '\x15') {
        // Ctrl+U
        this.clearCompletionState();
        if (this.editor.killToStart()) {
          await this.refreshInlineSuggestion();
          this.redrawLine();
        }
        i += 1;
        continue;
      }
      if (ch === '\x0b') {
        // Ctrl+K
        this.clearCompletionState();
        if (this.editor.killToEnd()) {
          await this.refreshInlineSuggestion();
          this.redrawLine();
        }
        i += 1;
        continue;
      }
      if (ch === '\x17') {
        // Ctrl+W
        this.clearCompletionState();
        if (this.editor.killPrevWord()) {
          await this.refreshInlineSuggestion();
          this.redrawLine();
        }
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
      this.clearCompletionState();
      this.editor.insert(data.slice(i, end));
      await this.refreshInlineSuggestion();
      this.redrawLine();
      i = end;
    }
  }

  private async handleEscapeSequence(
    data: string,
    start: number,
  ): Promise<number> {
    const rest = data.slice(start);

    if (rest.startsWith('\x1b[Z')) {
      // Shift+Tab cycles backwards when a cycle completion session is active
      if (this.completionCycle) {
        this.stepCompletionCycle(-1);
      }
      return 3;
    }
    if (rest.startsWith('\x1b[A')) {
      this.clearCompletionState();
      if (this.editor.historyUp()) {
        await this.refreshInlineSuggestion();
        this.redrawLine();
      }
      return 3;
    }
    if (rest.startsWith('\x1b[B')) {
      this.clearCompletionState();
      if (this.editor.historyDown()) {
        await this.refreshInlineSuggestion();
        this.redrawLine();
      }
      return 3;
    }
    if (rest.startsWith('\x1b[C')) {
      this.completionCycle = null;
      if (this.editor.moveRight()) {
        await this.refreshInlineSuggestion();
        this.redrawLine();
      } else if (this.inlineSuggestion) {
        this.acceptInlineSuggestion();
      }
      return 3;
    }
    if (rest.startsWith('\x1b[D')) {
      this.clearCompletionState();
      if (this.editor.moveLeft()) {
        this.redrawLine();
      }
      return 3;
    }
    if (rest.startsWith('\x1b[H') || rest.startsWith('\x1bOH')) {
      this.clearCompletionState();
      if (this.editor.moveHome()) {
        await this.refreshInlineSuggestion();
        this.redrawLine();
      }
      return 3;
    }
    if (rest.startsWith('\x1b[F') || rest.startsWith('\x1bOF')) {
      this.clearCompletionState();
      if (this.editor.moveEnd()) {
        await this.refreshInlineSuggestion();
        this.redrawLine();
      }
      return 3;
    }
    if (rest.startsWith('\x1b[1~') || rest.startsWith('\x1b[7~')) {
      this.clearCompletionState();
      if (this.editor.moveHome()) {
        await this.refreshInlineSuggestion();
        this.redrawLine();
      }
      return 4;
    }
    if (rest.startsWith('\x1b[4~') || rest.startsWith('\x1b[8~')) {
      this.clearCompletionState();
      if (this.editor.moveEnd()) {
        await this.refreshInlineSuggestion();
        this.redrawLine();
      }
      return 4;
    }
    if (rest.startsWith('\x1b[3~')) {
      this.clearCompletionState();
      if (this.editor.deleteForward()) {
        await this.refreshInlineSuggestion();
        this.redrawLine();
      }
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
    this.clearGhostFromTerminal();
    this.clearCompletionState();
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

  private clearCompletionState(): void {
    this.completionCycle = null;
    this.inlineSuggestion = null;
  }

  private clearGhostFromTerminal(): void {
    if (this.inlineSuggestion !== null) {
      this.terminal.write('\x1b[K');
    }
  }

  private acceptInlineSuggestion(): void {
    const suggestion = this.inlineSuggestion;
    if (!suggestion) return;
    this.clearCompletionState();
    const nextBuffer = `${suggestion.prefixBeforeToken}${suggestion.value}${suggestion.after}`;
    const nextCursor = suggestion.prefixBeforeToken.length + suggestion.value.length;
    this.editor.setBuffer(nextBuffer, nextCursor);
    this.redrawLine();
  }

  private stepCompletionCycle(delta: 1 | -1): void {
    const cycle = this.completionCycle;
    if (!cycle || cycle.items.length === 0) return;
    const len = cycle.items.length;
    cycle.index = (cycle.index + delta + len) % len;
    const item = cycle.items[cycle.index]!;
    const nextBuffer = `${cycle.prefixBeforeToken}${item.value}${cycle.after}`;
    const nextCursor = cycle.prefixBeforeToken.length + item.value.length;
    this.inlineSuggestion = null;
    this.editor.setBuffer(nextBuffer, nextCursor);
    this.redrawLine();
  }

  private async refreshInlineSuggestion(): Promise<void> {
    if (this.disposed || this.completionCycle !== null) {
      this.inlineSuggestion = null;
      return;
    }
    const after = this.editor.afterCursor();
    if (after.length > 0) {
      this.inlineSuggestion = null;
      return;
    }

    const before = this.editor.beforeCursor();
    const compCtx = parseCompletionContext(before);
    if (!compCtx || compCtx.isCommand) {
      this.inlineSuggestion = null;
      return;
    }

    const cmd = this.registry.get(compCtx.command);
    if (!cmd?.complete || !cmd.inlineSuggest) {
      this.inlineSuggestion = null;
      return;
    }

    let prefixBeforeToken = before.slice(0, compCtx.tokenStart);
    let queryArgs = compCtx.args;
    let queryToken = compCtx.currentToken;

    if (cmd.completeWholeArgs) {
      const split = splitCommandArgsPrefix(before);
      if (!split) {
        this.inlineSuggestion = null;
        return;
      }
      prefixBeforeToken = split.prefixBeforeArgs;
      queryArgs = [];
      queryToken = split.wholeArgs;
    }

    if (queryToken.trim().length === 0) {
      this.inlineSuggestion = null;
      return;
    }

    const snapshotBuffer = this.editor.buffer;
    const snapshotCursor = this.editor.cursor;

    let items: CompletionItem[];
    try {
      items = await cmd.complete(
        this.createCommandContext(),
        queryArgs,
        queryToken,
      );
    } catch {
      this.inlineSuggestion = null;
      return;
    }

    if (
      this.disposed ||
      this.completionCycle !== null ||
      this.editor.buffer !== snapshotBuffer ||
      this.editor.cursor !== snapshotCursor
    ) {
      return;
    }

    const top = items[0];
    if (!top || top.value === queryToken.trim()) {
      this.inlineSuggestion = null;
      return;
    }

    this.inlineSuggestion = {
      value: top.value,
      prefixBeforeToken,
      after: '',
    };
  }

  private printCompletionTable(items: CompletionItem[]): void {
    this.clearGhostFromTerminal();
    this.moveToLineEndBeforeNewline();
    this.terminal.write('\r\n');
    this.renderedCursorRow = 0;

    const cols = Math.max(20, this.terminal.cols);
    const rawMaxValWidth = Math.max(...items.map((item) => item.value.length));
    const maxValCol = Math.max(20, Math.floor(cols * 0.65));
    const valWidth = Math.min(rawMaxValWidth, maxValCol);
    const labelBudget = cols - valWidth - 4;

    for (const item of items) {
      const displayedVal =
        item.value.length > valWidth
          ? truncateToWidth(item.value, valWidth)
          : item.value.padEnd(valWidth, ' ');
      const valText = ansi.accent(displayedVal);
      if (item.label && labelBudget >= 8) {
        const labelText = ansi.muted(truncateToWidth(item.label, labelBudget));
        this.terminal.writeln(`  ${valText}  ${labelText}`);
      } else {
        this.terminal.writeln(`  ${valText}`);
      }
    }
  }

  private async handleTabCompletion(): Promise<void> {
    if (this.completionCycle) {
      this.stepCompletionCycle(1);
      return;
    }

    const before = this.editor.beforeCursor();
    const after = this.editor.afterCursor();
    const compCtx = parseCompletionContext(before);
    if (!compCtx) return;

    let items: CompletionItem[] = [];
    let prefixBeforeToken = before.slice(0, compCtx.tokenStart);
    let completionMode: 'prefix' | 'cycle' = 'prefix';

    if (compCtx.isCommand) {
      items = this.registry
        .list()
        .filter((cmd) => cmd.name.startsWith(compCtx.currentToken))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((cmd) => ({ value: cmd.name, label: cmd.summary }));
    } else {
      const cmd = this.registry.get(compCtx.command);
      if (!cmd?.complete) return;
      completionMode = cmd.completionMode ?? 'prefix';

      let queryArgs = compCtx.args;
      let queryToken = compCtx.currentToken;
      if (cmd.completeWholeArgs) {
        const split = splitCommandArgsPrefix(before);
        if (!split) return;
        prefixBeforeToken = split.prefixBeforeArgs;
        queryArgs = [];
        queryToken = split.wholeArgs;
      }

      try {
        items = await cmd.complete(
          this.createCommandContext(),
          queryArgs,
          queryToken,
        );
      } catch {
        return;
      }
    }

    if (items.length === 0) return;

    if (completionMode === 'cycle') {
      const first = items[0]!;
      if (items.length > 1) {
        this.printCompletionTable(items);
        this.completionCycle = {
          items,
          index: 0,
          prefixBeforeToken,
          after,
        };
      } else {
        this.completionCycle = null;
      }
      this.inlineSuggestion = null;
      const nextBuffer = `${prefixBeforeToken}${first.value}${after}`;
      const nextCursor = prefixBeforeToken.length + first.value.length;
      this.editor.setBuffer(nextBuffer, nextCursor);
      this.redrawLine();
      return;
    }

    if (items.length === 1) {
      const only = items[0]!;
      const needsTrailingSpace =
        compCtx.isCommand && (after.length === 0 || !/^\s/.test(after));
      const inserted = needsTrailingSpace ? `${only.value} ` : only.value;
      const nextBuffer = `${prefixBeforeToken}${inserted}${after}`;
      const nextCursor = prefixBeforeToken.length + inserted.length;
      this.inlineSuggestion = null;
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

    this.printCompletionTable(items);
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
      runSession: (session: InteractiveSession) => this.runSession(session),
    };
  }

  private async runSession(session: InteractiveSession): Promise<void> {
    if (this.disposed) return;

    let done = false;
    let resolveSession!: () => void;
    const finished = new Promise<void>((resolve) => {
      resolveSession = () => {
        if (done) return;
        done = true;
        this.activeSession = null;
        resolve();
      };
    });

    this.activeSession = { session, resolve: resolveSession };
    this.sessionQueue = Promise.resolve();

    const io: SessionIO = {
      get cols() {
        return Math.max(20, terminal.cols);
      },
      get rows() {
        return Math.max(3, terminal.rows ?? 24);
      },
      write: (data: string) => {
        terminal.write(data);
      },
      exit: resolveSession,
    };
    const terminal = this.terminal;

    try {
      await session.start(io);
    } catch (err) {
      resolveSession();
      throw err;
    }

    await finished;
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
    const endPos = measureWrappedPosition(PROMPT_TEXT + this.editor.buffer, cols);
    const rowsDown = endPos.row - this.renderedCursorRow;
    if (rowsDown > 0) {
      this.terminal.write(`\x1b[${rowsDown}B`);
    }
  }

  private redrawLine(): void {
    const cols = Math.max(1, this.terminal.cols);
    const buffer = this.editor.buffer;
    const before = this.editor.beforeCursor();
    const endPos = measureWrappedPosition(PROMPT_TEXT + buffer, cols);

    let seq = '';
    if (this.renderedCursorRow > 0) {
      seq += `\x1b[${this.renderedCursorRow}A`;
    }
    seq += `\r\x1b[J${ansi.accent(PROMPT_TEXT)}${buffer}`;

    const atLineEnd = before.length === buffer.length;
    if (atLineEnd && endPos.pendingWrap) {
      this.renderedCursorRow = endPos.row;
      this.terminal.write(seq);
      return;
    }

    if (atLineEnd && this.inlineSuggestion) {
      const maxGhostWidth = cols - endPos.col - 1;
      if (maxGhostWidth >= 8) {
        const ghostText = truncateToWidth(
          `  → ${this.inlineSuggestion.value}`,
          maxGhostWidth,
        );
        seq += ansi.muted(ghostText);
        seq += '\r';
        if (endPos.col > 0) {
          seq += `\x1b[${endPos.col}C`;
        }
      }
      this.renderedCursorRow = endPos.row;
      this.terminal.write(seq);
      return;
    }

    const rawTarget = atLineEnd
      ? endPos
      : measureWrappedPosition(PROMPT_TEXT + before, cols);
    const targetRow =
      !atLineEnd && rawTarget.pendingWrap ? rawTarget.row + 1 : rawTarget.row;
    const targetCol = !atLineEnd && rawTarget.pendingWrap ? 0 : rawTarget.col;

    const rowsUp = endPos.row - targetRow;
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
