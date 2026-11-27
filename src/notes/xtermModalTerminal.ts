import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import {
  DEFAULT_THEME,
  FONT_FAMILY,
  FONT_SIZE,
  LINE_HEIGHT,
} from '../theme/defaultTheme';
import type { ModalTerminalLike, OverlayElementLike } from './vimModal';

export function createXtermModalTerminal(): ModalTerminalLike {
  const term = new Terminal({
    theme: DEFAULT_THEME,
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 0,
    allowProposedApi: false,
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  return {
    get cols() {
      return Math.max(20, term.cols);
    },
    get rows() {
      return Math.max(5, term.rows);
    },
    open(container: OverlayElementLike) {
      term.open(container as unknown as HTMLElement);
    },
    fit() {
      try {
        fitAddon.fit();
      } catch {
        // Ignore transient layout measurements before mount settles
      }
    },
    focus() {
      term.focus();
    },
    write(data: string) {
      term.write(data);
    },
    onData(listener: (data: string) => void) {
      return term.onData(listener);
    },
    onResize(listener: (size: { cols: number; rows: number }) => void) {
      return term.onResize(listener);
    },
    dispose() {
      term.dispose();
    },
  };
}
