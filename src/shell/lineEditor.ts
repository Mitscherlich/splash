export const MAX_HISTORY = 500;

export class LineEditor {
  private chars: string[] = [];
  private charCursor = 0;
  private history: string[] = [];
  private historyIndex: number | null = null;
  private draft = '';

  constructor(initialHistory: string[] = []) {
    this.setHistory(initialHistory);
  }

  get buffer(): string {
    return this.chars.join('');
  }

  get cursor(): number {
    return this.beforeCursor().length;
  }

  beforeCursor(): string {
    return this.chars.slice(0, this.charCursor).join('');
  }

  afterCursor(): string {
    return this.chars.slice(this.charCursor).join('');
  }

  insert(text: string): void {
    if (!text) return;
    const incoming = Array.from(text);
    this.chars.splice(this.charCursor, 0, ...incoming);
    this.charCursor += incoming.length;
  }

  paste(text: string): void {
    if (!text) return;
    const sanitized = text.replace(/\r\n|\r|\n/g, ' ');
    this.insert(sanitized);
  }

  backspace(): boolean {
    if (this.charCursor <= 0) return false;
    this.chars.splice(this.charCursor - 1, 1);
    this.charCursor -= 1;
    return true;
  }

  deleteForward(): boolean {
    if (this.charCursor >= this.chars.length) return false;
    this.chars.splice(this.charCursor, 1);
    return true;
  }

  moveLeft(): boolean {
    if (this.charCursor <= 0) return false;
    this.charCursor -= 1;
    return true;
  }

  moveRight(): boolean {
    if (this.charCursor >= this.chars.length) return false;
    this.charCursor += 1;
    return true;
  }

  moveHome(): boolean {
    if (this.charCursor === 0) return false;
    this.charCursor = 0;
    return true;
  }

  moveEnd(): boolean {
    if (this.charCursor === this.chars.length) return false;
    this.charCursor = this.chars.length;
    return true;
  }

  killToStart(): boolean {
    if (this.charCursor === 0) return false;
    this.chars.splice(0, this.charCursor);
    this.charCursor = 0;
    return true;
  }

  killToEnd(): boolean {
    if (this.charCursor >= this.chars.length) return false;
    this.chars.splice(this.charCursor);
    return true;
  }

  killPrevWord(): boolean {
    if (this.charCursor === 0) return false;
    let idx = this.charCursor;
    while (idx > 0 && /\s/.test(this.chars[idx - 1]!)) {
      idx -= 1;
    }
    while (idx > 0 && !/\s/.test(this.chars[idx - 1]!)) {
      idx -= 1;
    }
    if (idx === this.charCursor) return false;
    this.chars.splice(idx, this.charCursor - idx);
    this.charCursor = idx;
    return true;
  }

  setBuffer(text: string, cursorCodeUnit?: number): void {
    this.chars = Array.from(text);
    if (cursorCodeUnit === undefined || cursorCodeUnit >= text.length) {
      this.charCursor = this.chars.length;
      return;
    }
    if (cursorCodeUnit <= 0) {
      this.charCursor = 0;
      return;
    }
    let units = 0;
    let idx = 0;
    while (idx < this.chars.length && units < cursorCodeUnit) {
      units += this.chars[idx]!.length;
      idx += 1;
    }
    this.charCursor = idx;
  }

  reset(): void {
    this.chars = [];
    this.charCursor = 0;
    this.historyIndex = null;
    this.draft = '';
  }

  historyUp(): boolean {
    if (this.history.length === 0) return false;
    if (this.historyIndex === null) {
      this.draft = this.buffer;
      this.historyIndex = this.history.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex -= 1;
    } else {
      return false;
    }
    this.setBuffer(this.history[this.historyIndex]!);
    return true;
  }

  historyDown(): boolean {
    if (this.historyIndex === null) return false;
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex += 1;
      this.setBuffer(this.history[this.historyIndex]!);
    } else {
      this.historyIndex = null;
      this.setBuffer(this.draft);
    }
    return true;
  }

  recordHistory(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;
    const last = this.history[this.history.length - 1];
    if (last === trimmed) {
      return false;
    }
    this.history.push(trimmed);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(this.history.length - MAX_HISTORY);
    }
    this.historyIndex = null;
    this.draft = '';
    return true;
  }

  setHistory(entries: string[]): void {
    const normalized = entries
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    this.history =
      normalized.length > MAX_HISTORY
        ? normalized.slice(normalized.length - MAX_HISTORY)
        : normalized;
    if (this.historyIndex !== null) {
      this.historyIndex = null;
    }
  }

  getHistory(): string[] {
    return [...this.history];
  }
}
