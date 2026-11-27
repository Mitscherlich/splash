import { describe, expect, it } from 'vitest';
import {
  parseCommandLine,
  parseCompletionContext,
  parsePipeline,
} from '../src/shell/parser';

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

  it('targets active trailing pipeline stage and skips leading inline env assignments', () => {
    expect(parseCompletionContext('EDITOR=vim ')).toEqual({
      isCommand: true,
      command: '',
      args: [],
      currentToken: '',
      tokenStart: 11,
    });
    expect(parseCompletionContext('EDITOR=vim no')).toEqual({
      isCommand: true,
      command: '',
      args: [],
      currentToken: 'no',
      tokenStart: 11,
    });
    expect(parseCompletionContext('EDITOR=vim note 1')).toEqual({
      isCommand: false,
      command: 'note',
      args: [],
      currentToken: '1',
      tokenStart: 16,
    });
    expect(parseCompletionContext('echo hi | ')).toEqual({
      isCommand: true,
      command: '',
      args: [],
      currentToken: '',
      tokenStart: 10,
    });
    expect(parseCompletionContext('echo hi | EDITOR= note rm 2')).toEqual({
      isCommand: false,
      command: 'note',
      args: ['rm'],
      currentToken: '2',
      tokenStart: 26,
    });
    expect(parseCompletionContext('echo "a|b" ')).toEqual({
      isCommand: false,
      command: 'echo',
      args: ['a|b'],
      currentToken: '',
      tokenStart: 11,
    });
  });
});

describe('parsePipeline', () => {
  it('returns empty stages for empty or whitespace input', () => {
    expect(parsePipeline('')).toEqual({ ok: true, stages: [] });
    expect(parsePipeline('   \t ')).toEqual({ ok: true, stages: [] });
  });

  it('splits unquoted pipes while preserving quoted pipes and extracts leading inline env assignments', () => {
    expect(parsePipeline('EDITOR=vim echo "a|b" \'c|d\' | note 1')).toEqual({
      ok: true,
      stages: [
        {
          env: { EDITOR: 'vim' },
          command: 'echo',
          args: ['a|b', 'c|d'],
        },
        {
          env: {},
          command: 'note',
          args: ['1'],
        },
      ],
    });

    // Empty inline assignment and unspaced pipe
    expect(parsePipeline('echo hello|EDITOR= note 1')).toEqual({
      ok: true,
      stages: [
        { env: {}, command: 'echo', args: ['hello'] },
        { env: { EDITOR: '' }, command: 'note', args: ['1'] },
      ],
    });

    // Quoted key=value is treated as command/arg, not an env assignment; later key=value after command stays an arg
    expect(parsePipeline('echo EDITOR=vim')).toEqual({
      ok: true,
      stages: [{ env: {}, command: 'echo', args: ['EDITOR=vim'] }],
    });
    expect(parsePipeline('"EDITOR=vim" note 1')).toEqual({
      ok: true,
      stages: [{ env: {}, command: 'EDITOR=vim', args: ['note', '1'] }],
    });

    // Bare assignment stage without command (valid single stage for session env)
    expect(parsePipeline('EDITOR=vim FOO="bar baz"')).toEqual({
      ok: true,
      stages: [{ env: { EDITOR: 'vim', FOO: 'bar baz' }, command: null, args: [] }],
    });
  });

  it('rejects leading, trailing, adjacent pipes and assignment-only stages inside multi-stage pipelines', () => {
    for (const bad of ['| note 1', 'echo hi |', 'echo hi || note 1', 'echo hi |   | note 1']) {
      const res = parsePipeline(bad);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("'|'");
      }
    }

    const badMultiAssign = parsePipeline('EDITOR=vim | note 1');
    expect(badMultiAssign.ok).toBe(false);
  });
});
