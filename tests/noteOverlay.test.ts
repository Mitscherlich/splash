import { describe, expect, it, vi } from 'vitest';
import {
  NoteGuiOverlay,
  type OverlayDocumentLike,
  type OverlayElementLike,
} from '../src/notes/guiOverlay';
import { BrowserOverlayHost } from '../src/notes/overlayHost';
import {
  NoteVimModal,
  type ModalTerminalLike,
} from '../src/notes/vimModal';
import { FakeBrowserAdapter } from './fakeAdapter';

interface FakeEvent {
  type: string;
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: FakeElement;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

class FakeElement implements OverlayElementLike {
  readonly tagName: string;
  className = '';
  textContent: string | null = '';
  private _innerHTML = '';
  innerHTMLWrites = 0;
  tabIndex = 0;
  hidden = false;
  dataset: Record<string, string | undefined> = {};
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  focused = false;
  private classes = new Set<string>();
  private listeners = new Map<string, Set<(ev: FakeEvent) => void>>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(val: string) {
    this._innerHTML = val;
    this.innerHTMLWrites += 1;
  }

  classList = {
    add: (...names: string[]) => {
      for (const n of names) this.classes.add(n);
    },
    remove: (...names: string[]) => {
      for (const n of names) this.classes.delete(n);
    },
    toggle: (name: string, force?: boolean) => {
      if (force === undefined) {
        if (this.classes.has(name)) {
          this.classes.delete(name);
          return false;
        }
        this.classes.add(name);
        return true;
      }
      if (force) this.classes.add(name);
      else this.classes.delete(name);
      return force;
    },
    contains: (name: string) => this.classes.has(name),
  };

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  appendChild<T extends OverlayElementLike>(child: T): T {
    const fake = child as unknown as FakeElement;
    fake.parentNode = this;
    this.children.push(fake);
    return child;
  }

  replaceChildren(...nodes: OverlayElementLike[]): void {
    for (const c of this.children) c.parentNode = null;
    this.children = [];
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  remove(): void {
    if (!this.parentNode) return;
    const idx = this.parentNode.children.indexOf(this);
    if (idx >= 0) this.parentNode.children.splice(idx, 1);
    this.parentNode = null;
  }

  focus(): void {
    this.focused = true;
  }

  scrollIntoView(): void {}

  addEventListener(type: string, listener: (ev: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as (ev: FakeEvent) => void);
  }

  removeEventListener(type: string, listener: (ev: unknown) => void): void {
    this.listeners.get(type)?.delete(listener as (ev: FakeEvent) => void);
  }

  dispatch(
    type: string,
    init?: {
      key?: string;
      ctrlKey?: boolean;
      metaKey?: boolean;
      altKey?: boolean;
      shiftKey?: boolean;
      target?: FakeElement;
    },
  ): FakeEvent {
    const ev: FakeEvent = {
      type,
      key: init?.key,
      ctrlKey: init?.ctrlKey,
      metaKey: init?.metaKey,
      altKey: init?.altKey,
      shiftKey: init?.shiftKey,
      target: init?.target ?? this,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      },
    };
    const handlers = this.listeners.get(type);
    if (handlers) {
      for (const fn of Array.from(handlers)) {
        fn(ev);
      }
    }
    return ev;
  }

  collectText(): string {
    const own = this.textContent ?? '';
    return [own, ...this.children.map((c) => c.collectText())].join(' ');
  }

  findAll(predicate: (el: FakeElement) => boolean): FakeElement[] {
    const out: FakeElement[] = [];
    if (predicate(this)) out.push(this);
    for (const child of this.children) {
      out.push(...child.findAll(predicate));
    }
    return out;
  }
}

function createFakeDocument(): {
  doc: OverlayDocumentLike;
  body: FakeElement;
} {
  const body = new FakeElement('body');
  const doc: OverlayDocumentLike = {
    body,
    createElement: (tag: string) => new FakeElement(tag),
  };
  return { doc, body };
}

class FakeModalTerminal implements ModalTerminalLike {
  cols = 60;
  rows = 16;
  writes: string[] = [];
  focused = false;
  disposed = false;
  private dataListeners = new Set<(data: string) => void>();

  open(_container: OverlayElementLike): void {}
  fit(): void {}
  focus(): void {
    this.focused = true;
  }
  write(data: string): void {
    this.writes.push(data);
  }
  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListeners.add(listener);
    return {
      dispose: () => {
        this.dataListeners.delete(listener);
      },
    };
  }
  dispose(): void {
    this.disposed = true;
  }
  emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }
}

describe('NoteVimModal', () => {
  it('edits via embedded VimSession, handles remote deletion by minting a new ID without clobbering buffer, and cleans up', async () => {
    const adapter = new FakeBrowserAdapter({
      notes: {
        nextId: 3,
        items: [
          { id: 1, content: 'alpha', createdAt: 10, updatedAt: 10 },
          { id: 2, content: 'beta', createdAt: 20, updatedAt: 20 },
        ],
      },
    });
    const { doc, body } = createFakeDocument();
    const fakeTerm = new FakeModalTerminal();

    const modal = new NoteVimModal({
      adapter,
      noteId: 1,
      initialContent: 'alpha',
      doc,
      mountParent: body,
      createTerminal: () => fakeTerm,
    });

    const runPromise = modal.open();
    expect(fakeTerm.focused).toBe(true);
    expect(body.collectText()).toContain('note #1');

    // Another tab deletes note #1 while modal is open
    adapter.emitExternalNotesChange({
      nextId: 3,
      items: [{ id: 2, content: 'beta', createdAt: 20, updatedAt: 20 }],
    });
    expect(body.collectText()).toContain('已删除');

    // User appends "!" and runs :wq -> must save as new note #3 (never resurrect #1)
    fakeTerm.emitData('A!\x1b:wq\r');
    const result = await runPromise;
    expect(result).toEqual({ savedId: 3 });
    expect(adapter.notes.items.map((n) => n.id)).toEqual([2, 3]);
    expect(adapter.notes.items.find((n) => n.id === 3)?.content).toBe('alpha!');
    expect(fakeTerm.disposed).toBe(true);
    expect(body.children).toHaveLength(0);
  });
});

describe('NoteGuiOverlay (ASCII Corkboard) and BrowserOverlayHost', () => {
  it('navigates cards with hjkl, confirms/cancels delete, renders XSS safely via textContent, and syncs live changes', async () => {
    const xssPayload = '<img src=x onerror=alert(1)>';
    const adapter = new FakeBrowserAdapter({
      notes: {
        nextId: 4,
        items: [
          { id: 1, content: 'First note\nline two', createdAt: 10, updatedAt: 10 },
          { id: 2, content: xssPayload, createdAt: 20, updatedAt: 20 },
          { id: 3, content: 'Third note', createdAt: 30, updatedAt: 30 },
        ],
      },
    });
    const { doc, body } = createFakeDocument();
    const openedEditors: Array<{ noteId: number | null; initialContent: string }> = [];

    const overlay = new NoteGuiOverlay({
      adapter,
      doc,
      mountParent: body,
      getColumnCount: () => 3,
      openVimModal: async (opts) => {
        openedEditors.push(opts);
        return { savedId: opts.noteId };
      },
    });

    const runPromise = overlay.open();
    await new Promise((r) => setTimeout(r, 0));

    // XSS check: payload rendered as literal textContent, zero innerHTML writes anywhere inside overlay
    expect(body.collectText()).toContain(xssPayload);
    const allEls = body.findAll(() => true);
    expect(allEls.every((el) => el.innerHTMLWrites === 0)).toBe(true);

    const dialog = body.findAll((el) => el.classList.contains('splash-pinboard'))[0]!;
    expect(dialog.focused).toBe(true);

    // Move right (l) from #1 to #2, press e to edit #2
    dialog.dispatch('keydown', { key: 'l' });
    dialog.dispatch('keydown', { key: 'e' });
    await new Promise((r) => setTimeout(r, 0));
    expect(openedEditors).toEqual([{ noteId: 2, initialContent: xssPayload }]);

    // Press d -> inline confirm, press Escape -> cancels delete
    dialog.dispatch('keydown', { key: 'd' });
    expect(body.collectText()).toContain('确认删除 note #2');
    dialog.dispatch('keydown', { key: 'Escape' });
    expect(adapter.notes.items).toHaveLength(3);

    // Press d then y -> deletes #2
    dialog.dispatch('keydown', { key: 'd' });
    dialog.dispatch('keydown', { key: 'y' });
    await new Promise((r) => setTimeout(r, 0));
    expect(adapter.notes.items.map((n) => n.id)).toEqual([1, 3]);

    // External tab clears all notes -> empty state rendered
    adapter.emitExternalNotesChange({ nextId: 4, items: [] });
    expect(body.collectText()).toContain('暂无备忘');

    // Press q closes overlay cleanly
    dialog.dispatch('keydown', { key: 'q' });
    await runPromise;
    expect(body.children).toHaveLength(0);
  });

  it('tracks active overlay stack and restores main terminal focus on close', async () => {
    const adapter = new FakeBrowserAdapter({
      notes: {
        nextId: 2,
        items: [{ id: 1, content: 'hello', createdAt: 10, updatedAt: 10 }],
      },
    });
    const { doc, body } = createFakeDocument();
    const fakeTerm = new FakeModalTerminal();
    const restoreFocus = vi.fn();

    const host = new BrowserOverlayHost({
      doc,
      mountParent: body,
      onRestoreTerminalFocus: restoreFocus,
      createTerminal: () => fakeTerm,
    });

    expect(host.hasActiveOverlay()).toBe(false);
    const editPromise = host.openNoteVimEditor(adapter, {
      noteId: 1,
      initialContent: 'hello',
    });
    expect(host.hasActiveOverlay()).toBe(true);
    expect(restoreFocus).not.toHaveBeenCalled();

    fakeTerm.emitData(':q\r');
    await editPromise;
    expect(host.hasActiveOverlay()).toBe(false);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it('traps Tab, preserves browser Cmd/Ctrl shortcuts, refocuses on non-button clicks, and guards nested GUI/Vim overlay state', async () => {
    const adapter = new FakeBrowserAdapter({
      notes: {
        nextId: 3,
        items: [
          { id: 1, content: 'One', createdAt: 10, updatedAt: 10 },
          { id: 2, content: 'Two', createdAt: 20, updatedAt: 20 },
        ],
      },
    });
    const { doc, body } = createFakeDocument();
    const terminals: FakeModalTerminal[] = [];
    const overlayStates: boolean[] = [];
    const restoreFocus = vi.fn();

    const host = new BrowserOverlayHost({
      doc,
      mountParent: body,
      onRestoreTerminalFocus: restoreFocus,
      onOverlayStateChange: (active) => overlayStates.push(active),
      createTerminal: () => {
        const t = new FakeModalTerminal();
        terminals.push(t);
        return t;
      },
    });

    const guiPromise = host.openNoteGui(adapter);
    await new Promise((r) => setTimeout(r, 0));
    expect(host.hasActiveOverlay()).toBe(true);
    expect(overlayStates).toEqual([true]);

    const dialog = body.findAll((el) => el.classList.contains('splash-pinboard'))[0]!;
    const surface = body.findAll((el) => el.className === 'splash-cork-surface')[0]!;

    // Browser shortcuts (Cmd+L, Ctrl+N, Ctrl+D, Alt+Q) must NOT be prevented or trigger actions
    const cmdL = dialog.dispatch('keydown', { key: 'l', metaKey: true });
    expect(cmdL.defaultPrevented).toBe(false);
    const ctrlN = dialog.dispatch('keydown', { key: 'n', ctrlKey: true });
    expect(ctrlN.defaultPrevented).toBe(false);
    expect(terminals).toHaveLength(0);
    const ctrlD = dialog.dispatch('keydown', { key: 'd', ctrlKey: true });
    expect(ctrlD.defaultPrevented).toBe(false);
    expect(body.collectText()).not.toContain('确认删除');

    // Tab key is trapped inside overlay
    const tabEv = dialog.dispatch('keydown', { key: 'Tab' });
    expect(tabEv.defaultPrevented).toBe(true);

    // Clicking non-button surface refocuses dialog so keyboard nav keeps working
    dialog.focused = false;
    dialog.dispatch('mousedown', { target: surface });
    expect(dialog.focused).toBe(true);

    // Open nested Vim modal via 'e', verify Tab trap & backdrop mousedown refocuses embedded term
    dialog.dispatch('keydown', { key: 'e' });
    await new Promise((r) => setTimeout(r, 0));
    expect(terminals).toHaveLength(1);
    const nestedTerm = terminals[0]!;
    const vimBackdrop = body.findAll((el) => el.className === 'splash-vim-backdrop')[0]!;
    const vimHint = body.findAll((el) => el.className === 'splash-vim-hint')[0]!;

    const modalTab = vimBackdrop.dispatch('keydown', { key: 'Tab' });
    expect(modalTab.defaultPrevented).toBe(true);

    nestedTerm.focused = false;
    vimBackdrop.dispatch('mousedown', { target: vimHint });
    expect(nestedTerm.focused).toBe(true);

    // Exit nested Vim modal -> overlay remains active, restoreFocus NOT called yet
    nestedTerm.emitData(':q\r');
    await new Promise((r) => setTimeout(r, 0));
    expect(host.hasActiveOverlay()).toBe(true);
    expect(restoreFocus).not.toHaveBeenCalled();

    // Close corkboard -> overlay inactive, onOverlayStateChange(false), restoreFocus called once
    dialog.dispatch('keydown', { key: 'q' });
    await guiPromise;
    expect(host.hasActiveOverlay()).toBe(false);
    expect(overlayStates).toEqual([true, false]);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });
});
