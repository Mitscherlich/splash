import { describe, expect, it } from 'vitest';
import {
  charDisplayWidth,
  padRightToWidth,
  stringDisplayWidth,
  truncateToWidth,
} from '../src/shell/width';

describe('charDisplayWidth and stringDisplayWidth', () => {
  it('counts ASCII as 1, CJK/fullwidth/emoji as 2, and combining/control as 0', () => {
    expect(charDisplayWidth('a'.codePointAt(0)!)).toBe(1);
    expect(charDisplayWidth('中'.codePointAt(0)!)).toBe(2);
    expect(charDisplayWidth('Ａ'.codePointAt(0)!)).toBe(2);
    expect(charDisplayWidth('한'.codePointAt(0)!)).toBe(2);
    expect(charDisplayWidth('🚀'.codePointAt(0)!)).toBe(2);
    expect(charDisplayWidth(0x0301)).toBe(0); // combining acute accent
    expect(charDisplayWidth(0x0000)).toBe(0);
  });

  it('computes total display width for mixed strings', () => {
    expect(stringDisplayWidth('hello')).toBe(5);
    expect(stringDisplayWidth('中文')).toBe(4);
    expect(stringDisplayWidth('hi中文!')).toBe(7);
    expect(stringDisplayWidth('🚀a')).toBe(3);
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
