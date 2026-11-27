import { describe, expect, it } from 'vitest';
import {
  charDisplayWidth,
  padRightToWidth,
  sanitizeTerminalText,
  sliceByDisplayWidth,
  stringDisplayWidth,
  truncateToWidth,
} from '../src/shell/width';

describe('charDisplayWidth and stringDisplayWidth', () => {
  it('matches xterm UnicodeV6 widths for ASCII, CJK, emoji, and combining chars', () => {
    expect(charDisplayWidth('a'.codePointAt(0)!)).toBe(1);
    expect(charDisplayWidth('中'.codePointAt(0)!)).toBe(2);
    expect(charDisplayWidth('Ａ'.codePointAt(0)!)).toBe(2);
    expect(charDisplayWidth('한'.codePointAt(0)!)).toBe(2);
    expect(charDisplayWidth('🚀'.codePointAt(0)!)).toBe(1);
    expect(charDisplayWidth(0x303f)).toBe(1); // ideographic half fill space
    expect(charDisplayWidth(0x0301)).toBe(0); // combining acute accent
    expect(charDisplayWidth(0xe0100)).toBe(0); // variation selector supplement
    expect(charDisplayWidth(0x0000)).toBe(0);
  });

  it('computes total display width for mixed strings', () => {
    expect(stringDisplayWidth('hello')).toBe(5);
    expect(stringDisplayWidth('中文')).toBe(4);
    expect(stringDisplayWidth('hi中文!')).toBe(7);
    expect(stringDisplayWidth('🚀a')).toBe(2);
  });
});

describe('sanitizeTerminalText', () => {
  it('strips C0 and C1 terminal control bytes including ESC while keeping printable text', () => {
    expect(sanitizeTerminalText('Evil\x1b[2J\x1b]52;c;abc\x07标题\x9b31m')).toBe(
      'Evil[2J]52;c;abc标题31m',
    );
    expect(sanitizeTerminalText('line1\r\nline2\tcol')).toBe('line1 line2 col');
  });
});

describe('truncateToWidth', () => {
  it('returns string unchanged when within maxCols', () => {
    expect(truncateToWidth('GitHub', 10)).toBe('GitHub');
    expect(truncateToWidth('中文标题', 8)).toBe('中文标题');
  });

  it('truncates ASCII with ellipsis fitting within maxCols', () => {
    expect(truncateToWidth('abcdefghij', 6)).toBe('abcde…');
    expect(stringDisplayWidth(truncateToWidth('abcdefghij', 6))).toBe(6);
  });

  it('truncates mixed CJK without exceeding maxCols', () => {
    // '中'(2) + '文'(2) + '…'(1) = 5 <= 6; adding '标'(2) would be 7 > 6
    const result = truncateToWidth('中文标题测试', 6);
    expect(result).toBe('中文…');
    expect(stringDisplayWidth(result)).toBeLessThanOrEqual(6);
  });

  it('handles zero and 1-column bounds cleanly', () => {
    expect(truncateToWidth('abc', 0)).toBe('');
    expect(truncateToWidth('abc', -2)).toBe('');
    expect(truncateToWidth('abc', 1)).toBe('…');
    expect(truncateToWidth('a', 1)).toBe('a');
    expect(truncateToWidth('中', 1)).toBe('…');
  });
});

describe('padRightToWidth', () => {
  it('pads ASCII and CJK strings to exact column width', () => {
    expect(padRightToWidth('abc', 6)).toBe('abc   ');
    expect(padRightToWidth('中文', 6)).toBe('中文  ');
    expect(padRightToWidth('中文测试', 6)).toBe('中文测试');
  });
});

describe('sliceByDisplayWidth', () => {
  it('slices ASCII strings by start display column and max width', () => {
    expect(sliceByDisplayWidth('abcdefghij', 0, 5)).toBe('abcde');
    expect(sliceByDisplayWidth('abcdefghij', 3, 4)).toBe('defg');
    expect(sliceByDisplayWidth('abcdefghij', 8, 5)).toBe('ij');
    expect(sliceByDisplayWidth('abcdefghij', 20, 5)).toBe('');
  });

  it('handles CJK wide-char boundaries safely without exceeding maxCols', () => {
    // '中'(0..1) '文'(2..3) '测'(4..5) '试'(6..7)
    expect(sliceByDisplayWidth('中文测试', 0, 5)).toBe('中文');
    // startCol=1 splits '中' (cols 0..1), so pad 1 space for the trailing half, then '文'(2..3), '测'(4..5)
    const splitLeft = sliceByDisplayWidth('中文测试', 1, 5);
    expect(splitLeft).toBe(' 文测');
    expect(stringDisplayWidth(splitLeft)).toBe(5);
    // startCol=2 starts cleanly on '文'
    expect(sliceByDisplayWidth('中文测试', 2, 4)).toBe('文测');
  });
});
