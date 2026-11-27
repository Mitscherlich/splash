import type { SplashConfig } from '../config/schema';

export interface TabInfo {
  id: number;
  windowId: number;
  index: number;
  active: boolean;
  title: string;
  url: string;
}

export interface HistoryVisit {
  url: string;
  title: string;
  visitCount: number;
  typedCount: number;
  lastVisitTime: number;
}

export interface ListVisitedUrlsOptions {
  maxResults?: number;
  startTime?: number;
}

export interface BrowserAdapter {
  getCurrentWindowId(): Promise<number>;
  getCurrentTabId(): Promise<number | undefined>;
  listTabs(scope: 'all' | 'current'): Promise<TabInfo[]>;
  activateTab(tabId: number): Promise<'activated' | 'not_found'>;
  openUrl(url: string): Promise<void>;
  search(query: string): Promise<void>;
  listVisitedUrls(options?: ListVisitedUrlsOptions): Promise<HistoryVisit[]>;
  loadHistory(): Promise<string[]>;
  saveHistory(entries: string[]): Promise<void>;
  onHistoryChanged(listener: (entries: string[]) => void): () => void;
  loadConfig(): Promise<SplashConfig>;
  saveConfig(config: SplashConfig): Promise<void>;
  onConfigChanged(listener: (config: SplashConfig) => void): () => void;
}
