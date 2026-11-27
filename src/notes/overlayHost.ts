import type { BrowserAdapter } from '../adapter/types';
import type {
  NoteVimEditorOptions,
  NoteVimEditorResult,
  ShellOverlayHost,
} from '../shell/registry';
import { NoteGuiOverlay } from './guiOverlay';
import {
  NoteVimModal,
  type ModalTerminalFactory,
  type OverlayDocumentLike,
  type OverlayElementLike,
} from './vimModal';

export interface BrowserOverlayHostOptions {
  doc?: OverlayDocumentLike;
  mountParent?: OverlayElementLike;
  onRestoreTerminalFocus?: () => void;
  onOverlayStateChange?: (active: boolean) => void;
  createTerminal: ModalTerminalFactory;
}

interface FocusableOverlay {
  focus(): void;
}

export class BrowserOverlayHost implements ShellOverlayHost {
  private readonly doc?: OverlayDocumentLike;
  private readonly mountParent?: OverlayElementLike;
  private readonly onRestoreTerminalFocus?: () => void;
  private readonly onOverlayStateChange?: (active: boolean) => void;
  private readonly createTerminal: ModalTerminalFactory;
  private readonly stack: FocusableOverlay[] = [];

  constructor(options: BrowserOverlayHostOptions) {
    this.doc = options.doc;
    this.mountParent = options.mountParent;
    this.onRestoreTerminalFocus = options.onRestoreTerminalFocus;
    this.onOverlayStateChange = options.onOverlayStateChange;
    this.createTerminal = options.createTerminal;
  }

  hasActiveOverlay(): boolean {
    return this.stack.length > 0;
  }

  focusActiveOverlay(): void {
    const top = this.stack[this.stack.length - 1];
    top?.focus();
  }

  async openNoteGui(adapter: BrowserAdapter): Promise<void> {
    const overlay = new NoteGuiOverlay({
      adapter,
      doc: this.doc,
      mountParent: this.mountParent,
      createTerminal: this.createTerminal,
    });
    this.pushOverlay(overlay);
    try {
      await overlay.open();
    } finally {
      this.popOverlay(overlay);
    }
  }

  async openNoteVimEditor(
    adapter: BrowserAdapter,
    options: NoteVimEditorOptions,
  ): Promise<NoteVimEditorResult> {
    const modal = new NoteVimModal({
      adapter,
      noteId: options.noteId,
      initialContent: options.initialContent,
      standalone: true,
      doc: this.doc,
      mountParent: this.mountParent,
      createTerminal: this.createTerminal,
    });
    this.pushOverlay(modal);
    try {
      return await modal.open();
    } finally {
      this.popOverlay(modal);
    }
  }

  private pushOverlay(overlay: FocusableOverlay): void {
    const wasEmpty = this.stack.length === 0;
    this.stack.push(overlay);
    if (wasEmpty) {
      this.onOverlayStateChange?.(true);
    }
  }

  private popOverlay(overlay: FocusableOverlay): void {
    const idx = this.stack.lastIndexOf(overlay);
    if (idx >= 0) {
      this.stack.splice(idx, 1);
    }
    if (this.stack.length === 0) {
      this.onOverlayStateChange?.(false);
      this.onRestoreTerminalFocus?.();
    } else {
      this.focusActiveOverlay();
    }
  }
}
