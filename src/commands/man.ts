import { ansi } from '../shell/ansi';
import type { CommandDefinition } from '../shell/registry';

export const manCommand: CommandDefinition = {
  name: 'man',
  summary: 'Display the manual page for a command',
  usage: 'man <command>',
  manual: {
    description:
      'Displays detailed documentation, options, examples, and notes for any registered shell command.',
    examples: ['man ls', 'man cd', 'man open'],
    notes: ['Press Tab after `man ` to complete registered command names.'],
  },

  execute(ctx, args) {
    if (args.length !== 1) {
      ctx.writeln('usage: man <command>');
      const names = ctx.registry.names().join(', ');
      if (names) {
        ctx.writeln(ansi.muted(`available manuals: ${names}`));
      }
      return;
    }

    const name = args[0]!;
    const cmd = ctx.registry.get(name);
    if (!cmd) {
      ctx.writeln(ansi.error(`No manual entry for ${name}`));
      return;
    }

    const manual = cmd.manual;

    ctx.writeln(ansi.bold('NAME'));
    ctx.writeln(`    ${ansi.accent(cmd.name)} - ${cmd.summary}`);
    ctx.writeln();

    ctx.writeln(ansi.bold('SYNOPSIS'));
    ctx.writeln(`    ${cmd.usage}`);
    ctx.writeln();

    ctx.writeln(ansi.bold('DESCRIPTION'));
    ctx.writeln(`    ${manual?.description ?? cmd.summary}`);

    if (manual?.options && manual.options.length > 0) {
      ctx.writeln();
      ctx.writeln(ansi.bold('OPTIONS'));
      const flagWidth = Math.max(...manual.options.map((opt) => opt.flag.length));
      for (const opt of manual.options) {
        ctx.writeln(
          `    ${ansi.accent(opt.flag.padEnd(flagWidth, ' '))}  ${opt.description}`,
        );
      }
    }

    if (manual?.examples && manual.examples.length > 0) {
      ctx.writeln();
      ctx.writeln(ansi.bold('EXAMPLES'));
      for (const example of manual.examples) {
        ctx.writeln(`    ${ansi.muted('$')} ${example}`);
      }
    }

    if (manual?.notes && manual.notes.length > 0) {
      ctx.writeln();
      ctx.writeln(ansi.bold('NOTES'));
      for (const note of manual.notes) {
        ctx.writeln(`    - ${note}`);
      }
    }
  },

  complete(ctx, args, currentToken) {
    if (args.length > 0) return [];
    return ctx.registry
      .list()
      .filter((cmd) => cmd.name.startsWith(currentToken))
      .map((cmd) => ({ value: cmd.name, label: cmd.summary }));
  },
};
