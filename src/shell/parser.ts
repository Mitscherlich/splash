export type ParseResult =
  | { ok: true; tokens: string[] }
  | { ok: false; error: string };

export interface CompletionContext {
  isCommand: boolean;
  command: string;
  args: string[];
  currentToken: string;
  tokenStart: number;
}

interface ParsedToken {
  value: string;
  start: number;
  end: number;
}

function tokenizeWithSpans(
  input: string,
): { ok: true; tokens: ParsedToken[] } | { ok: false; error: string } {
  const tokens: ParsedToken[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    while (i < len && /\s/.test(input[i]!)) {
      i++;
    }
    if (i >= len) break;

    const start = i;
    let current = '';
    let quote: "'" | '"' | null = null;

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

      if (/\s/.test(ch)) {
        break;
      }

      if (ch === "'" || ch === '"') {
        quote = ch;
        i++;
        continue;
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

    tokens.push({ value: current, start, end: i });
  }

  return { ok: true, tokens };
}

export function parseCommandLine(input: string): ParseResult {
  const result = tokenizeWithSpans(input);
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    tokens: result.tokens.map((t) => t.value),
  };
}

export function parseCompletionContext(
  lineBeforeCursor: string,
): CompletionContext | null {
  const parsed = tokenizeWithSpans(lineBeforeCursor);
  if (!parsed.ok) {
    return null;
  }

  const tokens = parsed.tokens;
  const endsWithWhitespace =
    lineBeforeCursor.length > 0 && /\s$/.test(lineBeforeCursor);

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
