import type { CommandDefinition } from '../shell/registry';
import { sanitizeTerminalText } from '../shell/width';
import { rankVisitedUrls } from './openHistory';

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
const IPV6_BRACKETED_RE = /^\[[0-9a-f:.]+\](?::\d+)?(?:[/?#].*)?$/i;
const DOMAIN_RE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i;

function isValidBareIpv6Url(input: string): boolean {
  if (!IPV6_BRACKETED_RE.test(input)) return false;
  try {
    const parsed = new URL(`http://${input}`);
    return parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']');
  } catch {
    return false;
  }
}

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
    if (LOCALHOST_RE.test(first) || IPV4_RE.test(first) || isValidBareIpv6Url(first)) {
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
  completionMode: 'cycle',
  completeWholeArgs: true,
  inlineSuggest: true,
  manual: {
    description:
      'Opens a URL in a new active tab, automatically adding http:// for localhost/IP addresses and https:// for bare domains. Non-URL inputs fall back to your Chrome default search engine.',
    examples: [
      'open github.com',
      'open localhost:3000/api',
      'open https://docs.rs',
      'open xterm fit addon',
    ],
    notes: [
      'Type fragments after `open ` for live autojump-style history suggestions (ranked by recency and frequency). Press Tab or Right Arrow to accept, repeated Tab / Shift+Tab to cycle candidates, then Enter to open.',
      'Pressing Enter without accepting a suggestion keeps the default Chrome search fallback for non-URL queries.',
      'Allowed explicit schemes: http://, https://, chrome://, chrome-extension://, file://, about:.',
      'Blocks javascript: and data: schemes; always keeps the current terminal tab open.',
    ],
  },

  async execute(ctx, args) {
    const target = resolveOpenTarget(args);
    switch (target.kind) {
      case 'usage':
        ctx.writeError('usage: open <url | search query>');
        return;
      case 'error':
        ctx.writeError(target.message);
        return;
      case 'url':
        await ctx.adapter.openUrl(target.url);
        return;
      case 'search':
        await ctx.adapter.search(target.query);
        return;
    }
  },

  async complete(ctx, args, currentToken) {
    const query = [...args, currentToken].join(' ').trim();
    const visits = await ctx.adapter.listVisitedUrls();
    const ranked = rankVisitedUrls(visits, query);
    return ranked.map((entry) => {
      const cleanUrl = sanitizeTerminalText(entry.url);
      const cleanTitle = sanitizeTerminalText(entry.title).trim();
      return cleanTitle
        ? { value: cleanUrl, label: cleanTitle }
        : { value: cleanUrl };
    });
  },
};
