import { describe, expect, it, vi } from 'vitest';
import { ChromeBrowserAdapter, HISTORY_STORAGE_KEY, type ChromeApi } from '../src/adapter/chromeAdapter';

function createChromeDouble() {
  const storageData: Record<string, unknown> = {};
  const storageListeners = new Set<
    (changes: Record<string, { newValue?: unknown }>, areaName: string) => void
  >();

  let currentWindowId = 10;
  let currentTab: Partial<chrome.tabs.Tab> | undefined = { id: 101, windowId: 10 };
  const tabs: Array<Partial<chrome.tabs.Tab>> = [
    { id: 101, windowId: 10, index: 0, active: true, title: 'splash', url: 'chrome://newtab' },
    { id: undefined, windowId: 10, index: 1, active: false, title: 'ghost', url: 'about:blank' },
    { id: 202, windowId: 20, index: 0, active: false, title: 'Docs', url: 'https://docs.rs' },
  ];

  const tabsQuery = vi.fn(async (queryInfo: chrome.tabs.QueryInfo) => {
    if (queryInfo.currentWindow) {
      return tabs.filter((t) => t.windowId === currentWindowId) as chrome.tabs.Tab[];
    }
    return [...tabs] as chrome.tabs.Tab[];
  });

  const tabsGet = vi.fn(async (tabId: number) => {
    const found = tabs.find((t) => t.id === tabId);
    if (!found) {
      throw new Error(`No tab with id: ${tabId}`);
    }
    return found as chrome.tabs.Tab;
  });

  const tabsGetCurrent = vi.fn(async () => currentTab as chrome.tabs.Tab | undefined);
  const tabsUpdate = vi.fn(async (tabId: number, props: chrome.tabs.UpdateProperties) => {
    const found = tabs.find((t) => t.id === tabId);
    if (!found) throw new Error(`No tab with id: ${tabId}`);
    if (props.active !== undefined) found.active = props.active;
    return found as chrome.tabs.Tab;
  });
  const tabsCreate = vi.fn(async (props: chrome.tabs.CreateProperties) => {
    return { id: 999, windowId: currentWindowId, index: 99, active: Boolean(props.active), url: props.url } as chrome.tabs.Tab;
  });

  const windowsGetCurrent = vi.fn(async () => ({ id: currentWindowId }) as chrome.windows.Window);
  const windowsUpdate = vi.fn(async (windowId: number, _info: chrome.windows.UpdateInfo) => {
    currentWindowId = windowId;
    return { id: windowId } as chrome.windows.Window;
  });

  const searchQuery = vi.fn(async (_info: chrome.search.QueryInfo) => undefined);

  const storageGet = vi.fn(async (keys: string | string[]) => {
    const list = Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const key of list) {
      if (key in storageData) result[key] = storageData[key];
    }
    return result;
  });
  const storageSet = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(storageData, items);
  });

  const api: ChromeApi = {
    tabs: {
      query: tabsQuery,
      get: tabsGet,
      getCurrent: tabsGetCurrent,
      update: tabsUpdate,
      create: tabsCreate,
    },
    windows: {
      getCurrent: windowsGetCurrent,
      update: windowsUpdate,
    },
    search: {
      query: searchQuery,
    },
    storage: {
      local: {
        get: storageGet,
        set: storageSet,
      },
      onChanged: {
        addListener: (fn) => storageListeners.add(fn),
        removeListener: (fn) => storageListeners.delete(fn),
      },
    },
  };

  return {
    api,
    spies: {
      tabsQuery,
      tabsGet,
      tabsUpdate,
      tabsCreate,
      windowsUpdate,
      searchQuery,
      storageGet,
      storageSet,
    },
    emitStorageChange(changes: Record<string, { newValue?: unknown }>, areaName: string) {
      for (const fn of storageListeners) {
        fn(changes, areaName);
      }
    },
    setCurrentTab(tab: Partial<chrome.tabs.Tab> | undefined) {
      currentTab = tab;
    },
  };
}

describe('ChromeBrowserAdapter', () => {
  it('filters out tabs without numeric id and scopes listTabs properly', async () => {
    const { api, spies } = createChromeDouble();
    const adapter = new ChromeBrowserAdapter(api);

    const all = await adapter.listTabs('all');
    expect(spies.tabsQuery).toHaveBeenCalledWith({});
    expect(all.map((t) => t.id)).toEqual([101, 202]);

    const current = await adapter.listTabs('current');
    expect(spies.tabsQuery).toHaveBeenCalledWith({ currentWindow: true });
    expect(current.map((t) => t.id)).toEqual([101]);
  });

  it('activates same-window tab without focusing window, and focuses window on cross-window cd', async () => {
    const { api, spies } = createChromeDouble();
    const adapter = new ChromeBrowserAdapter(api);

    // Same window (101 in window 10)
    expect(await adapter.activateTab(101)).toBe('activated');
    expect(spies.tabsUpdate).toHaveBeenCalledWith(101, { active: true });
    expect(spies.windowsUpdate).not.toHaveBeenCalled();

    // Cross window (202 in window 20)
    expect(await adapter.activateTab(202)).toBe('activated');
    expect(spies.tabsUpdate).toHaveBeenCalledWith(202, { active: true });
    expect(spies.windowsUpdate).toHaveBeenCalledWith(20, { focused: true });

    // Missing tab returns 'not_found' without throwing
    expect(await adapter.activateTab(999999)).toBe('not_found');

    // Race: tabs.get succeeds, then tab closes before tabs.update runs
    spies.tabsUpdate.mockRejectedValueOnce(new Error('Tab closed mid-flight'));
    expect(await adapter.activateTab(101)).toBe('not_found');
  });

  it('opens URLs in active new tab and routes search through chrome.search.query', async () => {
    const { api, spies } = createChromeDouble();
    const adapter = new ChromeBrowserAdapter(api);

    await adapter.openUrl('https://github.com');
    expect(spies.tabsCreate).toHaveBeenCalledWith({
      url: 'https://github.com',
      active: true,
    });

    await adapter.search('xterm fit addon');
    expect(spies.searchQuery).toHaveBeenCalledWith({
      text: 'xterm fit addon',
      disposition: 'NEW_TAB',
    });
  });

  it('loads, saves, subscribes, and unsubscribes splash.history in local storage only', async () => {
    const { api, emitStorageChange } = createChromeDouble();
    const adapter = new ChromeBrowserAdapter(api);

    expect(await adapter.loadHistory()).toEqual([]);

    await adapter.saveHistory(['ls', 'cd 202']);
    expect(await adapter.loadHistory()).toEqual(['ls', 'cd 202']);

    const received: string[][] = [];
    const unsubscribe = adapter.onHistoryChanged((entries) => {
      received.push(entries);
    });

    // Non-local storage area is ignored
    emitStorageChange({ [HISTORY_STORAGE_KEY]: { newValue: ['sync-only'] } }, 'sync');
    expect(received).toEqual([]);

    // Local storage update is delivered
    emitStorageChange({ [HISTORY_STORAGE_KEY]: { newValue: ['ls', 'open docs.rs'] } }, 'local');
    expect(received).toEqual([['ls', 'open docs.rs']]);

    // Unsubscribed listener receives nothing further
    unsubscribe();
    emitStorageChange({ [HISTORY_STORAGE_KEY]: { newValue: ['ls'] } }, 'local');
    expect(received).toEqual([['ls', 'open docs.rs']]);
  });
});
