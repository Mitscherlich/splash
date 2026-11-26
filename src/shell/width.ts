// Aligned with @xterm/xterm 5.5.0 default UnicodeV6 width table.
const COMBINING_BMP_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x05c7, 0x05c7],
  [0x0600, 0x0603],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x070f, 0x070f],
  [0x0711, 0x0711],
  [0x0730, 0x074a],
  [0x07a6, 0x07b0],
  [0x07eb, 0x07f3],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x206a, 0x206f],
  [0x20d0, 0x20ff],
  [0x302a, 0x302f],
  [0x3099, 0x309a],
  [0xfb1e, 0xfb1e],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
];

const COMBINING_SUPP_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x10a01, 0x10a03],
  [0x10a05, 0x10a06],
  [0x10a0c, 0x10a0f],
  [0x10a38, 0x10a3a],
  [0x10a3f, 0x10a3f],
  [0x1d167, 0x1d169],
  [0x1d173, 0x1d182],
  [0x1d185, 0x1d18b],
  [0x1d1aa, 0x1d1ad],
  [0x1d242, 0x1d244],
  [0xe0001, 0xe0001],
  [0xe0020, 0xe007f],
  [0xe0100, 0xe01ef],
];

function inRanges(
  cp: number,
  ranges: ReadonlyArray<readonly [number, number]>,
): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = ranges[mid]!;
    if (cp < start) {
      hi = mid - 1;
    } else if (cp > end) {
      lo = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

function isUnicodeV6Wide(cp: number): boolean {
  if (cp < 0x1100) return false;
  if (cp < 0x10000) {
    if (cp === 0x303f) return false;
    return (
      (cp >= 0x1100 && cp <= 0x115f) ||
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6)
    );
  }
  return (
    (cp >= 0x20000 && cp <= 0x2fffd) ||
    (cp >= 0x30000 && cp <= 0x3fffd)
  );
}

export function charDisplayWidth(cp: number): number {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp < 0x7f) return 1;
  if (cp < 0x10000) {
    if (inRanges(cp, COMBINING_BMP_RANGES)) return 0;
    return isUnicodeV6Wide(cp) ? 2 : 1;
  }
  if (inRanges(cp, COMBINING_SUPP_RANGES)) return 0;
  return isUnicodeV6Wide(cp) ? 2 : 1;
}

export function stringDisplayWidth(str: string): number {
  let width = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) {
      width += charDisplayWidth(cp);
    }
  }
  return width;
}

export function sanitizeTerminalText(str: string): string {
  return str
    .replace(/\r\n|\r|\n|\t/g, ' ')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

export interface WrappedPosition {
  row: number;
  col: number;
  pendingWrap: boolean;
}

export function measureWrappedPosition(
  str: string,
  cols: number,
): WrappedPosition {
  const widthCols = Math.max(1, cols);
  let row = 0;
  let col = 0;
  let pendingWrap = false;

  for (const ch of str) {
    const cp = ch.codePointAt(0);
    const w = cp !== undefined ? charDisplayWidth(cp) : 0;
    if (w === 0) continue;

    if (pendingWrap) {
      row += 1;
      col = 0;
      pendingWrap = false;
    }

    if (w > 1 && col + w > widthCols && col > 0) {
      row += 1;
      col = 0;
    }

    col += w;
    if (col >= widthCols) {
      col = widthCols;
      pendingWrap = true;
    }
  }

  return { row, col, pendingWrap };
}

export function truncateToWidth(str: string, maxCols: number): string {
  if (maxCols <= 0) return '';
  if (stringDisplayWidth(str) <= maxCols) return str;
  if (maxCols === 1) return '…';

  const limit = maxCols - 1;
  let out = '';
  let used = 0;

  for (const ch of str) {
    const cp = ch.codePointAt(0);
    const w = cp !== undefined ? charDisplayWidth(cp) : 0;
    if (used + w > limit) {
      break;
    }
    out += ch;
    used += w;
  }

  return `${out}…`;
}

export function padRightToWidth(str: string, targetCols: number): string {
  const width = stringDisplayWidth(str);
  if (width >= targetCols) return str;
  return str + ' '.repeat(targetCols - width);
}
