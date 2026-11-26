const RESET = '\x1b[0m';
const OSC8_START = '\x1b]8;;';
const OSC8_END = '\x07';

function wrap(code: string, text: string): string {
  return `\x1b[${code}m${text}${RESET}`;
}

export const ansi = {
  accent: (text: string): string => wrap('36', text),
  active: (text: string): string => wrap('32', text),
  muted: (text: string): string => wrap('90', text),
  error: (text: string): string => wrap('31', text),
  bold: (text: string): string => wrap('1', text),
  link: (uri: string, text: string): string =>
    `${OSC8_START}${uri}${OSC8_END}${text}${OSC8_START}${OSC8_END}`,
  strip: (text: string): string =>
    text
      .replace(/\x1b\]8;[^;\x07]*;[^\x07]*\x07/g, '')
      .replace(/\x1b\[[0-9;]*m/g, ''),
};
