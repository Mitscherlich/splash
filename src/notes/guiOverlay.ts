import type { BrowserAdapter } from '../adapter/types';
import type { NoteVimEditorOptions, NoteVimEditorResult } from '../shell/registry';
import { formatNoteTimestamp, removeNotesInAdapter } from './store';
import { normalizeNotesState, type NoteItem } from './types';
import {
  NoteVimModal,
  type ModalTerminalFactory,
  type OverlayDocumentLike,
  type OverlayElementLike,
} from './vimModal';

export type { OverlayDocumentLike, OverlayElementLike };

const PUSHPIN_ACCENTS = ['amber', 'cyan', 'green', 'magenta'] as const;
const SHADOW_PATTERN = Array.from({ length: 18 }, () => '░'.repeat(46)).join('\n');

export interface NoteGuiOverlayOptions {
  adapter: BrowserAdapter;
  doc?: OverlayDocumentLike;
  mountParent?: OverlayElementLike;
  createTerminal?: ModalTerminalFactory;
  getColumnCount?: () => number;
  openVimModal?: (options: NoteVimEditorOptions) => Promise<NoteVimEditorResult>;
}

function defaultColumnCount(): number {
  if (typeof window === 'undefined') return 3;
  if (window.innerWidth <= 680) return 1;
  if (window.innerWidth <= 1020) return 2;
  return 3;
}

export class NoteGuiOverlay {
  private readonly adapter: BrowserAdapter;
  private readonly doc: OverlayDocumentLike;
  private readonly mountParent: OverlayElementLike;
  private readonly createTerminal?: ModalTerminalFactory;
  private readonly getColumnCount: () => number;
  private readonly customOpenVimModal?: (
    options: NoteVimEditorOptions,
  ) => Promise<NoteVimEditorResult>;

  private items: NoteItem[] = [];
  private selectedId: number | null = null;
  private pendingDeleteId: number | null = null;
  private activeVimModal: NoteVimModal | null = null;
  private modalOpen = false;
  private closed = false;

  private veilEl: OverlayElementLike | null = null;
  private dialogEl: OverlayElementLike | null = null;
  private countEl: OverlayElementLike | null = null;
  private surfaceEl: OverlayElementLike | null = null;
  private footerEl: OverlayElementLike | null = null;
  private editBtnEl: OverlayElementLike | null = null;
  private delBtnEl: OverlayElementLike | null = null;

  constructor(options: NoteGuiOverlayOptions) {
    this.adapter = options.adapter;
    this.doc =
      options.doc ?? (document as unknown as OverlayDocumentLike);
    this.mountParent = options.mountParent ?? this.doc.body;
    this.createTerminal = options.createTerminal;
    this.getColumnCount = options.getColumnCount ?? defaultColumnCount;
    this.customOpenVimModal = options.openVimModal;
  }

  focus(): void {
    if (this.activeVimModal) {
      this.activeVimModal.focus();
      return;
    }
    this.dialogEl?.focus();
  }

  async open(): Promise<void> {
    const initial = normalizeNotesState(await this.adapter.loadNotes());
    this.items = initial.items;
    this.selectedId = this.items[0]?.id ?? null;

    return new Promise<void>((resolve) => {
      const veil = this.doc.createElement('div');
      veil.className = 'splash-overlay-veil';
      this.veilEl = veil;

      const dialog = this.doc.createElement('section');
      dialog.className = 'splash-pinboard';
      dialog.classList.add('splash-pinboard');
      dialog.tabIndex = -1;
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', 'Splash Notes Pinboard');
      this.dialogEl = dialog;

      // Top chrome bar
      const topBar = this.doc.createElement('header');
      topBar.className = 'splash-pinboard-top';

      const titleGroup = this.doc.createElement('div');
      titleGroup.className = 'splash-pinboard-title-group';

      const sigil = this.doc.createElement('span');
      sigil.className = 'splash-pinboard-sigil';
      sigil.textContent = '╔═[ PINBOARD ]═╗';

      const title = this.doc.createElement('span');
      title.className = 'splash-pinboard-title';
      title.textContent = 'SPLASH NOTES';

      const countEl = this.doc.createElement('span');
      countEl.className = 'splash-pinboard-count';
      this.countEl = countEl;

      titleGroup.appendChild(sigil);
      titleGroup.appendChild(title);
      titleGroup.appendChild(countEl);

      const toolbar = this.doc.createElement('div');
      toolbar.className = 'splash-pinboard-toolbar';

      const newBtn = this.doc.createElement('button');
      newBtn.className = 'splash-ascii-btn primary';
      newBtn.setAttribute('type', 'button');
      newBtn.textContent = '[n] + 新建';

      const editBtn = this.doc.createElement('button');
      editBtn.className = 'splash-ascii-btn';
      editBtn.setAttribute('type', 'button');
      editBtn.textContent = '[e] Vim 编辑';
      this.editBtnEl = editBtn;

      const delBtn = this.doc.createElement('button');
      delBtn.className = 'splash-ascii-btn danger';
      delBtn.setAttribute('type', 'button');
      delBtn.textContent = '[d] 删除';
      this.delBtnEl = delBtn;

      const closeBtn = this.doc.createElement('button');
      closeBtn.className = 'splash-ascii-btn';
      closeBtn.setAttribute('type', 'button');
      closeBtn.textContent = '[Esc] 关闭';

      toolbar.appendChild(newBtn);
      toolbar.appendChild(editBtn);
      toolbar.appendChild(delBtn);
      toolbar.appendChild(closeBtn);

      topBar.appendChild(titleGroup);
      topBar.appendChild(toolbar);

      // Corkboard surface
      const surface = this.doc.createElement('main');
      surface.className = 'splash-cork-surface';
      this.surfaceEl = surface;

      // Footer bar (switches between keyhints and inline delete confirm)
      const footer = this.doc.createElement('footer');
      footer.className = 'splash-pinboard-footer';
      this.footerEl = footer;

      dialog.appendChild(topBar);
      dialog.appendChild(surface);
      dialog.appendChild(footer);
      veil.appendChild(dialog);
      this.mountParent.appendChild(veil);

      let unsubscribeNotes: (() => void) | null = null;

      const closeOverlay = () => {
        if (this.closed) return;
        this.closed = true;
        dialog.removeEventListener('keydown', onKeyDown);
        dialog.removeEventListener('mousedown', onDialogMouseDown);
        veil.removeEventListener('mousedown', onVeilMouseDown);
        veil.removeEventListener('click', onVeilClick);
        unsubscribeNotes?.();
        unsubscribeNotes = null;
        veil.remove();
        this.veilEl = null;
        this.dialogEl = null;
        resolve();
      };

      const isButtonTarget = (target: unknown): boolean => {
        const el = target as { tagName?: string; closest?: (sel: string) => unknown } | null;
        if (!el) return false;
        if (typeof el.closest === 'function') {
          return Boolean(el.closest('button'));
        }
        return el.tagName?.toUpperCase() === 'BUTTON';
      };

      const onDialogMouseDown = (ev: unknown) => {
        if (this.closed || this.modalOpen) return;
        const mouseEv = ev as { target?: unknown; preventDefault?: () => void };
        if (!isButtonTarget(mouseEv.target)) {
          mouseEv.preventDefault?.();
          dialog.focus();
        }
      };

      const onVeilMouseDown = (ev: unknown) => {
        if (this.closed || this.modalOpen) return;
        const mouseEv = ev as { target?: unknown; preventDefault?: () => void };
        if (mouseEv.target === veil && this.pendingDeleteId !== null) {
          mouseEv.preventDefault?.();
          dialog.focus();
        }
      };

      const onVeilClick = (ev: unknown) => {
        const clickEv = ev as { target?: unknown };
        if (
          clickEv.target === veil &&
          !this.modalOpen &&
          this.pendingDeleteId === null
        ) {
          closeOverlay();
        }
      };

      const onKeyDown = (ev: unknown) => {
        const keyEv = ev as {
          key?: string;
          ctrlKey?: boolean;
          metaKey?: boolean;
          altKey?: boolean;
          preventDefault?: () => void;
          stopPropagation?: () => void;
        };
        if (this.closed || this.modalOpen) return;
        const key = keyEv.key;
        if (!key) return;

        // Preserve browser shortcuts (Cmd/Ctrl+L, Cmd/Ctrl+N, Cmd/Ctrl+D, etc.)
        if (keyEv.ctrlKey || keyEv.metaKey || keyEv.altKey) {
          return;
        }

        keyEv.stopPropagation?.();

        // Trap Tab focus inside overlay so focus cannot escape to background terminal
        if (key === 'Tab') {
          keyEv.preventDefault?.();
          return;
        }

        // Inline delete confirmation mode
        if (this.pendingDeleteId !== null) {
          if (key === 'y' || key === 'Y' || key === 'Enter') {
            keyEv.preventDefault?.();
            void this.confirmDelete();
          } else if (key === 'n' || key === 'N' || key === 'Escape') {
            keyEv.preventDefault?.();
            this.pendingDeleteId = null;
            this.renderFooter();
          }
          return;
        }

        switch (key) {
          case 'Escape':
          case 'q':
            keyEv.preventDefault?.();
            closeOverlay();
            return;
          case 'n':
            keyEv.preventDefault?.();
            void this.launchVimEditor(null, '');
            return;
          case 'e':
          case 'Enter': {
            keyEv.preventDefault?.();
            const current = this.getSelectedNote();
            if (current) {
              void this.launchVimEditor(current.id, current.content);
            }
            return;
          }
          case 'd':
          case 'Delete':
          case 'Backspace': {
            keyEv.preventDefault?.();
            const current = this.getSelectedNote();
            if (current) {
              this.pendingDeleteId = current.id;
              this.renderFooter();
            }
            return;
          }
          case 'l':
          case 'ArrowRight':
            keyEv.preventDefault?.();
            this.moveSelection(1);
            return;
          case 'h':
          case 'ArrowLeft':
            keyEv.preventDefault?.();
            this.moveSelection(-1);
            return;
          case 'j':
          case 'ArrowDown':
            keyEv.preventDefault?.();
            this.moveSelection(Math.max(1, this.getColumnCount()));
            return;
          case 'k':
          case 'ArrowUp':
            keyEv.preventDefault?.();
            this.moveSelection(-Math.max(1, this.getColumnCount()));
            return;
        }
      };

      newBtn.addEventListener('click', () => {
        if (this.modalOpen) return;
        this.pendingDeleteId = null;
        void this.launchVimEditor(null, '');
      });

      editBtn.addEventListener('click', () => {
        if (this.modalOpen) return;
        const current = this.getSelectedNote();
        if (current) {
          this.pendingDeleteId = null;
          void this.launchVimEditor(current.id, current.content);
        }
      });

      delBtn.addEventListener('click', () => {
        if (this.modalOpen) return;
        const current = this.getSelectedNote();
        if (current) {
          this.pendingDeleteId = current.id;
          this.renderFooter();
        }
      });

      closeBtn.addEventListener('click', () => {
        if (!this.modalOpen) {
          closeOverlay();
        }
      });

      dialog.addEventListener('keydown', onKeyDown);
      dialog.addEventListener('mousedown', onDialogMouseDown);
      veil.addEventListener('mousedown', onVeilMouseDown);
      veil.addEventListener('click', onVeilClick);

      unsubscribeNotes = this.adapter.onNotesChanged((state) => {
        if (this.closed) return;
        this.applyNotes(state.items);
      });

      this.renderAll();
      dialog.focus();
    });
  }

  private getSelectedNote(): NoteItem | null {
    if (this.selectedId === null) return null;
    return this.items.find((item) => item.id === this.selectedId) ?? null;
  }

  private applyNotes(nextItems: NoteItem[]): void {
    const prevIndex =
      this.selectedId !== null
        ? this.items.findIndex((item) => item.id === this.selectedId)
        : 0;
    this.items = nextItems;

    if (this.items.length === 0) {
      this.selectedId = null;
      this.pendingDeleteId = null;
    } else if (
      this.selectedId === null ||
      !this.items.some((item) => item.id === this.selectedId)
    ) {
      const clampedIdx = Math.max(
        0,
        Math.min(this.items.length - 1, prevIndex < 0 ? 0 : prevIndex),
      );
      this.selectedId = this.items[clampedIdx]!.id;
    }

    if (
      this.pendingDeleteId !== null &&
      !this.items.some((item) => item.id === this.pendingDeleteId)
    ) {
      this.pendingDeleteId = null;
    }

    this.renderAll();
  }

  private moveSelection(delta: number): void {
    if (this.items.length === 0) return;
    const currentIdx = Math.max(
      0,
      this.items.findIndex((item) => item.id === this.selectedId),
    );
    const nextIdx = Math.max(
      0,
      Math.min(this.items.length - 1, currentIdx + delta),
    );
    const target = this.items[nextIdx];
    if (target && target.id !== this.selectedId) {
      this.selectedId = target.id;
      this.renderAll();
    }
  }

  private async confirmDelete(): Promise<void> {
    const id = this.pendingDeleteId;
    if (id === null) return;
    this.pendingDeleteId = null;
    await removeNotesInAdapter(this.adapter, [id]);
    const latest = normalizeNotesState(await this.adapter.loadNotes());
    if (!this.closed) {
      this.applyNotes(latest.items);
      this.dialogEl?.focus();
    }
  }

  private async launchVimEditor(
    noteId: number | null,
    initialContent: string,
  ): Promise<void> {
    if (this.modalOpen || this.closed || !this.dialogEl) return;
    this.modalOpen = true;
    this.pendingDeleteId = null;

    let result: NoteVimEditorResult = { savedId: null };
    try {
      if (this.customOpenVimModal) {
        result = await this.customOpenVimModal({ noteId, initialContent });
      } else if (this.createTerminal) {
        const modal = new NoteVimModal({
          adapter: this.adapter,
          noteId,
          initialContent,
          standalone: false,
          doc: this.doc,
          mountParent: this.dialogEl,
          createTerminal: this.createTerminal,
        });
        this.activeVimModal = modal;
        try {
          result = await modal.open();
        } finally {
          this.activeVimModal = null;
        }
      }
    } finally {
      this.modalOpen = false;
    }

    if (this.closed) return;
    const latest = normalizeNotesState(await this.adapter.loadNotes());
    if (result.savedId !== null) {
      this.selectedId = result.savedId;
    }
    this.applyNotes(latest.items);
    this.dialogEl?.focus();
  }

  private renderAll(): void {
    if (this.countEl) {
      this.countEl.textContent = `${this.items.length} 条备忘 · 本地同步`;
    }
    const hasNotes = this.items.length > 0;
    if (this.editBtnEl) this.editBtnEl.hidden = !hasNotes;
    if (this.delBtnEl) this.delBtnEl.hidden = !hasNotes;

    this.renderCards();
    this.renderFooter();
  }

  private renderCards(): void {
    const surface = this.surfaceEl;
    if (!surface) return;

    if (this.items.length === 0) {
      surface.classList.add('is-empty');
      const emptyBox = this.doc.createElement('div');
      emptyBox.className = 'splash-pinboard-empty';

      const art = this.doc.createElement('pre');
      art.className = 'splash-empty-art';
      art.textContent = [
        '┌────────────────────────────────────┐',
        '│             (o)                    │',
        '│         暂无备忘记录               │',
        '│     按 [n] 钉上第一张便签          │',
        '└──────────────────────────────────_╱┘',
      ].join('\n');

      const cta = this.doc.createElement('button');
      cta.className = 'splash-ascii-btn primary';
      cta.setAttribute('type', 'button');
      cta.textContent = '[n] + 新建第一条备忘';
      cta.addEventListener('click', () => {
        void this.launchVimEditor(null, '');
      });

      emptyBox.appendChild(art);
      emptyBox.appendChild(cta);
      surface.replaceChildren(emptyBox);
      return;
    }

    surface.classList.remove('is-empty');
    const now = Date.now();
    const nodes: OverlayElementLike[] = [];

    for (const note of this.items) {
      const isSelected = note.id === this.selectedId;
      const wrap = this.doc.createElement('div');
      wrap.className = isSelected
        ? 'splash-sticky-wrap selected'
        : 'splash-sticky-wrap';
      wrap.classList.add('splash-sticky-wrap');
      if (isSelected) wrap.classList.add('selected');
      wrap.dataset.noteId = String(note.id);

      const shadow = this.doc.createElement('div');
      shadow.className = 'splash-sticky-shadow';
      shadow.setAttribute('aria-hidden', 'true');
      shadow.textContent = SHADOW_PATTERN;

      const card = this.doc.createElement('article');
      card.className = 'splash-sticky-card';

      const accent = PUSHPIN_ACCENTS[(note.id - 1) % PUSHPIN_ACCENTS.length]!;
      const pin = this.doc.createElement('div');
      pin.className = `splash-pushpin ${accent}`;
      pin.textContent = '(o)';

      const topRule = this.doc.createElement('div');
      topRule.className = 'splash-card-top';

      const idSpan = this.doc.createElement('span');
      idSpan.className = 'splash-card-id';
      idSpan.textContent = `#${note.id}`;

      const timeSpan = this.doc.createElement('span');
      timeSpan.textContent = formatNoteTimestamp(note.updatedAt, now);

      topRule.appendChild(idSpan);
      topRule.appendChild(timeSpan);

      const rawLines = note.content.replace(/\r\n?/g, '\n').split('\n');
      const titleLine = rawLines[0] ?? '';

      const titleEl = this.doc.createElement('div');
      titleEl.className = 'splash-card-title';
      titleEl.textContent = titleLine.trim().length > 0 ? titleLine : '(empty)';

      const bodyLines = this.doc.createElement('div');
      bodyLines.className = 'splash-card-lines';
      for (const line of rawLines.slice(1, 5)) {
        const row = this.doc.createElement('div');
        row.textContent = line;
        bodyLines.appendChild(row);
      }

      const cardFooter = this.doc.createElement('div');
      cardFooter.className = 'splash-card-footer';

      const countSpan = this.doc.createElement('span');
      countSpan.textContent = `${rawLines.length} 行`;

      const dogear = this.doc.createElement('span');
      dogear.className = 'splash-card-dogear';
      dogear.textContent = '_╱';

      cardFooter.appendChild(countSpan);
      cardFooter.appendChild(dogear);

      card.appendChild(pin);
      card.appendChild(topRule);
      card.appendChild(titleEl);
      card.appendChild(bodyLines);
      card.appendChild(cardFooter);

      wrap.appendChild(shadow);
      wrap.appendChild(card);

      wrap.addEventListener('click', () => {
        if (this.modalOpen) return;
        this.selectedId = note.id;
        this.pendingDeleteId = null;
        this.renderAll();
        this.dialogEl?.focus();
      });

      wrap.addEventListener('dblclick', () => {
        if (this.modalOpen) return;
        this.selectedId = note.id;
        this.pendingDeleteId = null;
        this.renderAll();
        void this.launchVimEditor(note.id, note.content);
      });

      nodes.push(wrap);
      if (isSelected) {
        wrap.scrollIntoView?.({ block: 'nearest' });
      }
    }

    surface.replaceChildren(...nodes);
  }

  private renderFooter(): void {
    const footer = this.footerEl;
    if (!footer) return;

    if (this.pendingDeleteId !== null) {
      const prompt = this.doc.createElement('span');
      prompt.className = 'splash-confirm-text';
      prompt.textContent = `确认删除 note #${this.pendingDeleteId}？（删除后 ID 不复用）`;

      const confirmActions = this.doc.createElement('div');
      confirmActions.className = 'splash-confirm-actions';

      const yesBtn = this.doc.createElement('button');
      yesBtn.className = 'splash-ascii-btn danger';
      yesBtn.setAttribute('type', 'button');
      yesBtn.textContent = '[y] 确认删除';
      yesBtn.addEventListener('click', () => {
        void this.confirmDelete();
      });

      const noBtn = this.doc.createElement('button');
      noBtn.className = 'splash-ascii-btn';
      noBtn.setAttribute('type', 'button');
      noBtn.textContent = '[n/Esc] 取消';
      noBtn.addEventListener('click', () => {
        this.pendingDeleteId = null;
        this.renderFooter();
        this.dialogEl?.focus();
      });

      confirmActions.appendChild(yesBtn);
      confirmActions.appendChild(noBtn);
      footer.replaceChildren(prompt, confirmActions);
      return;
    }

    const hints = this.doc.createElement('div');
    hints.className = 'splash-keyhints';
    hints.textContent =
      'h/j/k/l 移动选中 · e/Enter Vim 编辑 · n 新建 · d 删除 · q/Esc 关闭';

    const status = this.doc.createElement('div');
    status.className = 'splash-selection-status';
    status.textContent =
      this.selectedId !== null
        ? `已选中 #${this.selectedId} · 按 e 或双击进入 Vim`
        : '按 n 新建备忘';

    footer.replaceChildren(hints, status);
  }
}
