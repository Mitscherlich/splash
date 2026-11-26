import { sanitizeTerminalText } from '../shell/width';

export const CONFIG_PATH = '/etc/splash.d/config';

export const HEADER_PIECES = [
  'big-text',
  'night-coast',
  'aurora-fjord',
  'donut',
  'none',
] as const;

export type HeaderPiece = (typeof HEADER_PIECES)[number];

export const HEADER_DENSITIES = ['compact', 'standard', 'spacious'] as const;

export type HeaderDensity = (typeof HEADER_DENSITIES)[number];

export interface HeaderConfig {
  piece: HeaderPiece;
  text: string;
  density: HeaderDensity;
  mono: boolean;
  divider: boolean;
}

export interface SplashConfig {
  header: HeaderConfig;
}

export const MAX_HEADER_TEXT_LENGTH = 14;

export const DEFAULT_CONFIG: SplashConfig = {
  header: {
    piece: 'big-text',
    text: 'SPLASH',
    density: 'compact',
    mono: false,
    divider: true,
  },
};

export type ConfigParseResult =
  | { ok: true; config: SplashConfig }
  | { ok: false; error: string };

function isHeaderPiece(value: unknown): value is HeaderPiece {
  return (
    typeof value === 'string' &&
    (HEADER_PIECES as readonly string[]).includes(value)
  );
}

function isHeaderDensity(value: unknown): value is HeaderDensity {
  return (
    typeof value === 'string' &&
    (HEADER_DENSITIES as readonly string[]).includes(value)
  );
}

function parseBool(value: string): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function normalizeConfig(raw: unknown): SplashConfig {
  const headerRaw =
    raw && typeof raw === 'object' && 'header' in raw
      ? (raw as { header?: unknown }).header
      : undefined;
  const h =
    headerRaw && typeof headerRaw === 'object'
      ? (headerRaw as Record<string, unknown>)
      : {};

  const piece: HeaderPiece = isHeaderPiece(h.piece)
    ? h.piece
    : DEFAULT_CONFIG.header.piece;

  const cleanedText =
    typeof h.text === 'string' ? sanitizeTerminalText(h.text).trim() : '';
  const text =
    cleanedText.length >= 1 && cleanedText.length <= MAX_HEADER_TEXT_LENGTH
      ? cleanedText
      : DEFAULT_CONFIG.header.text;

  const density: HeaderDensity = isHeaderDensity(h.density)
    ? h.density
    : DEFAULT_CONFIG.header.density;

  const mono =
    typeof h.mono === 'boolean' ? h.mono : DEFAULT_CONFIG.header.mono;

  const divider =
    typeof h.divider === 'boolean' ? h.divider : DEFAULT_CONFIG.header.divider;

  return {
    header: {
      piece,
      text,
      density,
      mono,
      divider,
    },
  };
}

export function serializeConfig(config: SplashConfig): string {
  const c = normalizeConfig(config);
  return [
    `# Splash configuration (${CONFIG_PATH})`,
    `# header.piece: ${HEADER_PIECES.join(' | ')}`,
    `header.piece = ${c.header.piece}`,
    `# header.text: banner text for big-text (1-${MAX_HEADER_TEXT_LENGTH} chars)`,
    `header.text = ${c.header.text}`,
    `# header.density: ${HEADER_DENSITIES.join(' | ')}`,
    `header.density = ${c.header.density}`,
    '# header.mono: true | false (render colored scenes in single theme ink)',
    `header.mono = ${c.header.mono}`,
    '# header.divider: true | false (bottom hairline between header and terminal)',
    `header.divider = ${c.header.divider}`,
  ].join('\n');
}

export function parseConfigText(input: string): ConfigParseResult {
  const header: HeaderConfig = { ...DEFAULT_CONFIG.header };
  const lines = input.replace(/\r\n/g, '\n').split('\n');

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const trimmed = lines[idx]!.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) {
      return {
        ok: false,
        error: `line ${lineNum}: expected "key = value"`,
      };
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 1).trim();

    switch (key) {
      case 'header.piece': {
        if (!isHeaderPiece(rawValue)) {
          return {
            ok: false,
            error: `line ${lineNum}: invalid header.piece "${rawValue}" (expected: ${HEADER_PIECES.join(' | ')})`,
          };
        }
        header.piece = rawValue;
        break;
      }
      case 'header.text': {
        const cleaned = sanitizeTerminalText(rawValue).trim();
        if (cleaned.length < 1 || cleaned.length > MAX_HEADER_TEXT_LENGTH) {
          return {
            ok: false,
            error: `line ${lineNum}: invalid header.text (expected 1-${MAX_HEADER_TEXT_LENGTH} chars)`,
          };
        }
        header.text = cleaned;
        break;
      }
      case 'header.density': {
        if (!isHeaderDensity(rawValue)) {
          return {
            ok: false,
            error: `line ${lineNum}: invalid header.density "${rawValue}" (expected: ${HEADER_DENSITIES.join(' | ')})`,
          };
        }
        header.density = rawValue;
        break;
      }
      case 'header.mono': {
        const parsed = parseBool(rawValue);
        if (parsed === null) {
          return {
            ok: false,
            error: `line ${lineNum}: invalid header.mono "${rawValue}" (expected: true | false)`,
          };
        }
        header.mono = parsed;
        break;
      }
      case 'header.divider': {
        const parsed = parseBool(rawValue);
        if (parsed === null) {
          return {
            ok: false,
            error: `line ${lineNum}: invalid header.divider "${rawValue}" (expected: true | false)`,
          };
        }
        header.divider = parsed;
        break;
      }
      default:
        return {
          ok: false,
          error: `line ${lineNum}: unknown config key "${key}"`,
        };
    }
  }

  return { ok: true, config: { header } };
}
