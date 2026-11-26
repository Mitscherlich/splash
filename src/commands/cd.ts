import { ansi } from '../shell/ansi';
import type { CommandDefinition } from '../shell/registry';

const POSITIVE_INT_RE = /^[1-9]\d*$/;

export const cdCommand: CommandDefinition = {
  name: 'cd',
  summary: 'Switch to a tab by its exact Chrome tab ID',
  usage: 'cd <tabId>',

  async execute(ctx, args) {
    if (args.length === 0) {
      ctx.writeln('usage: cd <tabId>  (hint: press Tab to complete)');
      return;
    }

    if (args.length > 1) {
      ctx.writeln(ansi.error(`cd: invalid tab id: ${args.join(' ')}`));
      return;
    }

    const raw = args[0]!;
    if (!POSITIVE_INT_RE.test(raw)) {
      ctx.writeln(ansi.error(`cd: invalid tab id: ${raw}`));
      return;
    }

    const tabId = Number(raw);
    const currentTabId = await ctx.adapter.getCurrentTabId();
    if (currentTabId !== undefined && tabId === currentTabId) {
      return;
    }

    const status = await ctx.adapter.activateTab(tabId);
    if (status === 'not_found') {
      ctx.writeln(ansi.error(`cd: tab not found: ${tabId}`));
    }
  },

  async complete(ctx, args, currentToken) {
    if (args.length > 0) {
      return [];
    }

    const [currentWindowId, tabs] = await Promise.all([
      ctx.adapter.getCurrentWindowId(),
      ctx.adapter.listTabs('all'),
    ]);

    const ordered = [...tabs].sort((a, b) => {
      const aCur = a.windowId === currentWindowId ? 0 : 1;
      const bCur = b.windowId === currentWindowId ? 0 : 1;
      if (aCur !== bCur) return aCur - bCur;
      if (a.windowId !== b.windowId) return a.windowId - b.windowId;
      return a.index - b.index;
    });

    return ordered
      .filter((tab) => String(tab.id).startsWith(currentToken))
      .map((tab) => ({
        value: String(tab.id),
        label: tab.title.trim() || '(untitled)',
      }));
  },
};
