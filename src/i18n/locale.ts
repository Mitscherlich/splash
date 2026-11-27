export type SupportedLocale = 'en' | 'zh';

const ZH_PREFIX_RE = /^zh(?:[-_.]|$)/i;
const EN_PREFIX_RE = /^en(?:[-_.]|$)/i;
const C_LOCALE_RE = /^(?:C|POSIX)(?:\.|$)/i;

export function detectBrowserLanguage(): string | undefined {
  const g = globalThis as {
    chrome?: { i18n?: { getUILanguage?: () => string } };
    navigator?: { language?: string };
  };
  try {
    const extLang = g.chrome?.i18n?.getUILanguage?.();
    if (typeof extLang === 'string' && extLang.trim().length > 0) {
      return extLang;
    }
  } catch {
    // Ignore when chrome.i18n is unavailable
  }
  const navLang = g.navigator?.language;
  return typeof navLang === 'string' && navLang.trim().length > 0
    ? navLang
    : undefined;
}

export function resolveLocale(
  langEnv?: string,
  browserLang?: string,
): SupportedLocale {
  const raw = (langEnv ?? '').trim();
  if (!raw || C_LOCALE_RE.test(raw)) {
    const detected = (browserLang ?? detectBrowserLanguage() ?? '').trim();
    return ZH_PREFIX_RE.test(detected) ? 'zh' : 'en';
  }
  if (ZH_PREFIX_RE.test(raw)) {
    return 'zh';
  }
  if (EN_PREFIX_RE.test(raw)) {
    return 'en';
  }
  return 'en';
}

export interface NoteMessages {
  pinboardSigil: string;
  pinboardTitle: string;
  countText(count: number): string;
  btnNew: string;
  btnEdit: string;
  btnDelete: string;
  btnClose: string;
  emptyTag: string;
  emptyTitle: string;
  emptySub: string;
  emptyCount: string;
  emptyCta: string;
  emptyNoteTitle: string;
  lineCount(lines: number): string;
  confirmDelete(id: number): string;
  confirmYes: string;
  confirmNo: string;
  keyHints: string;
  selectedStatus(id: number): string;
  emptyStatus: string;
  vimSaveBtn: string;
  vimQuitBtn: string;
  vimHint: string;
  vimRemoteDeleted(id: number): string;
  vimRemoteUpdated(id: number): string;
}

const EN_MESSAGES: NoteMessages = {
  pinboardSigil: '╔═[ PINBOARD ]═╗',
  pinboardTitle: 'SPLASH NOTES',
  countText: (count) => `${count} ${count === 1 ? 'note' : 'notes'} · local sync`,
  btnNew: '[n] + New',
  btnEdit: '[e] Edit in Vim',
  btnDelete: '[d] Delete',
  btnClose: '[Esc] Close',
  emptyTag: 'EMPTY PINBOARD',
  emptyTitle: 'No notes pinned yet',
  emptySub: 'Press [n] to pin your first note, or run `note new <content>`',
  emptyCount: '0 notes',
  emptyCta: '[n] + Create first note',
  emptyNoteTitle: '(empty)',
  lineCount: (lines) => `${lines} ${lines === 1 ? 'line' : 'lines'}`,
  confirmDelete: (id) => `Delete note #${id}? (ID will not be reused)`,
  confirmYes: '[y] Confirm delete',
  confirmNo: '[n/Esc] Cancel',
  keyHints: 'h/j/k/l move · e/Enter edit in Vim · n new · d delete · q/Esc close',
  selectedStatus: (id) => `Selected #${id} · press e or double-click for Vim`,
  emptyStatus: 'Press n to create a note',
  vimSaveBtn: ':wq Save & Close',
  vimQuitBtn: ':q! Discard',
  vimHint:
    'NORMAL/INSERT · h/j/k/l move · i/a/o edit · dd delete line · u undo · :w save · :wq save & quit · :q! discard',
  vimRemoteDeleted: (id) =>
    `⚠ Note #${id} was deleted in another tab (saving creates a new ID)`,
  vimRemoteUpdated: (id) =>
    `⚠ Note #${id} changed in another tab (current buffer kept)`,
};

const ZH_MESSAGES: NoteMessages = {
  pinboardSigil: '╔═[ PINBOARD ]═╗',
  pinboardTitle: 'SPLASH NOTES',
  countText: (count) => `${count} 条备忘 · 本地同步`,
  btnNew: '[n] + 新建',
  btnEdit: '[e] Vim 编辑',
  btnDelete: '[d] 删除',
  btnClose: '[Esc] 关闭',
  emptyTag: 'EMPTY PINBOARD',
  emptyTitle: '暂无备忘记录',
  emptySub: '按 [n] 钉上第一张便签，或命令行执行 note new <内容>',
  emptyCount: '0 条',
  emptyCta: '[n] + 新建第一条备忘',
  emptyNoteTitle: '(empty)',
  lineCount: (lines) => `${lines} 行`,
  confirmDelete: (id) => `确认删除 note #${id}？（删除后 ID 不复用）`,
  confirmYes: '[y] 确认删除',
  confirmNo: '[n/Esc] 取消',
  keyHints: 'h/j/k/l 移动选中 · e/Enter Vim 编辑 · n 新建 · d 删除 · q/Esc 关闭',
  selectedStatus: (id) => `已选中 #${id} · 按 e 或双击进入 Vim`,
  emptyStatus: '按 n 新建备忘',
  vimSaveBtn: ':wq 保存并关闭',
  vimQuitBtn: ':q! 放弃',
  vimHint:
    'NORMAL/INSERT · h/j/k/l 移动 · i/a/o 编辑 · dd 删行 · u 撤销 · :w 保存 · :wq 保存退出 · :q! 放弃',
  vimRemoteDeleted: (id) =>
    `⚠ 其他标签页已删除 #${id}（保存将另存为新 ID）`,
  vimRemoteUpdated: (id) =>
    `⚠ 其他标签页已更新 #${id}（当前缓冲区保留）`,
};

export function getNoteMessages(locale: SupportedLocale): NoteMessages {
  return locale === 'zh' ? ZH_MESSAGES : EN_MESSAGES;
}
