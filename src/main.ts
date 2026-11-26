import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { ChromeBrowserAdapter } from './adapter/chromeAdapter';
import { createDefaultRegistry } from './commands';
import { ShellController } from './shell/controller';
import {
  CopyOnSelectController,
  createTabLinkHandler,
} from './shell/interactions';
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

  const adapter = new ChromeBrowserAdapter();

  let terminal!: Terminal;
  terminal = new Terminal({
    theme: DEFAULT_THEME,
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 2000,
    allowProposedApi: false,
    linkHandler: createTabLinkHandler({
      hasSelection: () => terminal.hasSelection(),
      activateTab: (tabId) => adapter.activateTab(tabId),
    }),
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);
  fitAddon.fit();

  const copyOnSelect = new CopyOnSelectController({
    getSelection: () => terminal.getSelection(),
    hasSelection: () => terminal.hasSelection(),
    writeClipboard: (text) => navigator.clipboard.writeText(text),
  });

  const selectionSubscription = terminal.onSelectionChange(() => {
    copyOnSelect.onSelectionChange();
  });

  const handleMouseDown = () => {
    copyOnSelect.onMouseDown();
    terminal.focus();
  };

  const handleMouseUp = () => {
    copyOnSelect.onMouseUp();
  };

  const focusTerminal = () => {
    terminal.focus();
  };

  focusTerminal();
  window.addEventListener('focus', focusTerminal);
  container.addEventListener('mousedown', handleMouseDown);
  window.addEventListener('mouseup', handleMouseUp);

  const fit = () => {
    fitAddon.fit();
  };

  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(container);
  window.addEventListener('resize', fit);

  const registry = createDefaultRegistry();
  const controller = new ShellController(terminal, adapter, registry);
  void controller.start();

  window.addEventListener('beforeunload', () => {
    resizeObserver.disconnect();
    window.removeEventListener('resize', fit);
    window.removeEventListener('focus', focusTerminal);
    container.removeEventListener('mousedown', handleMouseDown);
    window.removeEventListener('mouseup', handleMouseUp);
    selectionSubscription.dispose();
    controller.dispose();
    terminal.dispose();
  });
}

boot();
