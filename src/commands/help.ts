import { ansi } from '../shell/ansi';
import type { CommandDefinition } from '../shell/registry';

export const helpCommand: CommandDefinition = {
  name: 'help',
  summary: 'Show available commands or usage for a command',
  usage: 'help [command]',
  manual: {
    description:
      'Lists all registered commands with one-line summaries, or prints concise usage for a specific command.',
    examples: ['help', 'help open'],
    notes: ['Use `man <command>` for full documentation, options, and examples.'],
  },

  execute(ctx, args) {
    if (args.length === 0) {
      const commands = ctx.registry.list();
      const nameWidth = Math.max(...commands.map((c) => c.name.length));
      for (const cmd of commands) {
        const name = ansi.accent(cmd.name.padEnd(nameWidth, ' '));
        ctx.writeln(`  ${name}  ${cmd.summary}`);
      }
      return;
    }

    const targetName = args[0]!;
    const cmd = ctx.registry.get(targetName);
    if (!cmd) {
      ctx.writeError(`help: unknown command: ${targetName}`);
      return;
    }

    ctx.writeln(`${ansi.accent(cmd.name)} — ${cmd.summary}`);
    ctx.writeln(`usage: ${cmd.usage}`);
  },

  complete(ctx, args, currentToken) {
    if (args.length > 0) return [];
    return ctx.registry
      .list()
      .filter((cmd) => cmd.name.startsWith(currentToken))
      .map((cmd) => ({ value: cmd.name, label: cmd.summary }));
  },
};
