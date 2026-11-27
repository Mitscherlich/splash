import type { HistoryVisit } from '../adapter/types';

export const DEFAULT_OPEN_COMPLETION_LIMIT = 8;

export interface RankedVisit {
  url: string;
  title: string;
  score: number;
}

export interface RankVisitedUrlsOptions {
  now?: number;
  limit?: number;
}

const HTTP_SCHEME_RE = /^https?:\/\//i;
const STRIP_PREFIX_RE = /^https?:\/\/(?:www\.)?/i;

function canonicalizeHttpUrl(rawUrl: string): { url: string; host: string; pathSegments: string[] } | null {
  if (!HTTP_SCHEME_RE.test(rawUrl)) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const isBareRoot =
    parsed.pathname === '/' && !parsed.search && !parsed.hash;
  const canonical = isBareRoot ? rawUrl.replace(/\/+$/, '') : rawUrl;
  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  const pathSegments = parsed.pathname
    .toLowerCase()
    .split('/')
    .filter((segment) => segment.length > 0);

  return { url: canonical, host, pathSegments };
}

function recencyMultiplier(lastVisitTime: number, now: number): number {
  const ageHours = Math.max(0, (now - lastVisitTime) / 3_600_000);
  if (ageHours <= 1) return 4.0;
  if (ageHours <= 24) return 2.0;
  if (ageHours <= 168) return 1.0;
  if (ageHours <= 720) return 0.5;
  return 0.25;
}

function computeFrecency(visit: HistoryVisit, now: number): number {
  const frequency = Math.max(1, visit.visitCount) + Math.max(0, visit.typedCount) * 2;
  return frequency * recencyMultiplier(visit.lastVisitTime, now);
}

function subsequenceIndex(haystack: string, needle: string): number {
  if (needle.length < 2) return -1;
  let nIdx = 0;
  let firstPos = -1;
  for (let hIdx = 0; hIdx < haystack.length && nIdx < needle.length; hIdx++) {
    if (haystack[hIdx] === needle[nIdx]) {
      if (firstPos === -1) firstPos = hIdx;
      nIdx += 1;
    }
  }
  return nIdx === needle.length ? firstPos : -1;
}

interface TermMatch {
  weight: number;
  urlPos: number;
}

function matchTerm(
  term: string,
  host: string,
  pathSegments: string[],
  fullUrlLower: string,
  strippedUrl: string,
  titleLower: string,
): TermMatch | null {
  const noSchemeUrl = fullUrlLower.replace(HTTP_SCHEME_RE, '');
  const schemeNormalizedUrl = fullUrlLower.replace(/^(https?:\/\/)www\./i, '$1');
  if (
    fullUrlLower.startsWith(term) ||
    schemeNormalizedUrl.startsWith(term) ||
    noSchemeUrl.startsWith(term)
  ) {
    return { weight: 3.2, urlPos: 0 };
  }
  if (host.startsWith(term)) {
    return { weight: 3.0, urlPos: 0 };
  }
  if (strippedUrl.startsWith(term)) {
    return { weight: 2.5, urlPos: 0 };
  }
  const hostIdx = host.indexOf(term);
  if (hostIdx !== -1) {
    return { weight: 2.0, urlPos: hostIdx };
  }
  const urlIdx = strippedUrl.indexOf(term);
  if (urlIdx !== -1) {
    return { weight: 1.5, urlPos: urlIdx };
  }
  const fullIdx = fullUrlLower.indexOf(term);
  if (fullIdx !== -1) {
    return { weight: 1.4, urlPos: fullIdx };
  }
  if (titleLower.includes(term)) {
    return { weight: 1.2, urlPos: -1 };
  }
  const hostSubIdx = subsequenceIndex(host, term);
  if (hostSubIdx !== -1) {
    return { weight: hostSubIdx === 0 ? 1.4 : 1.0, urlPos: hostSubIdx };
  }
  let searchFrom = host.length;
  for (const segment of pathSegments) {
    const segSubIdx = subsequenceIndex(segment, term);
    if (segSubIdx !== -1) {
      const segStart = strippedUrl.indexOf(segment, searchFrom);
      return {
        weight: 0.7,
        urlPos: segStart !== -1 ? segStart + segSubIdx : searchFrom,
      };
    }
    const segPos = strippedUrl.indexOf(segment, searchFrom);
    if (segPos !== -1) {
      searchFrom = segPos + segment.length;
    }
  }
  return null;
}

interface DeduplicatedEntry {
  url: string;
  host: string;
  pathSegments: string[];
  title: string;
  visitCount: number;
  typedCount: number;
  lastVisitTime: number;
}

export function rankVisitedUrls(
  visits: HistoryVisit[],
  query: string,
  options?: RankVisitedUrlsOptions,
): RankedVisit[] {
  const now = options?.now ?? Date.now();
  const limit = options?.limit ?? DEFAULT_OPEN_COMPLETION_LIMIT;
  if (limit <= 0) {
    return [];
  }

  const deduped = new Map<string, DeduplicatedEntry>();
  for (const visit of visits) {
    const parsed = canonicalizeHttpUrl(visit.url);
    if (!parsed) continue;
    const existing = deduped.get(parsed.url);
    if (!existing) {
      deduped.set(parsed.url, {
        url: parsed.url,
        host: parsed.host,
        pathSegments: parsed.pathSegments,
        title: visit.title,
        visitCount: visit.visitCount,
        typedCount: visit.typedCount,
        lastVisitTime: visit.lastVisitTime,
      });
    } else {
      existing.visitCount += visit.visitCount;
      existing.typedCount += visit.typedCount;
      if (visit.lastVisitTime >= existing.lastVisitTime) {
        existing.lastVisitTime = visit.lastVisitTime;
        if (visit.title.trim()) {
          existing.title = visit.title;
        }
      } else if (!existing.title.trim() && visit.title.trim()) {
        existing.title = visit.title;
      }
    }
  }

  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);

  const scored: Array<RankedVisit & { lastVisitTime: number }> = [];

  for (const entry of deduped.values()) {
    const frecency = computeFrecency(entry, now);
    if (terms.length === 0) {
      scored.push({
        url: entry.url,
        title: entry.title,
        score: frecency,
        lastVisitTime: entry.lastVisitTime,
      });
      continue;
    }

    const fullUrlLower = entry.url.toLowerCase();
    const strippedUrl = entry.url.replace(STRIP_PREFIX_RE, '').toLowerCase();
    const titleLower = entry.title.toLowerCase();

    let weightSum = 0;
    let matchedAll = true;
    let prevPos = -1;
    let urlPositions = 0;
    let inOrder = true;

    for (const term of terms) {
      const m = matchTerm(
        term,
        entry.host,
        entry.pathSegments,
        fullUrlLower,
        strippedUrl,
        titleLower,
      );
      if (!m) {
        matchedAll = false;
        break;
      }
      weightSum += m.weight;
      if (m.urlPos >= 0) {
        if (urlPositions > 0 && m.urlPos < prevPos) {
          inOrder = false;
        }
        prevPos = m.urlPos;
        urlPositions += 1;
      }
    }

    if (!matchedAll) {
      continue;
    }

    const avgWeight = weightSum / terms.length;
    const orderBonus = terms.length > 1 && urlPositions >= 2 && inOrder ? 1.6 : 1.0;
    scored.push({
      url: entry.url,
      title: entry.title,
      score: frecency * avgWeight * orderBonus,
      lastVisitTime: entry.lastVisitTime,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.lastVisitTime !== a.lastVisitTime) return b.lastVisitTime - a.lastVisitTime;
    return a.url.localeCompare(b.url);
  });

  return scored.slice(0, limit).map(({ url, title, score }) => ({
    url,
    title,
    score,
  }));
}
