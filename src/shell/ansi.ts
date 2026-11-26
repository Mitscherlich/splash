const RESET = '\x1b[0m';

function wrap(code: string, text: string): string {
  return `\x1b[${code}m${text}${RESET}`;
}

export const ansi = {
  accent: (text: string): string => wrap('36', text),
  active: (text: string): string => wrap('32', text),
  muted: (text: string): string => wrap('90', text),
  error: (text: string): string => wrap('31', text),
  bold: (text: string): string => wrap('1', text),
  strip: (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, ''),
};
