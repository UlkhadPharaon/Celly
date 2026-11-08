import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../../src/ui/dom';

/**
 * Text values that are composed into an HTML template (audit task 4.4). The catalog and the copy
 * tables are compiled in, but this is the boundary guarantee: a value can never become markup.
 */
describe('escapeHtml', () => {
  it('escapes the five markup-significant characters', () => {
    expect(escapeHtml(`Tom & Jerry's <b>"cat"</b>`)).toBe(
      'Tom &amp; Jerry&#39;s &lt;b&gt;&quot;cat&quot;&lt;/b&gt;'
    );
  });

  it('leaves ordinary text untouched so labels render identically', () => {
    expect(escapeHtml('Nucleus — ADN')).toBe('Nucleus — ADN');
  });
});
