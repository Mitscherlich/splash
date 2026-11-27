import type {
  BrowserAdapter,
  HistoryVisit,
  ListVisitedUrlsOptions,
  TabInfo,
} from '../src/adapter/types';
import { DEFAULT_CONFIG, normalizeConfig, type SplashConfig } from '../src/config/schema';

export class FakeBrowserAdapter implements BrowserAdapter {
  tabs: TabInfo[];
  currentWindowId: number;
  currentTabId: number | undefined;
  history: string[];
  visitedUrls: HistoryVisit[];
  config: SplashConfig;
  openedUrls: string[] = [];
  searches: string[] = [];
  activatedTabIds: number[] = [];
  private listeners = new Set<(entries: string[]) => void>();
  private configListeners = new Set<(config: SplashConfig) => void>();

  constructor(options?: {
    tabs?: TabInfo[];
    currentWindowId?: number;
    currentTabId?: number;
    history?: string[];
    visitedUrls?: HistoryVisit[];
    config?: SplashConfig;
  }) {
    this.tabs = options?.tabs ? options.tabs.map((t) => ({ ...t })) : [];
    this.currentWindowId = options?.currentWindowId ?? 1;
    this.currentTabId = options?.currentTabId;
    this.history = options?.history ? [...options.history] : [];
    this.visitedUrls = options?.visitedUrls
      ? options.visitedUrls.map((v) => ({ ...v }))
      : [];
    this.config = options?.config
      ? normalizeConfig(options.config)
      : normalizeConfig(DEFAULT_CONFIG);
  }

  async getCurrentWindowId(): Promise<number> {
    return this.currentWindowId;
  }

  async getCurrentTabId(): Promise<number | undefined> {
    return this.currentTabId;
  }

  async listTabs(scope: 'all' | 'current'): Promise<TabInfo[]> {
    const filtered =
      scope === 'current'
        ? this.tabs.filter((t) => t.windowId === this.currentWindowId)
        : this.tabs;
    return filtered.map((t) => ({ ...t }));
  }

  async activateTab(tabId: number): Promise<'activated' | 'not_found'> {
    const target = this.tabs.find((t) => t.id === tabId);
    if (!target) return 'not_found';
    for (const tab of this.tabs) {
      if (tab.windowId === target.windowId) {
        tab.active = tab.id === tabId;
      }
    }
    this.currentWindowId = target.windowId;
    this.activatedTabIds.push(tabId);
    return 'activated';
  }

  async openUrl(url: string): Promise<void> {
    this.openedUrls.push(url);
  }

  async search(query: string): Promise<void> {
    this.searches.push(query);
  }

  async listVisitedUrls(
    options?: ListVisitedUrlsOptions,
  ): Promise<HistoryVisit[]> {
    const startTime = options?.startTime ?? 0;
    const filtered = this.visitedUrls.filter((v) => v.lastVisitTime >= startTime);
    const limited =
      options?.maxResults !== undefined
        ? filtered.slice(0, options.maxResults)
        : filtered;
    return limited.map((v) => ({ ...v }));
  }

  async loadHistory(): Promise<string[]> {
    return [...this.history];
  }

  async saveHistory(entries: string[]): Promise<void> {
    this.history = [...entries];
  }

  onHistoryChanged(listener: (entries: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitExternalHistoryChange(entries: string[]): void {
    this.history = [...entries];
    for (const listener of this.listeners) {
      listener([...entries]);
    }
  }

  async loadConfig(): Promise<SplashConfig> {
    return normalizeConfig(this.config);
  }

  async saveConfig(config: SplashConfig): Promise<void> {
    const normalized = normalizeConfig(config);
    this.config = normalized;
    for (const listener of this.configListeners) {
      listener(normalizeConfig(normalized));
    }
  }

  onConfigChanged(listener: (config: SplashConfig) => void): () => void {
    this.configListeners.add(listener);
    return () => {
      this.configListeners.delete(listener);
    };
  }
}
