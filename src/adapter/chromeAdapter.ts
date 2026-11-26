import { normalizeConfig, type SplashConfig } from '../config/schema';
import type { BrowserAdapter, TabInfo } from './types';

export const HISTORY_STORAGE_KEY = 'splash.history';
export const CONFIG_STORAGE_KEY = 'splash.config';

export interface ChromeApi {
  tabs: {
    query(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
    get(tabId: number): Promise<chrome.tabs.Tab>;
    getCurrent(): Promise<chrome.tabs.Tab | undefined>;
    update(
      tabId: number,
      updateProperties: chrome.tabs.UpdateProperties,
    ): Promise<chrome.tabs.Tab | undefined>;
    create(createProperties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab>;
  };
  windows: {
    getCurrent(): Promise<chrome.windows.Window>;
    update(
      windowId: number,
      updateInfo: chrome.windows.UpdateInfo,
    ): Promise<chrome.windows.Window>;
  };
  search: {
    query(queryInfo: chrome.search.QueryInfo): Promise<void>;
  };
  storage: {
    local: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    onChanged: {
      addListener(
        callback: (
          changes: Record<string, { newValue?: unknown }>,
          areaName: string,
        ) => void,
      ): void;
      removeListener(
        callback: (
          changes: Record<string, { newValue?: unknown }>,
          areaName: string,
        ) => void,
      ): void;
    };
  };
}

function toTabInfo(tab: chrome.tabs.Tab): TabInfo | null {
  if (typeof tab.id !== 'number') {
    return null;
  }
  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    active: tab.active,
    title: tab.title ?? '',
    url: tab.url ?? tab.pendingUrl ?? '',
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export class ChromeBrowserAdapter implements BrowserAdapter {
  private readonly api: ChromeApi;

  constructor(api: ChromeApi = chrome as unknown as ChromeApi) {
    this.api = api;
  }

  async getCurrentWindowId(): Promise<number> {
    const win = await this.api.windows.getCurrent();
    return win.id ?? -1;
  }

  async getCurrentTabId(): Promise<number | undefined> {
    const tab = await this.api.tabs.getCurrent();
    return typeof tab?.id === 'number' ? tab.id : undefined;
  }

  async listTabs(scope: 'all' | 'current'): Promise<TabInfo[]> {
    const raw = await this.api.tabs.query(
      scope === 'current' ? { currentWindow: true } : {},
    );
    const tabs: TabInfo[] = [];
    for (const item of raw) {
      const mapped = toTabInfo(item);
      if (mapped !== null) {
        tabs.push(mapped);
      }
    }
    return tabs;
  }

  async activateTab(tabId: number): Promise<'activated' | 'not_found'> {
    let target: chrome.tabs.Tab;
    try {
      target = await this.api.tabs.get(tabId);
    } catch {
      return 'not_found';
    }

    const currentWindowId = await this.getCurrentWindowId();
    try {
      await this.api.tabs.update(tabId, { active: true });
    } catch {
      return 'not_found';
    }

    if (target.windowId !== currentWindowId) {
      try {
        await this.api.windows.update(target.windowId, { focused: true });
      } catch {
        // Tab was already activated; ignore transient window focus errors
      }
    }

    return 'activated';
  }

  async openUrl(url: string): Promise<void> {
    await this.api.tabs.create({ url, active: true });
  }

  async search(query: string): Promise<void> {
    await this.api.search.query({ text: query, disposition: 'NEW_TAB' });
  }

  async loadHistory(): Promise<string[]> {
    const stored = await this.api.storage.local.get(HISTORY_STORAGE_KEY);
    return normalizeStringArray(stored[HISTORY_STORAGE_KEY]);
  }

  async saveHistory(entries: string[]): Promise<void> {
    await this.api.storage.local.set({ [HISTORY_STORAGE_KEY]: entries });
  }

  onHistoryChanged(listener: (entries: string[]) => void): () => void {
    const handler = (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      const change = changes[HISTORY_STORAGE_KEY];
      if (!change) return;
      listener(normalizeStringArray(change.newValue));
    };

    this.api.storage.onChanged.addListener(handler);
    return () => {
      this.api.storage.onChanged.removeListener(handler);
    };
  }

  async loadConfig(): Promise<SplashConfig> {
    const stored = await this.api.storage.local.get(CONFIG_STORAGE_KEY);
    return normalizeConfig(stored[CONFIG_STORAGE_KEY]);
  }

  async saveConfig(config: SplashConfig): Promise<void> {
    await this.api.storage.local.set({
      [CONFIG_STORAGE_KEY]: normalizeConfig(config),
    });
  }

  onConfigChanged(listener: (config: SplashConfig) => void): () => void {
    const handler = (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      const change = changes[CONFIG_STORAGE_KEY];
      if (!change) return;
      listener(normalizeConfig(change.newValue));
    };

    this.api.storage.onChanged.addListener(handler);
    return () => {
      this.api.storage.onChanged.removeListener(handler);
    };
  }
}
