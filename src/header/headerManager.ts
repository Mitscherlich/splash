import { mount, type MountOptions, type Piece } from 'ascii.rest';
import * as auroraFjord from 'ascii.rest/pieces/aurora-fjord';
import * as bigText from 'ascii.rest/pieces/big-text';
import * as donut from 'ascii.rest/pieces/donut';
import * as nightCoast from 'ascii.rest/pieces/night-coast';
import type { HeaderPiece, SplashConfig } from '../config/schema';

export type ActiveHeaderPiece = Exclude<HeaderPiece, 'none'>;

export const PIECE_MODULES: Record<ActiveHeaderPiece, Piece<any>> = {
  'big-text': bigText,
  'night-coast': nightCoast,
  'aurora-fjord': auroraFjord,
  donut,
};

export interface HeaderElementLike {
  className: string;
  textContent: string | null;
  innerHTML: string;
  hidden: boolean;
  dataset: Record<string, string | undefined>;
  style: { display: string };
  classList: {
    toggle(name: string, force?: boolean): boolean;
  };
  appendChild(child: HeaderElementLike): unknown;
  replaceChildren(...nodes: HeaderElementLike[]): void;
}

export type HeaderMountFn = (
  el: HeaderElementLike,
  piece: Piece<any>,
  options?: MountOptions,
) => () => void;

export interface HeaderManagerOptions {
  mountPiece?: HeaderMountFn;
  createElement?: (tag: 'div' | 'pre' | 'canvas' | 'span') => HeaderElementLike;
  onLayoutChange?: () => void;
}

const COLORED_SCENES = new Set<ActiveHeaderPiece>(['night-coast', 'aurora-fjord']);

export class HeaderManager {
  private readonly container: HeaderElementLike;
  private readonly mountPiece: HeaderMountFn;
  private readonly createElement: (
    tag: 'div' | 'pre' | 'canvas' | 'span',
  ) => HeaderElementLike;
  private readonly onLayoutChange?: () => void;
  private stopCurrent: (() => void) | null = null;

  constructor(
    container: HTMLElement | HeaderElementLike,
    options: HeaderManagerOptions = {},
  ) {
    this.container = container as HeaderElementLike;
    this.mountPiece =
      options.mountPiece ??
      ((el, piece, mountOpts) =>
        mount(el as unknown as HTMLElement, piece, mountOpts));
    this.createElement =
      options.createElement ??
      ((tag) => document.createElement(tag) as unknown as HeaderElementLike);
    this.onLayoutChange = options.onLayoutChange;
  }

  apply(config: SplashConfig): void {
    this.stopAnimation();

    const { piece, text, density, mono, divider } = config.header;
    this.container.dataset.density = density;
    this.container.classList.toggle('has-divider', divider);

    if (piece === 'none') {
      this.container.hidden = true;
      this.container.style.display = 'none';
      this.container.replaceChildren();
      this.onLayoutChange?.();
      return;
    }

    this.container.hidden = false;
    this.container.style.display = '';

    const pieceModule = PIECE_MODULES[piece];
    let mountTarget: HeaderElementLike;
    let mountOptions: MountOptions | undefined;

    if (piece === 'big-text') {
      const box = this.createElement('div');
      box.className = 'layout-big-text';

      const pre = this.createElement('pre');
      pre.className = 'ascii-art-pre';
      box.appendChild(pre);

      const meta = this.createElement('div');
      meta.className = 'header-meta';
      const line1 = this.createElement('div');
      const brand = this.createElement('span');
      brand.className = 'accent';
      brand.textContent = 'splash';
      const sep = this.createElement('span');
      sep.textContent = ' · newtab shell';
      line1.appendChild(brand);
      line1.appendChild(sep);

      const line2 = this.createElement('div');
      line2.textContent = 'ls · cd · open · vim · man';
      meta.appendChild(line1);
      meta.appendChild(line2);
      box.appendChild(meta);

      this.container.replaceChildren(box);
      mountTarget = pre;
      mountOptions = { text };
    } else if (COLORED_SCENES.has(piece)) {
      const box = this.createElement('div');
      box.className = 'layout-scene';

      const target = this.createElement(mono ? 'pre' : 'canvas');
      target.className = mono ? 'ascii-art-pre scene-pre' : 'ascii-art-canvas';
      box.appendChild(target);

      const badge = this.createElement('div');
      badge.className = 'scene-badge';
      badge.textContent = 'splash · newtab shell';
      box.appendChild(badge);

      this.container.replaceChildren(box);
      mountTarget = target;
    } else {
      const box = this.createElement('div');
      box.className = 'layout-donut';

      const slot = this.createElement('div');
      slot.className = 'donut-slot';
      const pre = this.createElement('pre');
      pre.className = 'ascii-art-pre donut-pre';
      slot.appendChild(pre);
      box.appendChild(slot);

      const copy = this.createElement('div');
      copy.className = 'donut-copy';
      const title = this.createElement('div');
      title.className = 'title';
      title.textContent = 'SPLASH';
      const sub = this.createElement('div');
      sub.className = 'sub';
      sub.textContent = 'chrome newtab shell · ls · cd · open · vim · man';
      copy.appendChild(title);
      copy.appendChild(sub);
      box.appendChild(copy);

      this.container.replaceChildren(box);
      mountTarget = pre;
    }

    this.stopCurrent = this.mountPiece(mountTarget, pieceModule, mountOptions);
    this.onLayoutChange?.();
  }

  dispose(): void {
    this.stopAnimation();
  }

  private stopAnimation(): void {
    if (this.stopCurrent) {
      this.stopCurrent();
      this.stopCurrent = null;
    }
  }
}
