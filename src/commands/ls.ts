import type { TabInfo } from '../adapter/types';
import { ansi } from '../shell/ansi';
import type { CommandDefinition } from '../shell/registry';
import { padRightToWidth, truncateToWidth } from '../shell/width';

const NARROW_VIEWPORT_COLS = 60;

function sortTabsForDisplay(tabs: TabInfo[], currentWindowId: number): TabInfo[] {
  return [...tabs].sort((a, b) => {
    const aCurrent = a.windowId === currentWindowId ? 0 : 1;
    const bCurrent = b.windowId === currentWindowId ? 0 : 1;
    if (aCurrent !== bCurrent) return aCurrent - bCurrent;
    if (a.windowId !== b.windowId) return a.windowId - b.windowId;
    return a.index - b.index;
  });
}

export const lsCommand: CommandDefinition = {
  name: 'ls',
  summary: 'List open Chrome tabs with their tab IDs',
  usage: 'ls [-c | --current]',

  async execute(ctx, args) {
    let scope: 'all' | 'current' = 'all';

    for (const arg of args) {
      if (arg === '-c' || arg === '--current') {
        scope = 'current';
      } else {
        ctx.writeln(ansi.error(`ls: unknown option: ${arg}`));
        return;
      }
    }

    const [currentWindowId, currentTabId, rawTabs] = await Promise.all([
      ctx.adapter.getCurrentWindowId(),
      ctx.adapter.getCurrentTabId(),
      ctx.adapter.listTabs(scope),
    ]);

    const tabs = sortTabsForDisplay(rawTabs, currentWindowId);
    if (tabs.length === 0) {
      ctx.writeln(ansi.muted('(no tabs)'));
      return;
    }

    const windowOrder: number[] = [];
    for (const tab of tabs) {
      if (!windowOrder.includes(tab.windowId)) {
        windowOrder.push(tab.windowId);
      }
    }
    const multiWindow = windowOrder.length > 1;
    const windowLabels = new Map<number, string>();
    windowOrder.forEach((winId, idx) => {
      windowLabels.set(winId, `W${idx + 1}`);
    });

    const idWidth = Math.max(...tabs.map((t) => String(t.id).length));
    const winTagWidth = multiWindow
      ? Math.max(...Array.from(windowLabels.values()).map((l) => l.length))
      : 0;

    // Prefix layout: [marker(1)] [sp(1)] [id(idWidth)] [optional sp(1)+winTag] [sp(2)]
    const prefixCols = 1 + 1 + idWidth + (multiWindow ? 1 + winTagWidth : 0) + 2;
    const available = Math.max(12, ctx.cols - prefixCols);
    const showUrl = ctx.cols >= NARROW_VIEWPORT_COLS && available >= 30;
    const titleCols = showUrl
      ? Math.max(16, Math.floor((available - 2) * 0.48))
      : available;
    const urlCols = showUrl ? Math.max(10, available - titleCols - 2) : 0;

    for (const tab of tabs) {
      const isCurrent =
        currentTabId !== undefined
          ? tab.id === currentTabId
          : tab.windowId === currentWindowId && tab.active;
      const marker = isCurrent ? ansi.active('*') : ' ';
      const idText = ansi.accent(String(tab.id).padStart(idWidth, ' '));
      const winPart = multiWindow
        ? ` ${ansi.muted((windowLabels.get(tab.windowId) ?? '').padEnd(winTagWidth, ' '))}`
        : '';

      const rawTitle = tab.title.trim() || '(untitled)';
      const titleText = truncateToWidth(rawTitle, titleCols);

      if (showUrl) {
        const paddedTitle = padRightToWidth(titleText, titleCols);
        const urlText = truncateToWidth(tab.url, urlCols);
        ctx.writeln(`${marker} ${idText}${winPart}  ${paddedTitle}  ${ansi.muted(urlText)}`);
      } else {
        ctx.writeln(`${marker} ${idText}${winPart}  ${titleText}`);
      }
    }
  },
};
