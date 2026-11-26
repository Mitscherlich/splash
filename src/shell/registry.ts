import type { BrowserAdapter } from '../adapter/types';

export interface CompletionItem {
  value: string;
  label?: string;
}

export interface CommandContext {
  adapter: BrowserAdapter;
  registry: CommandRegistry;
  cols: number;
  write(text: string): void;
  writeln(text?: string): void;
  clear(): void;
}

export interface CommandDefinition {
  name: string;
  summary: string;
  usage: string;
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
