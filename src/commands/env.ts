import type { CommandDefinition } from '../shell/registry';

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function formatSortedEnv(env: Readonly<Record<string, string>>): string[] {
  return Object.keys(env)
    .filter((key) => env[key] !== undefined && env[key] !== '')
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${env[key]!}`);
}

export const exportCommand: CommandDefinition = {
  name: 'export',
  summary: 'Set or list session environment variables',
  usage: 'export [KEY=VALUE ...]',
  manual: {
    description:
      'Sets session-scoped environment variables (overriding defaults in /etc/splash.d/config for this tab). With no arguments, prints all active non-empty environment variables.',
    examples: ['export EDITOR=vim', 'export', 'export EDITOR='],
    notes: [
      'Precedence: inline prefix (EDITOR=vim note 1) > session export/unset > /etc/splash.d/config (env.EDITOR).',
    ],
  },

  async execute(ctx, args) {
    if (args.length === 0) {
      for (const line of formatSortedEnv(ctx.envStore.getAll())) {
        ctx.writeln(line);
      }
      return;
    }

    for (const arg of args) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx <= 0) {
        ctx.writeError(`export: expected KEY=VALUE, got "${arg}"`);
        return;
      }
      const key = arg.slice(0, eqIdx);
      const value = arg.slice(eqIdx + 1);
      if (!ENV_KEY_RE.test(key)) {
        ctx.writeError(`export: invalid identifier: "${key}"`);
        return;
      }
      await ctx.envStore.set(key, value);
    }
  },
};

export const unsetCommand: CommandDefinition = {
  name: 'unset',
  summary: 'Unset session environment variables',
  usage: 'unset <KEY...>',
  manual: {
    description:
      'Removes one or more environment variables for the current session, including masking defaults loaded from /etc/splash.d/config.',
    examples: ['unset EDITOR', 'unset LANG'],
  },

  async execute(ctx, args) {
    if (args.length === 0) {
      ctx.writeError('usage: unset <KEY...>');
      return;
    }

    for (const key of args) {
      if (!ENV_KEY_RE.test(key)) {
        ctx.writeError(`unset: invalid identifier: "${key}"`);
        return;
      }
      await ctx.envStore.unset(key);
    }
  },
};

export const envCommand: CommandDefinition = {
  name: 'env',
  summary: 'Print effective environment variables',
  usage: 'env',
  manual: {
    description:
      'Displays all active non-empty environment variables for the current command invocation (including config defaults, session exports, and inline overrides).',
    examples: ['env', 'EDITOR=vim env'],
  },

  execute(ctx, args) {
    if (args.length > 0) {
      ctx.writeError('usage: env');
      return;
    }
    for (const line of formatSortedEnv(ctx.env)) {
      ctx.writeln(line);
    }
  },
};
