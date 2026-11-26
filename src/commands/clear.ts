import type { CommandDefinition } from '../shell/registry';

export const clearCommand: CommandDefinition = {
  name: 'clear',
  summary: 'Clear the terminal screen',
  usage: 'clear',

  execute(ctx) {
    ctx.clear();
  },
};
