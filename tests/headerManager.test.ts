import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type SplashConfig } from '../src/config/schema';
import {
  HeaderManager,
  type HeaderElementLike,
  type HeaderMountFn,
} from '../src/header/headerManager';

function createFakeElement(tagName: string): HeaderElementLike & {
  tagName: string;
  children: Array<HeaderElementLike & { tagName: string }>;
  classes: Set<string>;
} {
  const classes = new Set<string>();
  const children: Array<HeaderElementLike & { tagName: string }> = [];
  return {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    dataset: {},
    style: { display: '' },
    classes,
    children,
    classList: {
      toggle(name: string, force?: boolean) {
        if (force === undefined) {
          if (classes.has(name)) {
            classes.delete(name);
            return false;
          }
          classes.add(name);
          return true;
        }
        if (force) classes.add(name);
        else classes.delete(name);
        return force;
      },
    },
    appendChild<T extends HeaderElementLike>(child: T): T {
      children.push(child as unknown as HeaderElementLike & { tagName: string });
      return child;
    },
    replaceChildren(...nodes: HeaderElementLike[]) {
      children.length = 0;
      for (const n of nodes) {
        children.push(n as unknown as HeaderElementLike & { tagName: string });
      }
    },
  };
}

describe('HeaderManager', () => {
  it('mounts <pre> for big-text and donut, passes text option for big-text, and notifies layout change', () => {
    const host = createFakeElement('header');
    const mountedTags: string[] = [];
    const mountedOptions: Array<Record<string, unknown> | undefined> = [];
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const onLayoutChange = vi.fn();

    const mountPiece: HeaderMountFn = (el, _piece, options) => {
      mountedTags.push((el as unknown as { tagName: string }).tagName);
      mountedOptions.push(options as Record<string, unknown> | undefined);
      const stop = vi.fn();
      stops.push(stop);
      return stop;
    };

    const manager = new HeaderManager(host, {
      mountPiece,
      createElement: (tag) => createFakeElement(tag),
      onLayoutChange,
    });

    manager.apply(DEFAULT_CONFIG);
    expect(host.hidden).toBe(false);
    expect(host.dataset.density).toBe('compact');
    expect(host.classes.has('has-divider')).toBe(true);
    expect(mountedTags).toEqual(['PRE']);
    expect(mountedOptions[0]).toEqual({ text: 'SPLASH' });
    expect(onLayoutChange).toHaveBeenCalledTimes(1);

    const donutConfig: SplashConfig = {
      header: {
        piece: 'donut',
        text: 'SPLASH',
        density: 'standard',
        mono: false,
        divider: false,
      },
    };
    manager.apply(donutConfig);
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(mountedTags).toEqual(['PRE', 'PRE']);
    expect(host.dataset.density).toBe('standard');
    expect(host.classes.has('has-divider')).toBe(false);
    expect(onLayoutChange).toHaveBeenCalledTimes(2);
  });

  it('mounts <canvas> for colored scenes when mono=false and <pre> when mono=true', () => {
    const host = createFakeElement('header');
    const mountedTags: string[] = [];
    const stopFns: Array<ReturnType<typeof vi.fn>> = [];

    const manager = new HeaderManager(host, {
      mountPiece: (el) => {
        mountedTags.push((el as unknown as { tagName: string }).tagName);
        const stop = vi.fn();
        stopFns.push(stop);
        return stop;
      },
      createElement: (tag) => createFakeElement(tag),
    });

    manager.apply({
      header: {
        piece: 'night-coast',
        text: 'SPLASH',
        density: 'standard',
        mono: false,
        divider: true,
      },
    });
    expect(mountedTags).toEqual(['CANVAS']);

    manager.apply({
      header: {
        piece: 'aurora-fjord',
        text: 'SPLASH',
        density: 'spacious',
        mono: true,
        divider: true,
      },
    });
    expect(stopFns[0]).toHaveBeenCalledTimes(1);
    expect(mountedTags).toEqual(['CANVAS', 'PRE']);

    manager.dispose();
    expect(stopFns[1]).toHaveBeenCalledTimes(1);
  });

  it('hides header without mounting when piece is none and cleans up previous animation', () => {
    const host = createFakeElement('header');
    const stop = vi.fn();
    const mountPiece = vi.fn(() => stop);
    const onLayoutChange = vi.fn();

    const manager = new HeaderManager(host, {
      mountPiece,
      createElement: (tag) => createFakeElement(tag),
      onLayoutChange,
    });

    manager.apply(DEFAULT_CONFIG);
    expect(mountPiece).toHaveBeenCalledTimes(1);

    manager.apply({
      header: {
        ...DEFAULT_CONFIG.header,
        piece: 'none',
      },
    });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(mountPiece).toHaveBeenCalledTimes(1);
    expect(host.hidden).toBe(true);
    expect(host.style.display).toBe('none');
    expect(onLayoutChange).toHaveBeenCalledTimes(2);
  });
});
