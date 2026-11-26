import { ansi } from '../shell/ansi';
import type { CommandDefinition } from '../shell/registry';

export type OpenTarget =
  | { kind: 'usage' }
  | { kind: 'error'; message: string }
  | { kind: 'url'; url: string }
  | { kind: 'search'; query: string };

const BLOCKED_SCHEME_RE = /^(javascript|data):/i;
const ALLOWED_SCHEME_RE = /^(?:(?:https?|chrome|chrome-extension|file):\/\/|about:)/i;
const LOCALHOST_RE = /^localhost(?::\d+)?(?:[/?#].*)?$/i;
const IPV4_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?::\d+)?(?:[/?#].*)?$/;
const DOMAIN_RE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i;

export function resolveOpenTarget(args: string[]): OpenTarget {
  if (args.length === 0) {
    return { kind: 'usage' };
  }

  const first = args[0]!.trim();
  if (BLOCKED_SCHEME_RE.test(first)) {
    return { kind: 'error', message: 'open: unsupported scheme' };
  }

  if (args.length === 1 && !/\s/.test(first) && first.length > 0) {
    if (ALLOWED_SCHEME_RE.test(first)) {
      return { kind: 'url', url: first };
    }
    if (LOCALHOST_RE.test(first) || IPV4_RE.test(first)) {
      return { kind: 'url', url: `http://${first}` };
    }
    if (DOMAIN_RE.test(first)) {
      return { kind: 'url', url: `https://${first}` };
    }
  }

  const query = args.join(' ').trim();
  if (!query) {
    return { kind: 'usage' };
  }
  return { kind: 'search', query };
}

export const openCommand: CommandDefinition = {
  name: 'open',
  summary: 'Open a URL or search query in a new tab',
  usage: 'open <url | search query>',

  async execute(ctx, args) {
    const target = resolveOpenTarget(args);
    switch (target.kind) {
      case 'usage':
        ctx.writeln('usage: open <url | search query>');
        return;
      case 'error':
        ctx.writeln(ansi.error(target.message));
        return;
      case 'url':
        await ctx.adapter.openUrl(target.url);
        return;
      case 'search':
        await ctx.adapter.search(target.query);
        return;
    }
  },
};
