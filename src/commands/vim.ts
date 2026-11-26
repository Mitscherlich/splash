import {
  CONFIG_PATH,
  parseConfigText,
  serializeConfig,
} from '../config/schema';
import { ansi } from '../shell/ansi';
import type { CommandDefinition } from '../shell/registry';
import { VimSession } from '../shell/vimSession';

export const vimCommand: CommandDefinition = {
  name: 'vim',
  summary: `Edit Splash configuration (${CONFIG_PATH})`,
  usage: `vim ${CONFIG_PATH}`,
  manual: {
    description: `Opens an interactive alternate-screen Vim editor for ${CONFIG_PATH}. Saving validates the file and immediately hot-reloads the header animation across open Splash tabs.`,
    examples: [`vim ${CONFIG_PATH}`],
    notes: [
      'Normal mode: h/j/k/l or arrows, 0/$, gg/G, i/a/I/A/o/O, x, dd, u, ZZ, ZQ, :.',
      'Command mode: :w (save), :q (quit), :q! (force quit), :wq or :x (save & quit).',
      `Press Tab after \`vim \` to auto-complete ${CONFIG_PATH}.`,
    ],
  },

  async execute(ctx, args) {
    if (args.length !== 1) {
      ctx.writeln(`usage: vim ${CONFIG_PATH}`);
      return;
    }

    const targetPath = args[0]!;
    if (targetPath !== CONFIG_PATH) {
      ctx.writeln(ansi.error(`vim: only ${CONFIG_PATH} is editable`));
      return;
    }

    const currentConfig = await ctx.adapter.loadConfig();
    const initialContent = serializeConfig(currentConfig);

    const session = new VimSession({
      filePath: CONFIG_PATH,
      initialContent,
      onSave: async (content) => {
        const parsed = parseConfigText(content);
        if (!parsed.ok) {
          return { ok: false, error: parsed.error };
        }
        await ctx.adapter.saveConfig(parsed.config);
        return { ok: true, message: `"${CONFIG_PATH}" written` };
      },
    });

    await ctx.runSession(session);
  },

  complete(_ctx, args, currentToken) {
    if (args.length > 0) return [];
    if (CONFIG_PATH.startsWith(currentToken)) {
      return [{ value: CONFIG_PATH, label: 'Splash configuration file' }];
    }
    return [];
  },
};
