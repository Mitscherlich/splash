import type { ILinkHandler } from '@xterm/xterm';

const TAB_LINK_URI_RE = /^splash-tab:\/\/([1-9]\d*)$/;

export function parseTabLinkUri(uri: string): number | null {
  const match = TAB_LINK_URI_RE.exec(uri);
  if (!match) return null;
  return Number(match[1]);
}

export interface TabLinkHandlerOptions {
  hasSelection: () => boolean;
  activateTab: (tabId: number) => Promise<unknown>;
}

export function createTabLinkHandler(
  options: TabLinkHandlerOptions,
): ILinkHandler {
  return {
    allowNonHttpProtocols: true,
    activate(event, uri) {
      if (event.button !== 0 || options.hasSelection()) {
        return;
      }
      const tabId = parseTabLinkUri(uri);
      if (tabId === null) {
        return;
      }
      void options.activateTab(tabId).catch(() => {
        // Ignore transient tab closure errors when clicking stale ls output
      });
    },
  };
}

export interface CopyOnSelectOptions {
  getSelection: () => string;
  hasSelection: () => boolean;
  writeClipboard: (text: string) => Promise<void>;
}

export class CopyOnSelectController {
  private dragging = false;
  private selectionDirty = false;

  constructor(private readonly options: CopyOnSelectOptions) {}

  onMouseDown(): void {
    this.dragging = true;
    this.selectionDirty = false;
  }

  onSelectionChange(): void {
    if (this.dragging) {
      this.selectionDirty = true;
      return;
    }
    this.copyCurrentSelection();
  }

  onMouseUp(): void {
    const shouldCopy = this.dragging && this.selectionDirty;
    this.dragging = false;
    this.selectionDirty = false;
    if (shouldCopy) {
      this.copyCurrentSelection();
    }
  }

  private copyCurrentSelection(): void {
    if (!this.options.hasSelection()) return;
    const text = this.options.getSelection();
    if (!text) return;
    void this.options.writeClipboard(text).catch(() => {
      // Ignore clipboard permission/focus failures silently
    });
  }
}
