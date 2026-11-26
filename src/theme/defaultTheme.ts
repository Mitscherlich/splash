import type { ITheme } from '@xterm/xterm';

export const PROMPT_TEXT = '$ ';

export const FONT_FAMILY =
  '"JetBrains Mono", "SF Mono", "Cascadia Code", Menlo, Consolas, monospace';

export const FONT_SIZE = 14;

export const LINE_HEIGHT = 1.4;

export const DEFAULT_THEME: ITheme = {
  background: '#0f1117',
  foreground: '#e6edf3',
  cursor: '#58a6ff',
  cursorAccent: '#0f1117',
  selectionBackground: 'rgba(88, 166, 255, 0.28)',
  black: '#0f1117',
  red: '#f85149',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#58a6ff',
  white: '#e6edf3',
  brightBlack: '#6e7681',
  brightRed: '#ff7b72',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#79c0ff',
  brightWhite: '#ffffff',
};
