import type { CommandDefinition } from '../shell/registry';

export const echoCommand: CommandDefinition = {
  name: 'echo',
  summary: 'Write arguments to standard output',
  usage: 'echo [-n] [...text]',
  manual: {
    description:
      'Prints the given arguments separated by single spaces followed by a newline. Useful for piping content into commands such as `note`.',
    options: [
      { flag: '-n', description: 'Do not output the trailing newline.' },
    ],
    examples: [
      'echo "buy coffee" | note new',
      'echo "updated text" | note 1',
      'echo -n "hello"',
    ],
  },

  execute(ctx, args) {
    if (args[0] === '-n') {
      ctx.write(args.slice(1).join(' '));
      return;
    }
    ctx.writeln(args.join(' '));
  },
};
