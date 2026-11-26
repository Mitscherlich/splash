import type { BrowserAdapter } from '../adapter/types';

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

export interface CommandContext {
  adapter: BrowserAdapter;
  registry: CommandRegistry;
  cols: number;
  write(text: string): void;
  writeln(text?: string): void;
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
