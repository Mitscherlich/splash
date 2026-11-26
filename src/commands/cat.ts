import { CONFIG_PATH, serializeConfig } from '../config/schema';
import { ansi } from '../shell/ansi';
import type { CommandDefinition } from '../shell/registry';

export const catCommand: CommandDefinition = {
  name: 'cat',
  summary: `Print Splash configuration (${CONFIG_PATH})`,
  usage: `cat ${CONFIG_PATH}`,
  manual: {
    description: `Displays the current normalized contents of ${CONFIG_PATH} without opening an editor.`,
    examples: [`cat ${CONFIG_PATH}`],
    notes: [`Use \`vim ${CONFIG_PATH}\` to edit and apply changes live.`],
  },

  async execute(ctx, args) {
    if (args.length !== 1) {
      ctx.writeln(`usage: cat ${CONFIG_PATH}`);
      return;
    }

    const targetPath = args[0]!;
    if (targetPath !== CONFIG_PATH) {
      ctx.writeln(ansi.error(`cat: ${targetPath}: No such file or directory`));
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
