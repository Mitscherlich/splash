import type { CommandDefinition } from '../shell/registry';

export const clearCommand: CommandDefinition = {
  name: 'clear',
  summary: 'Clear the terminal screen',
  usage: 'clear',
  manual: {
    description: 'Clears the visible terminal viewport and scrollback buffer.',
    examples: ['clear'],
    notes: ['Press Ctrl+L to clear the screen while keeping your current input line.'],
  },

  execute(ctx) {
    ctx.clear();
  },
};
