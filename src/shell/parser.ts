export type ParseResult =
  | { ok: true; tokens: string[] }
  | { ok: false; error: string };

export interface ParsedStage {
  env: Record<string, string>;
  command: string | null;
  args: string[];
}

export type PipelineParseResult =
  | { ok: true; stages: ParsedStage[] }
  | { ok: false; error: string };

export interface CompletionContext {
  isCommand: boolean;
  command: string;
  args: string[];
  currentToken: string;
  tokenStart: number;
}

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface WordToken {
  kind: 'word';
  value: string;
  start: number;
  end: number;
  assignment: { key: string; value: string } | null;
}

interface PipeToken {
  kind: 'pipe';
  start: number;
  end: number;
}

type LexToken = WordToken | PipeToken;

function lexInput(
  input: string,
  options?: { splitPipes?: boolean },
): { ok: true; tokens: LexToken[] } | { ok: false; error: string } {
  const splitPipes = options?.splitPipes ?? false;
  const tokens: LexToken[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    while (i < len && /\s/.test(input[i]!)) {
      i++;
    }
    if (i >= len) break;

    if (splitPipes && input[i] === '|') {
      tokens.push({ kind: 'pipe', start: i, end: i + 1 });
      i += 1;
      continue;
    }

    const start = i;
    let current = '';
    let quote: "'" | '"' | null = null;
    let sawQuoteBeforeEq = false;
    let assignmentKey: string | null = null;
    let sawUnquotedEq = false;

    while (i < len) {
      const ch = input[i]!;

      if (quote === "'") {
        if (ch === "'") {
          quote = null;
          i++;
        } else {
          current += ch;
          i++;
        }
        continue;
      }

      if (quote === '"') {
        if (ch === '\\' && i + 1 < len) {
          const next = input[i + 1]!;
          if (next === '"' || next === '\\') {
            current += next;
            i += 2;
            continue;
          }
        }
        if (ch === '"') {
          quote = null;
          i++;
        } else {
          current += ch;
          i++;
        }
        continue;
      }

      if (/\s/.test(ch) || (splitPipes && ch === '|')) {
        break;
      }

      if (ch === "'" || ch === '"') {
        if (!sawUnquotedEq) {
          sawQuoteBeforeEq = true;
        }
        quote = ch;
        i++;
        continue;
      }

      if (ch === '=' && !sawUnquotedEq) {
        sawUnquotedEq = true;
        if (!sawQuoteBeforeEq && ENV_KEY_RE.test(current)) {
          assignmentKey = current;
        }
      }

      current += ch;
      i++;
    }

    if (quote !== null) {
      return {
        ok: false,
        error: `syntax error: unclosed quote (${quote})`,
      };
    }

    const assignment =
      assignmentKey !== null
        ? { key: assignmentKey, value: current.slice(assignmentKey.length + 1) }
        : null;

    tokens.push({
      kind: 'word',
      value: current,
      start,
      end: i,
      assignment,
    });
  }

  return { ok: true, tokens };
}

export function parseCommandLine(input: string): ParseResult {
  const result = lexInput(input, { splitPipes: false });
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    tokens: result.tokens
      .filter((t): t is WordToken => t.kind === 'word')
      .map((t) => t.value),
  };
}

export function parsePipeline(input: string): PipelineParseResult {
  const lexed = lexInput(input, { splitPipes: true });
  if (!lexed.ok) {
    return lexed;
  }

  if (lexed.tokens.length === 0) {
    return { ok: true, stages: [] };
  }

  const rawStages: WordToken[][] = [];
  let currentStage: WordToken[] = [];

  for (const token of lexed.tokens) {
    if (token.kind === 'pipe') {
      if (currentStage.length === 0) {
        return { ok: false, error: "syntax error near unexpected token '|'" };
      }
      rawStages.push(currentStage);
      currentStage = [];
    } else {
      currentStage.push(token);
    }
  }

  if (currentStage.length === 0) {
    return { ok: false, error: "syntax error near unexpected token '|'" };
  }
  rawStages.push(currentStage);

  const stages: ParsedStage[] = [];
  for (const words of rawStages) {
    const env: Record<string, string> = {};
    let idx = 0;
    while (idx < words.length && words[idx]!.assignment !== null) {
      const assign = words[idx]!.assignment!;
      env[assign.key] = assign.value;
      idx += 1;
    }

    const command = idx < words.length ? words[idx]!.value : null;
    const args = idx + 1 < words.length ? words.slice(idx + 1).map((t) => t.value) : [];
    stages.push({ env, command, args });
  }

  if (stages.length > 1 && stages.some((stage) => stage.command === null)) {
    return { ok: false, error: "syntax error near unexpected token '|'" };
  }

  return { ok: true, stages };
}

export function parseCompletionContext(
  lineBeforeCursor: string,
): CompletionContext | null {
  const lexed = lexInput(lineBeforeCursor, { splitPipes: true });
  if (!lexed.ok) {
    return null;
  }

  let lastPipeIdx = -1;
  for (let i = lexed.tokens.length - 1; i >= 0; i--) {
    if (lexed.tokens[i]!.kind === 'pipe') {
      lastPipeIdx = i;
      break;
    }
  }

  const stageWords = lexed.tokens
    .slice(lastPipeIdx + 1)
    .filter((t): t is WordToken => t.kind === 'word');

  const endsWithWhitespace =
    lineBeforeCursor.length > 0 && /\s$/.test(lineBeforeCursor);

  const maxLeadingSkip = endsWithWhitespace
    ? stageWords.length
    : Math.max(0, stageWords.length - 1);

  let firstCmdIdx = 0;
  while (
    firstCmdIdx < maxLeadingSkip &&
    stageWords[firstCmdIdx]!.assignment !== null
  ) {
    firstCmdIdx += 1;
  }

  const tokens = stageWords.slice(firstCmdIdx);

  if (tokens.length === 0) {
    return {
      isCommand: true,
      command: '',
      args: [],
      currentToken: '',
      tokenStart: lineBeforeCursor.length,
    };
  }

  if (tokens.length === 1 && !endsWithWhitespace) {
    const first = tokens[0]!;
    return {
      isCommand: true,
      command: '',
      args: [],
      currentToken: first.value,
      tokenStart: first.start,
    };
  }

  const command = tokens[0]!.value;
  if (endsWithWhitespace) {
    return {
      isCommand: false,
      command,
      args: tokens.slice(1).map((t) => t.value),
      currentToken: '',
      tokenStart: lineBeforeCursor.length,
    };
  }

  const last = tokens[tokens.length - 1]!;
  return {
    isCommand: false,
    command,
    args: tokens.slice(1, -1).map((t) => t.value),
    currentToken: last.value,
    tokenStart: last.start,
  };
}
