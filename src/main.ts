import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { ChromeBrowserAdapter } from './adapter/chromeAdapter';
import { createDefaultRegistry } from './commands';
import { DEFAULT_CONFIG } from './config/schema';
import { HeaderManager } from './header/headerManager';
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
  const headerEl = document.getElementById('splash-header');

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

  const fit = () => {
    fitAddon.fit();
  };

  fit();

  const headerManager = headerEl
    ? new HeaderManager(headerEl, {
        onLayoutChange: () => {
          requestAnimationFrame(fit);
        },
      })
    : null;

  void adapter
    .loadConfig()
    .then((config) => {
      headerManager?.apply(config);
    })
    .catch(() => {
      headerManager?.apply(DEFAULT_CONFIG);
    });

  const unsubscribeConfig = adapter.onConfigChanged((config) => {
    headerManager?.apply(config);
  });

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
  headerEl?.addEventListener('mousedown', focusTerminal);
  window.addEventListener('mouseup', handleMouseUp);

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
    headerEl?.removeEventListener('mousedown', focusTerminal);
    window.removeEventListener('mouseup', handleMouseUp);
    unsubscribeConfig();
    headerManager?.dispose();
    selectionSubscription.dispose();
    controller.dispose();
    terminal.dispose();
  });
}

boot();
