import { ansi } from './ansi';
import type { InteractiveSession, SessionIO } from './registry';
import {
  charDisplayWidth,
  sliceByDisplayWidth,
  stringDisplayWidth,
  truncateToWidth,
} from './width';

export type VimSaveResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export interface VimSessionOptions {
  filePath: string;
  initialContent: string;
  useAltScreen?: boolean;
  onSave: (content: string) => Promise<VimSaveResult>;
}

type VimMode = 'normal' | 'insert' | 'command';

interface UndoSnapshot {
  lines: string[][];
  row: number;
  col: number;
}

const MAX_UNDO = 100;

export class VimSession implements InteractiveSession {
  private filePath: string;
  private readonly useAltScreen: boolean;
  private readonly onSave: (content: string) => Promise<VimSaveResult>;
  private io: SessionIO | null = null;
  private lines: string[][];
  private row = 0;
  private col = 0;
  private scrollTop = 0;
  private scrollLeft = 0;
  private mode: VimMode = 'normal';
  private dirty = false;
  private pendingKey: 'g' | 'd' | 'Z' | null = null;
  private commandBuffer = '';
  private message = '';
  private messageIsError = false;
  private undoStack: UndoSnapshot[] = [];
  private exited = false;

  constructor(options: VimSessionOptions) {
    this.filePath = options.filePath;
    this.useAltScreen = options.useAltScreen ?? true;
    this.onSave = options.onSave;
    const rawLines = options.initialContent.replace(/\r\n/g, '\n').split('\n');
    this.lines = rawLines.length > 0 ? rawLines.map((line) => Array.from(line)) : [[]];
  }

  start(io: SessionIO): void {
    this.io = io;
    this.io.write(this.useAltScreen ? '\x1b[?1049h\x1b[2J\x1b[H' : '\x1b[2J\x1b[H');
    this.render();
  }

  setFilePath(filePath: string): void {
    this.filePath = filePath;
    if (!this.exited && this.io) {
      this.render();
    }
  }

  handleResize(_cols: number, _rows: number): void {
    if (this.exited || !this.io) return;
    this.render();
  }

  async handleData(data: string): Promise<void> {
    if (this.exited || !this.io || !data) return;

    let i = 0;
    while (i < data.length && !this.exited) {
      if (data[i] === '\x1b') {
        const rest = data.slice(i);
        const seqLen = this.matchEscapeSequence(rest);
        if (seqLen > 1) {
          this.handleEscapeAction(rest.slice(0, seqLen));
          i += seqLen;
        } else {
          this.handleStandaloneEsc();
          i += 1;
        }
        continue;
      }

      const cp = data.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      i += ch.length;

      if (this.mode === 'normal') {
        await this.handleNormalKey(ch);
      } else if (this.mode === 'insert') {
        this.handleInsertKey(ch);
      } else {
        await this.handleCommandKey(ch);
      }
    }

    if (!this.exited) {
      this.render();
    }
  }

  private matchEscapeSequence(rest: string): number {
    if (
      rest.startsWith('\x1b[A') ||
      rest.startsWith('\x1b[B') ||
      rest.startsWith('\x1b[C') ||
      rest.startsWith('\x1b[D') ||
      rest.startsWith('\x1b[H') ||
      rest.startsWith('\x1b[F') ||
      rest.startsWith('\x1bOH') ||
      rest.startsWith('\x1bOF')
    ) {
      return 3;
    }
    if (
      rest.startsWith('\x1b[3~') ||
      rest.startsWith('\x1b[1~') ||
      rest.startsWith('\x1b[4~') ||
      rest.startsWith('\x1b[7~') ||
      rest.startsWith('\x1b[8~')
    ) {
      return 4;
    }
    if (rest.startsWith('\x1b[')) {
      let j = 2;
      while (j < rest.length) {
        const b = rest.charCodeAt(j);
        j += 1;
        if (b >= 0x40 && b <= 0x7e) break;
      }
      return j;
    }
    if (rest.startsWith('\x1bO') && rest.length >= 3) {
      return 3;
    }
    return 1;
  }

  private handleEscapeAction(seq: string): void {
    this.pendingKey = null;
    if (this.mode === 'command') {
      return;
    }

    if (seq === '\x1b[A') {
      this.moveVertical(-1);
    } else if (seq === '\x1b[B') {
      this.moveVertical(1);
    } else if (seq === '\x1b[D') {
      this.col = Math.max(0, this.col - 1);
    } else if (seq === '\x1b[C') {
      this.col = Math.min(this.maxColForMode(), this.col + 1);
    } else if (seq === '\x1b[H' || seq === '\x1bOH' || seq === '\x1b[1~' || seq === '\x1b[7~') {
      this.col = 0;
    } else if (seq === '\x1b[F' || seq === '\x1bOF' || seq === '\x1b[4~' || seq === '\x1b[8~') {
      this.col = this.maxColForMode();
    } else if (seq === '\x1b[3~') {
      if (this.mode === 'insert') {
        this.deleteForwardInInsert();
      } else {
        this.deleteCharNormal();
      }
    }
  }

  private handleStandaloneEsc(): void {
    this.pendingKey = null;
    if (this.mode === 'insert') {
      this.mode = 'normal';
      this.col = Math.min(this.col, this.maxColForMode());
      this.clearMessage();
    } else if (this.mode === 'command') {
      this.mode = 'normal';
      this.commandBuffer = '';
      this.clearMessage();
    }
  }

  private async handleNormalKey(ch: string): Promise<void> {
    if (ch === '\x03') {
      this.pendingKey = null;
      this.setMessage('Type :q<Enter> or :q!<Enter> to exit', false);
      return;
    }

    if (this.pendingKey !== null) {
      const first = this.pendingKey;
      this.pendingKey = null;

      if (first === 'g' && ch === 'g') {
        this.row = 0;
        this.col = Math.min(this.col, this.maxColForMode());
        return;
      }
      if (first === 'd' && ch === 'd') {
        this.deleteCurrentLine();
        return;
      }
      if (first === 'Z' && ch === 'Z') {
        await this.executeSave(true);
        return;
      }
      if (first === 'Z' && ch === 'Q') {
        this.exitEditor();
        return;
      }
      return;
    }

    this.clearMessage();

    switch (ch) {
      case 'h':
        this.col = Math.max(0, this.col - 1);
        return;
      case 'l':
        this.col = Math.min(this.maxColForMode(), this.col + 1);
        return;
      case 'j':
        this.moveVertical(1);
        return;
      case 'k':
        this.moveVertical(-1);
        return;
      case '0':
        this.col = 0;
        return;
      case '$':
        this.col = this.maxColForMode();
        return;
      case 'G':
        this.row = this.lines.length - 1;
        this.col = Math.min(this.col, this.maxColForMode());
        return;
      case 'g':
        this.pendingKey = 'g';
        return;
      case 'd':
        this.pendingKey = 'd';
        return;
      case 'Z':
        this.pendingKey = 'Z';
        return;
      case 'x':
        this.deleteCharNormal();
        return;
      case 'u':
        this.undo();
        return;
      case 'i':
        this.pushUndo();
        this.mode = 'insert';
        return;
      case 'a': {
        this.pushUndo();
        const lineLen = this.currentLine().length;
        this.col = Math.min(lineLen, this.col + (lineLen > 0 ? 1 : 0));
        this.mode = 'insert';
        return;
      }
      case 'I':
        this.pushUndo();
        this.col = 0;
        this.mode = 'insert';
        return;
      case 'A':
        this.pushUndo();
        this.col = this.currentLine().length;
        this.mode = 'insert';
        return;
      case 'o':
        this.pushUndo();
        this.lines.splice(this.row + 1, 0, []);
        this.row += 1;
        this.col = 0;
        this.dirty = true;
        this.mode = 'insert';
        return;
      case 'O':
        this.pushUndo();
        this.lines.splice(this.row, 0, []);
        this.col = 0;
        this.dirty = true;
        this.mode = 'insert';
        return;
      case ':':
        this.mode = 'command';
        this.commandBuffer = '';
        return;
    }
  }

  private handleInsertKey(ch: string): void {
    if (ch === '\x03') {
      this.handleStandaloneEsc();
      return;
    }

    if (ch === '\r' || ch === '\n') {
      const line = this.currentLine();
      const tail = line.splice(this.col);
      this.lines.splice(this.row + 1, 0, tail);
      this.row += 1;
      this.col = 0;
      this.dirty = true;
      return;
    }

    if (ch === '\x7f' || ch === '\b') {
      if (this.col > 0) {
        this.currentLine().splice(this.col - 1, 1);
        this.col -= 1;
        this.dirty = true;
      } else if (this.row > 0) {
        const current = this.lines.splice(this.row, 1)[0]!;
        this.row -= 1;
        const prev = this.currentLine();
        this.col = prev.length;
        prev.push(...current);
        this.dirty = true;
      }
      return;
    }

    const code = ch.codePointAt(0)!;
    if (code < 0x20) {
      return;
    }

    this.currentLine().splice(this.col, 0, ch);
    this.col += 1;
    this.dirty = true;
  }

  private async handleCommandKey(ch: string): Promise<void> {
    if (ch === '\x03') {
      this.handleStandaloneEsc();
      return;
    }

    if (ch === '\r' || ch === '\n') {
      const raw = this.commandBuffer.trim();
      this.commandBuffer = '';
      this.mode = 'normal';
      await this.executeCommand(raw);
      return;
    }

    if (ch === '\x7f' || ch === '\b') {
      if (this.commandBuffer.length > 0) {
        const chars = Array.from(this.commandBuffer);
        chars.pop();
        this.commandBuffer = chars.join('');
      } else {
        this.mode = 'normal';
      }
      return;
    }

    const code = ch.codePointAt(0)!;
    if (code >= 0x20) {
      this.commandBuffer += ch;
    }
  }

  private async executeCommand(cmd: string): Promise<void> {
    if (!cmd) return;

    switch (cmd) {
      case 'w':
        await this.executeSave(false);
        return;
      case 'q':
        if (this.dirty) {
          this.setMessage(
            'E37: No write since last change (add ! to override)',
            true,
          );
        } else {
          this.exitEditor();
        }
        return;
      case 'q!':
        this.exitEditor();
        return;
      case 'wq':
      case 'x':
        await this.executeSave(true);
        return;
      default:
        this.setMessage(`E492: Not an editor command: ${cmd}`, true);
        return;
    }
  }

  private async executeSave(quitAfter: boolean): Promise<void> {
    const content = this.lines.map((line) => line.join('')).join('\n');
    let result: VimSaveResult;
    try {
      result = await this.onSave(content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setMessage(msg, true);
      return;
    }

    if (!result.ok) {
      this.setMessage(result.error, true);
      return;
    }

    this.dirty = false;
    this.setMessage(result.message ?? `"${this.filePath}" written`, false);
    if (quitAfter) {
      this.exitEditor();
    }
  }

  private deleteCharNormal(): void {
    const line = this.currentLine();
    if (line.length === 0) return;
    this.pushUndo();
    line.splice(this.col, 1);
    this.col = Math.min(this.col, this.maxColForMode());
    this.dirty = true;
  }

  private deleteForwardInInsert(): void {
    const line = this.currentLine();
    if (this.col < line.length) {
      line.splice(this.col, 1);
      this.dirty = true;
    } else if (this.row + 1 < this.lines.length) {
      const next = this.lines.splice(this.row + 1, 1)[0]!;
      line.push(...next);
      this.dirty = true;
    }
  }

  private deleteCurrentLine(): void {
    this.pushUndo();
    if (this.lines.length === 1) {
      this.lines[0] = [];
      this.col = 0;
    } else {
      this.lines.splice(this.row, 1);
      if (this.row >= this.lines.length) {
        this.row = this.lines.length - 1;
      }
      this.col = Math.min(this.col, this.maxColForMode());
    }
    this.dirty = true;
  }

  private pushUndo(): void {
    this.undoStack.push({
      lines: this.lines.map((line) => [...line]),
      row: this.row,
      col: this.col,
    });
    if (this.undoStack.length > MAX_UNDO) {
      this.undoStack.shift();
    }
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) {
      this.setMessage('Already at oldest change', false);
      return;
    }
    this.lines = prev.lines;
    this.row = Math.min(prev.row, this.lines.length - 1);
    this.col = Math.min(prev.col, this.maxColForMode());
    this.dirty = true;
  }

  private moveVertical(delta: number): void {
    const nextRow = Math.max(0, Math.min(this.lines.length - 1, this.row + delta));
    this.row = nextRow;
    this.col = Math.min(this.col, this.maxColForMode());
  }

  private currentLine(): string[] {
    return this.lines[this.row]!;
  }

  private maxColForMode(): number {
    const len = this.currentLine().length;
    if (this.mode === 'insert') return len;
    return len > 0 ? len - 1 : 0;
  }

  private setMessage(msg: string, isError: boolean): void {
    this.message = msg;
    this.messageIsError = isError;
  }

  private clearMessage(): void {
    this.message = '';
    this.messageIsError = false;
  }

  private exitEditor(): void {
    if (this.exited) return;
    this.exited = true;
    if (this.useAltScreen) {
      this.io?.write('\x1b[?1049l');
    }
    this.io?.exit();
  }

  private render(): void {
    if (!this.io) return;
    const cols = Math.max(10, this.io.cols);
    const rows = Math.max(3, this.io.rows);
    const contentRows = Math.max(1, rows - 2);

    if (this.row < this.scrollTop) {
      this.scrollTop = this.row;
    } else if (this.row >= this.scrollTop + contentRows) {
      this.scrollTop = this.row - contentRows + 1;
    }

    const numWidth = Math.max(2, String(this.lines.length).length);
    const gutterWidth = numWidth + 1;
    const textCols = Math.max(1, cols - gutterWidth);

    const activeLine = this.currentLine();
    const beforeCursor = activeLine.slice(0, this.col).join('');
    const cursorDisplayCol = stringDisplayWidth(beforeCursor);
    const charAtCursor =
      this.mode !== 'insert' && this.col < activeLine.length
        ? activeLine[this.col]
        : undefined;
    const cursorCharWidth =
      charAtCursor !== undefined
        ? Math.max(1, charDisplayWidth(charAtCursor.codePointAt(0)!))
        : 1;

    if (cursorDisplayCol < this.scrollLeft) {
      this.scrollLeft = cursorDisplayCol;
    } else if (cursorDisplayCol + cursorCharWidth > this.scrollLeft + textCols) {
      this.scrollLeft = Math.max(
        0,
        cursorDisplayCol + cursorCharWidth - textCols,
      );
    }

    let out = '\x1b[?25l';

    for (let r = 0; r < contentRows; r++) {
      const lineIdx = this.scrollTop + r;
      const screenRow = r + 1;
      out += `\x1b[${screenRow};1H\x1b[2K`;

      if (lineIdx < this.lines.length) {
        const lineNum = String(lineIdx + 1).padStart(numWidth, ' ');
        const text = this.lines[lineIdx]!.join('');
        const visible = sliceByDisplayWidth(text, this.scrollLeft, textCols);
        out += `${ansi.muted(lineNum)} ${visible}`;
      } else {
        out += ansi.muted('~');
      }
    }

    // Status bar at row (rows - 1)
    const statusRow = rows - 1;
    const modeLabel = this.mode.toUpperCase();
    const dirtyFlag = this.dirty ? ' [+]' : '';
    const leftStatus = ` ${modeLabel} | ${this.filePath}${dirtyFlag}`;
    const rightStatus = `${this.row + 1}:${this.col + 1} `;
    const leftBudget = Math.max(1, cols - rightStatus.length);
    const leftText = truncateToWidth(leftStatus, leftBudget);
    const padLen = Math.max(0, cols - stringDisplayWidth(leftText) - rightStatus.length);
    const statusLine = `${leftText}${' '.repeat(padLen)}${rightStatus}`;
    out += `\x1b[${statusRow};1H\x1b[2K\x1b[7m${statusLine}\x1b[0m`;

    // Command / message bar at row (rows)
    out += `\x1b[${rows};1H\x1b[2K`;
    if (this.mode === 'command') {
      out += truncateToWidth(`:${this.commandBuffer}`, cols);
    } else if (this.message) {
      const msgText = truncateToWidth(this.message, cols);
      out += this.messageIsError ? ansi.error(msgText) : ansi.muted(msgText);
    }

    // Cursor positioning
    if (this.mode === 'command') {
      const cmdCol = Math.min(cols, 2 + stringDisplayWidth(this.commandBuffer));
      out += `\x1b[${rows};${cmdCol}H\x1b[?25h`;
    } else {
      const cursorRow = Math.max(1, Math.min(contentRows, this.row - this.scrollTop + 1));
      const cursorCol = Math.max(
        gutterWidth + 1,
        Math.min(cols, gutterWidth + 1 + (cursorDisplayCol - this.scrollLeft)),
      );
      out += `\x1b[${cursorRow};${cursorCol}H\x1b[?25h`;
    }

    this.io.write(out);
  }
}
