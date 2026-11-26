import { describe, expect, it, vi } from 'vitest';
import {
  CopyOnSelectController,
  createTabLinkHandler,
  parseTabLinkUri,
} from '../src/shell/interactions';

describe('parseTabLinkUri', () => {
  it('parses valid splash-tab://<positiveInt> URIs and rejects everything else', () => {
    expect(parseTabLinkUri('splash-tab://1002')).toBe(1002);
    expect(parseTabLinkUri('splash-tab://1')).toBe(1);

    for (const invalid of [
      '',
      'https://github.com',
      'splash-tab://0',
      'splash-tab://-5',
      'splash-tab://abc',
      'splash-tab://12/extra',
      'javascript:alert(1)',
    ]) {
      expect(parseTabLinkUri(invalid)).toBeNull();
    }
  });
});

describe('createTabLinkHandler', () => {
  it('enables allowNonHttpProtocols and activates tab on left-click without selection', () => {
    const activateTab = vi.fn(async () => 'activated' as const);
    const handler = createTabLinkHandler({
      hasSelection: () => false,
      activateTab,
    });

    expect(handler.allowNonHttpProtocols).toBe(true);

    handler.activate({ button: 0 } as MouseEvent, 'splash-tab://2048', {
      start: { x: 1, y: 1 },
      end: { x: 10, y: 1 },
    });
    expect(activateTab).toHaveBeenCalledWith(2048);
  });

  it('ignores activation when text is selected, on right-click, or for non-tab URIs', () => {
    const activateTab = vi.fn(async () => 'activated' as const);
    let selected = true;
    const handler = createTabLinkHandler({
      hasSelection: () => selected,
      activateTab,
    });

    const range = { start: { x: 1, y: 1 }, end: { x: 10, y: 1 } };

    // Drag selection inside link should copy, not navigate
    handler.activate({ button: 0 } as MouseEvent, 'splash-tab://2048', range);
    expect(activateTab).not.toHaveBeenCalled();

    selected = false;
    // Right-click should not navigate
    handler.activate({ button: 2 } as MouseEvent, 'splash-tab://2048', range);
    expect(activateTab).not.toHaveBeenCalled();

    // Non-tab URI should not navigate
    handler.activate({ button: 0 } as MouseEvent, 'https://github.com', range);
    expect(activateTab).not.toHaveBeenCalled();
  });
});

describe('CopyOnSelectController', () => {
  it('defers clipboard copy during mouse drag and copies once on mouseup', () => {
    let selection = '';
    const writeClipboard = vi.fn(async () => undefined);
    const ctrl = new CopyOnSelectController({
      getSelection: () => selection,
      hasSelection: () => selection.length > 0,
      writeClipboard,
    });

    ctrl.onMouseDown();
    selection = 'git';
    ctrl.onSelectionChange();
    selection = 'github.com';
    ctrl.onSelectionChange();
    // Should not spam clipboard mid-drag
    expect(writeClipboard).not.toHaveBeenCalled();

    ctrl.onMouseUp();
    expect(writeClipboard).toHaveBeenCalledTimes(1);
    expect(writeClipboard).toHaveBeenCalledWith('github.com');
  });

  it('copies immediately when selection changes while not dragging and ignores empty selection', () => {
    let selection = '';
    const writeClipboard = vi.fn(async () => undefined);
    const ctrl = new CopyOnSelectController({
      getSelection: () => selection,
      hasSelection: () => selection.length > 0,
      writeClipboard,
    });

    // Empty selection does not touch clipboard
    ctrl.onMouseDown();
    ctrl.onMouseUp();
    ctrl.onSelectionChange();
    expect(writeClipboard).not.toHaveBeenCalled();

    // Post-mouseup double-click / programmatic selection copies immediately
    selection = '1002';
    ctrl.onSelectionChange();
    expect(writeClipboard).toHaveBeenCalledTimes(1);
    expect(writeClipboard).toHaveBeenCalledWith('1002');
  });

  it('swallows clipboard write rejections cleanly', async () => {
    const writeClipboard = vi.fn(async () => {
      throw new Error('Document is not focused');
    });
    const ctrl = new CopyOnSelectController({
      getSelection: () => 'copied',
      hasSelection: () => true,
      writeClipboard,
    });

    expect(() => ctrl.onSelectionChange()).not.toThrow();
    await Promise.resolve();
    expect(writeClipboard).toHaveBeenCalledWith('copied');
  });
});
