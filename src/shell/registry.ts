import type { BrowserAdapter } from '../adapter/types';
import type { SupportedLocale } from '../i18n/locale';

export interface CompletionItem {
  value: string;
  label?: string;
}

export interface SessionIO {
  readonly cols: number;
  readonly rows: number;
  write(data: string): void;
  exit(): void;
}

export interface InteractiveSession {
  start(io: SessionIO): void | Promise<void>;
  handleData(data: string): void | Promise<void>;
  handleResize?(cols: number, rows: number): void;
}

export interface EnvStore {
  getAll(): Record<string, string>;
  set(key: string, value: string): void | Promise<void>;
  unset(key: string): void | Promise<void>;
}

export interface NoteGuiOptions {
  locale?: SupportedLocale;
}

export interface NoteVimEditorOptions {
  noteId: number | null;
  initialContent: string;
  locale?: SupportedLocale;
}

export interface NoteVimEditorResult {
  savedId: number | null;
}

export interface ShellOverlayHost {
  hasActiveOverlay?(): boolean;
  openNoteGui(adapter: BrowserAdapter, options?: NoteGuiOptions): Promise<void>;
  openNoteVimEditor(
    adapter: BrowserAdapter,
    options: NoteVimEditorOptions,
  ): Promise<NoteVimEditorResult>;
}

export interface CommandContext {
  adapter: BrowserAdapter;
  registry: CommandRegistry;
  cols: number;
  stdin?: string;
  isPipedOut: boolean;
  env: Readonly<Record<string, string>>;
  envStore: EnvStore;
  ui?: ShellOverlayHost;
  write(text: string): void;
  writeln(text?: string): void;
  writeError(text: string): void;
  clear(): void;
  runSession(session: InteractiveSession): Promise<void>;
}

export interface CommandManualOption {
  flag: string;
  description: string;
}

export interface CommandManual {
  description: string;
  options?: CommandManualOption[];
  examples?: string[];
  notes?: string[];
}

export interface CommandDefinition {
  name: string;
  summary: string;
  usage: string;
  manual?: CommandManual;
  completionMode?: 'prefix' | 'cycle';
  completeWholeArgs?: boolean;
  inlineSuggest?: boolean;
  execute(ctx: CommandContext, args: string[]): Promise<void> | void;
  complete?(
    ctx: CommandContext,
    args: string[],
    currentToken: string,
  ): Promise<CompletionItem[]> | CompletionItem[];
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  register(command: CommandDefinition): void {
    this.commands.set(command.name, command);
  }

  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  list(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  names(): string[] {
    return Array.from(this.commands.keys());
  }
}
