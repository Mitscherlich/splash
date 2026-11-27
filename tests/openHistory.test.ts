import { describe, expect, it } from 'vitest';
import type { HistoryVisit } from '../src/adapter/types';
import { rankVisitedUrls } from '../src/commands/openHistory';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 1_750_000_000_000;

describe('rankVisitedUrls (autojump frecency matcher)', () => {
  it('filters out non-http/https URLs and merges duplicate bare-origin entries', () => {
    const visits: HistoryVisit[] = [
      {
        url: 'chrome://newtab/',
        title: 'splash',
        visitCount: 500,
        typedCount: 100,
        lastVisitTime: NOW,
      },
      {
        url: 'chrome-extension://abcdef/newtab.html',
        title: 'splash',
        visitCount: 200,
        typedCount: 0,
        lastVisitTime: NOW,
      },
      {
        url: 'about:blank',
        title: '',
        visitCount: 50,
        typedCount: 0,
        lastVisitTime: NOW,
      },
      {
        url: 'https://github.com/',
        title: '',
        visitCount: 5,
        typedCount: 2,
        lastVisitTime: NOW - 2 * HOUR,
      },
      {
        url: 'https://github.com',
        title: 'GitHub',
        visitCount: 4,
        typedCount: 1,
        lastVisitTime: NOW - HOUR,
      },
      {
        url: 'http://localhost:3000/api',
        title: 'Local API',
        visitCount: 2,
        typedCount: 0,
        lastVisitTime: NOW - HOUR,
      },
    ];

    const ranked = rankVisitedUrls(visits, '', { now: NOW });
    expect(ranked.map((r) => r.url)).toEqual([
      'https://github.com',
      'http://localhost:3000/api',
    ]);
    expect(ranked[0]?.title).toBe('GitHub');
  });

  it('orders empty queries by frecency (recency decay + visit/typed frequency)', () => {
    const visits: HistoryVisit[] = [
      {
        url: 'https://old-popular.example',
        title: 'Old Popular',
        visitCount: 10,
        typedCount: 0,
        lastVisitTime: NOW - 40 * DAY,
      },
      {
        url: 'https://recent-clicked.example',
        title: 'Recent Clicked',
        visitCount: 4,
        typedCount: 0,
        lastVisitTime: NOW - 30 * 60_000,
      },
      {
        url: 'https://recent-typed.example',
        title: 'Recent Typed',
        visitCount: 4,
        typedCount: 3,
        lastVisitTime: NOW - 30 * 60_000,
      },
    ];

    const ranked = rankVisitedUrls(visits, '', { now: NOW });
    expect(ranked.map((r) => r.url)).toEqual([
      'https://recent-typed.example',
      'https://recent-clicked.example',
      'https://old-popular.example',
    ]);
  });

  it('matches ignoring https:// and www. and ranks host-prefix ahead of deep path matches', () => {
    const visits: HistoryVisit[] = [
      {
        url: 'https://docs.example.com/guide/github-actions',
        title: 'CI Guide',
        visitCount: 5,
        typedCount: 0,
        lastVisitTime: NOW - HOUR,
      },
      {
        url: 'https://www.github.com/m9ch/splash',
        title: 'Splash Repo',
        visitCount: 5,
        typedCount: 0,
        lastVisitTime: NOW - HOUR,
      },
    ];

    const ranked = rankVisitedUrls(visits, 'github', { now: NOW });
    expect(ranked.map((r) => r.url)).toEqual([
      'https://www.github.com/m9ch/splash',
      'https://docs.example.com/guide/github-actions',
    ]);
  });

  it('supports multi-keyword autojump queries and rejects entries missing any keyword', () => {
    const visits: HistoryVisit[] = [
      {
        url: 'https://github.com/m9ch/splash',
        title: 'Splash Terminal',
        visitCount: 8,
        typedCount: 2,
        lastVisitTime: NOW - HOUR,
      },
      {
        url: 'https://github.com/xtermjs/xterm.js',
        title: 'xterm.js',
        visitCount: 20,
        typedCount: 5,
        lastVisitTime: NOW - HOUR,
      },
      {
        url: 'https://splash.example.com/docs/github',
        title: 'Splash Mirror',
        visitCount: 8,
        typedCount: 2,
        lastVisitTime: NOW - HOUR,
      },
    ];

    const ranked = rankVisitedUrls(visits, 'gh splash', { now: NOW });
    expect(ranked.map((r) => r.url)).toEqual([
      'https://github.com/m9ch/splash',
      'https://splash.example.com/docs/github',
    ]);
  });

  it('supports host/path fuzzy subsequence matching and page title matching', () => {
    const visits: HistoryVisit[] = [
      {
        url: 'https://github.com/trending',
        title: 'Trending',
        visitCount: 6,
        typedCount: 1,
        lastVisitTime: NOW - HOUR,
      },
      {
        url: 'https://react.dev/learn',
        title: 'Quick Start - React Documentation',
        visitCount: 5,
        typedCount: 0,
        lastVisitTime: NOW - HOUR,
      },
      {
        url: 'https://example.org/hg-mirror',
        title: 'Mercurial',
        visitCount: 10,
        typedCount: 5,
        lastVisitTime: NOW - HOUR,
      },
    ];

    // 'gh' matches github.com as ordered subsequence, NOT hg-mirror (reversed order)
    const ghMatches = rankVisitedUrls(visits, 'gh', { now: NOW });
    expect(ghMatches.map((r) => r.url)).toEqual(['https://github.com/trending']);

    // Title match finds react.dev via 'documentation'
    const titleMatches = rankVisitedUrls(visits, 'documentation', { now: NOW });
    expect(titleMatches.map((r) => r.url)).toEqual(['https://react.dev/learn']);
  });

  it('caps results to the requested limit', () => {
    const visits: HistoryVisit[] = Array.from({ length: 15 }, (_, idx) => ({
      url: `https://site${idx}.example.com`,
      title: `Site ${idx}`,
      visitCount: idx + 1,
      typedCount: 0,
      lastVisitTime: NOW - HOUR,
    }));

    expect(rankVisitedUrls(visits, 'example', { now: NOW, limit: 5 })).toHaveLength(5);
    expect(rankVisitedUrls(visits, 'example', { now: NOW })).toHaveLength(8);
  });

  it('matches queries that include explicit http(s):// schemes or www. prefix', () => {
    const visits: HistoryVisit[] = [
      {
        url: 'https://www.github.com/m9ch/splash',
        title: 'Splash',
        visitCount: 8,
        typedCount: 2,
        lastVisitTime: NOW - HOUR,
      },
      {
        url: 'http://localhost:3000/api',
        title: 'Local API',
        visitCount: 4,
        typedCount: 1,
        lastVisitTime: NOW - HOUR,
      },
    ];

    expect(rankVisitedUrls(visits, 'https://git', { now: NOW }).map((r) => r.url)).toEqual([
      'https://www.github.com/m9ch/splash',
    ]);
    expect(rankVisitedUrls(visits, 'www.git', { now: NOW }).map((r) => r.url)).toEqual([
      'https://www.github.com/m9ch/splash',
    ]);
    expect(rankVisitedUrls(visits, 'http://local', { now: NOW }).map((r) => r.url)).toEqual([
      'http://localhost:3000/api',
    ]);
  });
});
