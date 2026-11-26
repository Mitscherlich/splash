import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { ChromeBrowserAdapter } from './adapter/chromeAdapter';
import { createDefaultRegistry } from './commands';
import { ShellController } from './shell/controller';
import './style.css';
import {
  DEFAULT_THEME,
  FONT_FAMILY,
  FONT_SIZE,
  LINE_HEIGHT,
} from './theme/defaultTheme';

function boot(): void {
  const container = document.getElementById('terminal');
  if (!container) {
    throw new Error('Missing #terminal mount element');
  }

  const terminal = new Terminal({
    theme: DEFAULT_THEME,
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 2000,
    allowProposedApi: false,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);
  fitAddon.fit();

  const focusTerminal = () => {
    terminal.focus();
  };

  focusTerminal();
  window.addEventListener('focus', focusTerminal);
  container.addEventListener('mousedown', focusTerminal);

  const fit = () => {
    fitAddon.fit();
  };

  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(container);
  window.addEventListener('resize', fit);

  const adapter = new ChromeBrowserAdapter();
  const registry = createDefaultRegistry();
  const controller = new ShellController(terminal, adapter, registry);
  void controller.start();

  window.addEventListener('beforeunload', () => {
    resizeObserver.disconnect();
    window.removeEventListener('resize', fit);
    window.removeEventListener('focus', focusTerminal);
    container.removeEventListener('mousedown', focusTerminal);
    controller.dispose();
    terminal.dispose();
  });
}

boot();
