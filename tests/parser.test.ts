import { describe, expect, it } from 'vitest';
import { parseCommandLine, parseCompletionContext } from '../src/shell/parser';

describe('parseCommandLine', () => {
  it('returns empty tokens for empty or whitespace-only input', () => {
    expect(parseCommandLine('')).toEqual({ ok: true, tokens: [] });
    expect(parseCommandLine('   \t  ')).toEqual({ ok: true, tokens: [] });
  });

  it('splits whitespace-separated tokens', () => {
    expect(parseCommandLine('  ls   -c  ')).toEqual({
      ok: true,
      tokens: ['ls', '-c'],
    });
  });

  it('preserves spaces inside single and double quotes', () => {
    expect(parseCommandLine("open 'hello world'")).toEqual({
      ok: true,
      tokens: ['open', 'hello world'],
    });
    expect(parseCommandLine('open "typescript vitest"')).toEqual({
      ok: true,
      tokens: ['open', 'typescript vitest'],
    });
  });

  it('supports escaped characters inside double quotes and adjacent quoted parts', () => {
    expect(parseCommandLine('open "say \\"hi\\""')).toEqual({
      ok: true,
      tokens: ['open', 'say "hi"'],
    });
    expect(parseCommandLine('open foo"bar baz"')).toEqual({
      ok: true,
      tokens: ['open', 'foobar baz'],
    });
  });

  it('preserves explicit empty quoted arguments', () => {
    expect(parseCommandLine('open ""')).toEqual({
      ok: true,
      tokens: ['open', ''],
    });
  });

  it('returns an error on unclosed quotes', () => {
    const single = parseCommandLine("open 'unclosed");
    expect(single.ok).toBe(false);
    if (!single.ok) {
      expect(single.error).toContain('unclosed');
    }

    const dbl = parseCommandLine('open "unclosed');
    expect(dbl.ok).toBe(false);
  });
});

describe('parseCompletionContext', () => {
  it('identifies command position for empty input and partial first token', () => {
    expect(parseCompletionContext('')).toEqual({
      isCommand: true,
      command: '',
      args: [],
      currentToken: '',
      tokenStart: 0,
    });
    expect(parseCompletionContext('  c')).toEqual({
      isCommand: true,
      command: '',
      args: [],
      currentToken: 'c',
      tokenStart: 2,
    });
  });

  it('identifies argument position after command and trailing space', () => {
    expect(parseCompletionContext('cd ')).toEqual({
      isCommand: false,
      command: 'cd',
      args: [],
      currentToken: '',
      tokenStart: 3,
    });
    expect(parseCompletionContext('cd 12')).toEqual({
      isCommand: false,
      command: 'cd',
      args: [],
      currentToken: '12',
      tokenStart: 3,
    });
  });

  it('collects preceding args when completing later tokens', () => {
    expect(parseCompletionContext('open foo bar')).toEqual({
      isCommand: false,
      command: 'open',
      args: ['foo'],
      currentToken: 'bar',
      tokenStart: 9,
    });
  });

  it('returns null when cursor is inside an unclosed quote', () => {
    expect(parseCompletionContext('open "unclosed')).toBeNull();
  });
});
