// The web layout (app/css/web.css) changes tablets and computers only: phones
// keep the mobile design. Every page loads it last; outside min-width queries
// it only defines its own tokens and hides the web-only rail on phones.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = (path: string) => resolve(import.meta.dirname, path);
const css = readFileSync(here('../public/app/css/web.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Top-level blocks of a stylesheet: [prelude, body]. */
function blocks(text: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0;
  let start = 0;
  let prelude = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      if (depth === 0) {
        prelude = text.slice(start, i).trim();
        start = i + 1;
      }
      depth += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        out.push([prelude, text.slice(start, i)]);
        start = i + 1;
      }
    }
  }
  return out;
}

describe('web layout (tablets and computers)', () => {
  it('is the last stylesheet of every app page and of Home', () => {
    const pages = readdirSync(here('../public/app/pages')).map((f) => `../public/app/pages/${f}`);
    for (const page of [...pages, '../../../prototypes/home/index.html']) {
      const links = [
        ...readFileSync(here(page), 'utf8').matchAll(/rel="stylesheet"\s+href="([^"]+)"/g),
      ];
      expect(links.at(-1)?.[1], page).toBe('/app/css/web.css');
    }
  });

  it('leaves phones alone: outside min-width queries only its tokens and the phone-only hide', () => {
    for (const [prelude, body] of blocks(css)) {
      if (/^@media \(min-width: \d+px\)$/.test(prelude)) continue;
      if (prelude === ':root') {
        expect(body.match(/^\s*--web-[\w-]+:/gm)?.length).toBe(
          body.split(';').filter((d) => d.trim()).length,
        );
        continue;
      }
      expect(prelude).toBe('@media (max-width: 767.98px)');
      expect(body.replace(/\s+/g, ' ').trim()).toBe('.tabbar--web { display: none !important; }');
    }
  });

  it('puts every CRM page and form under its navigation item', async () => {
    const { tabForPath } = await import('../public/app/js/ui/tabbar.js');
    expect(tabForPath('/dashboard')).toBe('home');
    expect(tabForPath('/feedback-overview')).toBe('home');
    expect(tabForPath('/follow-up/new')).toBe('follow-up');
    expect(tabForPath('/leads/5b9ab8be-8c2d-4ac0-81d4-7b0f97876330')).toBe('leads');
    expect(tabForPath('/notifications')).toBe('notifications');
    for (const path of [
      '/customers',
      '/customers/new',
      '/tasks/new',
      '/calendar',
      '/opportunities',
    ]) {
      expect(tabForPath(path), path).toBe('more');
    }
  });
});
