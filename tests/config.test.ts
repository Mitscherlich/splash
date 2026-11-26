import { describe, expect, it } from 'vitest';
import {
  CONFIG_PATH,
  DEFAULT_CONFIG,
  normalizeConfig,
  parseConfigText,
  serializeConfig,
  type SplashConfig,
} from '../src/config/schema';

describe('SplashConfig schema serialize/parse', () => {
  it('round-trips default and customized configs via serializeConfig and parseConfigText', () => {
    expect(CONFIG_PATH).toBe('/etc/splash.d/config');

    const defaultText = serializeConfig(DEFAULT_CONFIG);
    expect(parseConfigText(defaultText)).toEqual({ ok: true, config: DEFAULT_CONFIG });

    const custom: SplashConfig = {
      header: {
        piece: 'night-coast',
        text: 'NEWTAB',
        density: 'spacious',
        mono: true,
        divider: false,
      },
    };
    const serialized = serializeConfig(custom);
    expect(serialized).toContain('header.piece = night-coast');
    expect(serialized).toContain('header.mono = true');
    expect(parseConfigText(serialized)).toEqual({ ok: true, config: custom });
  });

  it('ignores comments and blank lines and fills omitted keys from DEFAULT_CONFIG', () => {
    const partial = `
# user comment
header.piece = donut

header.density = standard
`;
    expect(parseConfigText(partial)).toEqual({
      ok: true,
      config: {
        header: {
          ...DEFAULT_CONFIG.header,
          piece: 'donut',
          density: 'standard',
        },
      },
    });
  });

  it('returns line-numbered errors for malformed lines, unknown keys, and invalid values', () => {
    const missingEq = parseConfigText('# ok\nheader.piece donut\n');
    expect(missingEq.ok).toBe(false);
    if (!missingEq.ok) expect(missingEq.error).toContain('line 2');

    const unknownKey = parseConfigText('header.color = red\n');
    expect(unknownKey.ok).toBe(false);
    if (!unknownKey.ok) expect(unknownKey.error).toContain('line 1');

    const badPiece = parseConfigText('# c1\n# c2\nheader.piece = matrix\n');
    expect(badPiece.ok).toBe(false);
    if (!badPiece.ok) {
      expect(badPiece.error).toContain('line 3');
      expect(badPiece.error).toContain('header.piece');
    }

    const badDensity = parseConfigText('header.density = giant\n');
    expect(badDensity.ok).toBe(false);
    if (!badDensity.ok) expect(badDensity.error).toContain('header.density');

    const badBool = parseConfigText('header.mono = yes\n');
    expect(badBool.ok).toBe(false);
    if (!badBool.ok) expect(badBool.error).toContain('header.mono');

    const emptyText = parseConfigText('header.text =   \n');
    expect(emptyText.ok).toBe(false);
    if (!emptyText.ok) expect(emptyText.error).toContain('header.text');

    const longText = parseConfigText('header.text = 123456789012345\n');
    expect(longText.ok).toBe(false);
    if (!longText.ok) expect(longText.error).toContain('header.text');
  });

  it('defensively normalizes partial or corrupted stored config objects', () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig('invalid')).toEqual(DEFAULT_CONFIG);
    expect(
      normalizeConfig({
        header: {
          piece: 'aurora-fjord',
          text: 'OK',
          density: 'invalid-density',
          mono: 'not-bool',
          divider: false,
        },
      }),
    ).toEqual({
      header: {
        piece: 'aurora-fjord',
        text: 'OK',
        density: 'compact',
        mono: false,
        divider: false,
      },
    });
  });
});
