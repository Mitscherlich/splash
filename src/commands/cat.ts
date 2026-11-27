import { CONFIG_PATH, serializeConfig } from '../config/schema';
import { ansi } from '../shell/ansi';
import type { CommandDefinition } from '../shell/registry';

export const catCommand: CommandDefinition = {
  name: 'cat',
  summary: `Print Splash configuration (${CONFIG_PATH}) or piped stdin`,
  usage: `cat [${CONFIG_PATH}]`,
  manual: {
    description: `Displays the current normalized contents of ${CONFIG_PATH} without opening an editor, or passes piped standard input through when called with no arguments.`,
    examples: [`cat ${CONFIG_PATH}`, 'note 1 | cat'],
    notes: [`Use \`vim ${CONFIG_PATH}\` to edit and apply changes live.`],
  },

  async execute(ctx, args) {
    if (args.length === 0 && ctx.stdin !== undefined) {
      if (ctx.isPipedOut) {
        ctx.write(ctx.stdin);
      } else {
        ctx.write(ctx.stdin.replace(/\r?\n/g, '\r\n'));
        if (ctx.stdin.length > 0 && !ctx.stdin.endsWith('\n')) {
          ctx.write('\r\n');
        }
      }
      return;
    }

    if (args.length !== 1) {
      ctx.writeError(`usage: cat ${CONFIG_PATH}`);
      return;
    }

    const targetPath = args[0]!;
    if (targetPath !== CONFIG_PATH) {
      ctx.writeError(`cat: ${targetPath}: No such file or directory`);
      return;
    }

    const config = await ctx.adapter.loadConfig();
    for (const line of serializeConfig(config).split('\n')) {
      ctx.writeln(line.startsWith('#') ? ansi.muted(line) : line);
    }
  },

  complete(_ctx, args, currentToken) {
    if (args.length > 0) return [];
    if (CONFIG_PATH.startsWith(currentToken)) {
      return [{ value: CONFIG_PATH, label: 'Splash configuration file' }];
    }
    return [];
  },
};
