import type { BrowserAdapter } from '../adapter/types';
import type { NoteVimEditorResult, SessionIO } from '../shell/registry';
import { VimSession } from '../shell/vimSession';
import { saveNoteWithConflictPolicy } from './store';

export interface OverlayClassListLike {
  add(...names: string[]): void;
  remove(...names: string[]): void;
  toggle(name: string, force?: boolean): boolean;
  contains(name: string): boolean;
}

export interface OverlayElementLike {
  className: string;
  textContent: string | null;
  tabIndex: number;
  hidden: boolean;
  dataset: Record<string, string | undefined>;
  style: Record<string, string>;
  classList: OverlayClassListLike;
  setAttribute(name: string, value: string): void;
  appendChild<T extends OverlayElementLike>(child: T): T;
  replaceChildren(...nodes: OverlayElementLike[]): void;
  remove(): void;
  focus(): void;
  scrollIntoView?(options?: ScrollIntoViewOptions): void;
  addEventListener(type: string, listener: (ev: unknown) => void): void;
  removeEventListener(type: string, listener: (ev: unknown) => void): void;
}

export interface OverlayDocumentLike {
  body: OverlayElementLike;
  createElement(tagName: string): OverlayElementLike;
}

export interface ModalTerminalLike {
  readonly cols: number;
  readonly rows: number;
  open(container: OverlayElementLike): void;
  fit(): void;
  focus(): void;
  write(data: string): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onResize?(listener: (size: { cols: number; rows: number }) => void): {
    dispose(): void;
  };
  dispose(): void;
}

export type ModalTerminalFactory = () => ModalTerminalLike;

export interface NoteVimModalOptions {
  adapter: BrowserAdapter;
  noteId: number | null;
  initialContent: string;
  standalone?: boolean;
  doc?: OverlayDocumentLike;
  mountParent?: OverlayElementLike;
  createTerminal: ModalTerminalFactory;
}

function formatVimHeaderTitle(noteId: number | null): string {
  return noteId !== null
    ? `┌─ VIM · note #${noteId} ─┐`
    : '┌─ VIM · note #new ─┐';
}

export class NoteVimModal {
  private readonly adapter: BrowserAdapter;
  private currentNoteId: number | null;
  private readonly initialContent: string;
  private readonly standalone: boolean;
  private readonly doc: OverlayDocumentLike;
  private readonly mountParent: OverlayElementLike;
  private readonly createTerminal: ModalTerminalFactory;
  private term: ModalTerminalLike | null = null;
  private closed = false;

  constructor(options: NoteVimModalOptions) {
    this.adapter = options.adapter;
    this.currentNoteId = options.noteId;
    this.initialContent = options.initialContent;
    this.standalone = options.standalone ?? true;
    this.doc =
      options.doc ?? (document as unknown as OverlayDocumentLike);
    this.mountParent = options.mountParent ?? this.doc.body;
    this.createTerminal = options.createTerminal;
  }

  focus(): void {
    this.term?.focus();
  }

  open(): Promise<NoteVimEditorResult> {
    return new Promise<NoteVimEditorResult>((resolve) => {
      let savedId: number | null = null;
      let lastKnownContent = this.initialContent;
      let savingLocally = false;

      const backdrop = this.doc.createElement('div');
      backdrop.className = this.standalone
        ? 'splash-overlay-veil splash-vim-standalone'
        : 'splash-vim-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.setAttribute('aria-label', 'Splash Vim Note Editor');

      const frame = this.doc.createElement('div');
      frame.className = 'splash-vim-frame';

      const topbar = this.doc.createElement('div');
      topbar.className = 'splash-vim-top';

      const titleGroup = this.doc.createElement('div');
      titleGroup.className = 'splash-vim-title-group';

      const titleEl = this.doc.createElement('span');
      titleEl.className = 'splash-vim-title';
      titleEl.textContent = formatVimHeaderTitle(this.currentNoteId);

      const remoteNotice = this.doc.createElement('span');
      remoteNotice.className = 'splash-vim-remote-notice';
      remoteNotice.hidden = true;
      remoteNotice.textContent = '';

      titleGroup.appendChild(titleEl);
      titleGroup.appendChild(remoteNotice);

      const actions = this.doc.createElement('div');
      actions.className = 'splash-vim-actions';

      const saveBtn = this.doc.createElement('button');
      saveBtn.className = 'splash-ascii-btn primary';
      saveBtn.setAttribute('type', 'button');
      saveBtn.textContent = ':wq 保存并关闭';

      const quitBtn = this.doc.createElement('button');
      quitBtn.className = 'splash-ascii-btn';
      quitBtn.setAttribute('type', 'button');
      quitBtn.textContent = ':q! 放弃';

      actions.appendChild(saveBtn);
      actions.appendChild(quitBtn);

      topbar.appendChild(titleGroup);
      topbar.appendChild(actions);

      const termHost = this.doc.createElement('div');
      termHost.className = 'splash-vim-term';

      const hintBar = this.doc.createElement('div');
      hintBar.className = 'splash-vim-hint';
      hintBar.textContent =
        'NORMAL/INSERT · h/j/k/l 移动 · i/a/o 编辑 · dd 删行 · u 撤销 · :w 保存 · :wq 保存退出 · :q! 放弃';

      frame.appendChild(topbar);
      frame.appendChild(termHost);
      frame.appendChild(hintBar);
      backdrop.appendChild(frame);
      this.mountParent.appendChild(backdrop);

      const term = this.createTerminal();
      this.term = term;
      term.open(termHost);
      term.fit();

      let dataQueue: Promise<void> = Promise.resolve();
      let unsubscribeNotes: (() => void) | null = null;
      let resizeObserver: ResizeObserver | null = null;
      let dataSub: { dispose(): void } | null = null;
      let resizeSub: { dispose(): void } | null = null;

      const stopKeyPropagation = (ev: unknown) => {
        const keyEv = ev as { stopPropagation?: () => void };
        keyEv.stopPropagation?.();
      };
      backdrop.addEventListener('keydown', stopKeyPropagation);

      const cleanup = () => {
        if (this.closed) return;
        this.closed = true;
        backdrop.removeEventListener('keydown', stopKeyPropagation);
        unsubscribeNotes?.();
        unsubscribeNotes = null;
        resizeObserver?.disconnect();
        resizeObserver = null;
        dataSub?.dispose();
        dataSub = null;
        resizeSub?.dispose();
        resizeSub = null;
        term.dispose();
        this.term = null;
        backdrop.remove();
        resolve({ savedId });
      };

      const vimSession = new VimSession({
        filePath:
          this.currentNoteId !== null
            ? `note://${this.currentNoteId}`
            : 'note://new',
        initialContent: this.initialContent,
        useAltScreen: false,
        onSave: async (content) => {
          savingLocally = true;
          try {
            const res = await saveNoteWithConflictPolicy(
              this.adapter,
              this.currentNoteId,
              content,
            );
            this.currentNoteId = res.note.id;
            savedId = res.note.id;
            lastKnownContent = res.note.content;
            titleEl.textContent = formatVimHeaderTitle(res.note.id);
            remoteNotice.hidden = true;
            remoteNotice.textContent = '';
            vimSession.setFilePath(`note://${res.note.id}`);

            if (res.recreatedFromDeletedId !== null) {
              return {
                ok: true,
                message: `note #${res.recreatedFromDeletedId} was removed in another tab; saved as note #${res.note.id}`,
              };
            }
            return { ok: true, message: `"note://${res.note.id}" written` };
          } finally {
            savingLocally = false;
          }
        },
      });

      const io: SessionIO = {
        get cols() {
          return term.cols;
        },
        get rows() {
          return term.rows;
        },
        write: (data: string) => {
          term.write(data);
        },
        exit: cleanup,
      };

      const sendToVim = (data: string) => {
        dataQueue = dataQueue
          .then(async () => {
            if (!this.closed) {
              await vimSession.handleData(data);
            }
          })
          .catch(() => {});
      };

      dataSub = term.onData((data) => {
        sendToVim(data);
      });

      resizeSub =
        term.onResize?.(({ cols, rows }) => {
          vimSession.handleResize(cols, rows);
        }) ?? null;

      saveBtn.addEventListener('click', () => {
        sendToVim('\x1b:wq\r');
        term.focus();
      });

      quitBtn.addEventListener('click', () => {
        sendToVim('\x1b:q!\r');
      });

      unsubscribeNotes = this.adapter.onNotesChanged((state) => {
        if (this.closed || savingLocally || this.currentNoteId === null) return;
        const found = state.items.find((item) => item.id === this.currentNoteId);
        if (!found) {
          remoteNotice.textContent = `⚠ 其他标签页已删除 #${this.currentNoteId}（保存将另存为新 ID）`;
          remoteNotice.hidden = false;
        } else if (found.content !== lastKnownContent) {
          lastKnownContent = found.content;
          remoteNotice.textContent = `⚠ 其他标签页已更新 #${this.currentNoteId}（当前缓冲区保留）`;
          remoteNotice.hidden = false;
        }
      });

      if (typeof ResizeObserver !== 'undefined' && typeof HTMLElement !== 'undefined' && termHost instanceof HTMLElement) {
        resizeObserver = new ResizeObserver(() => {
          if (this.closed) return;
          term.fit();
          vimSession.handleResize(term.cols, term.rows);
        });
        resizeObserver.observe(termHost);
      }

      vimSession.start(io);
      term.focus();
    });
  }
}
