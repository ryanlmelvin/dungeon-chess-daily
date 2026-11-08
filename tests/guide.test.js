// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// "How to play" lives in index.html; src/guide.js pages through its articles.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('<section id="guide"');
const guide = html.slice(start, html.indexOf('</section>', start));
const words = (body) => body.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').split(/\s+/).filter(Boolean).length;
const pages = [...guide.matchAll(/<article class="guide-page" data-section="([^"]+)" data-title="([^"]+)" hidden>([\s\S]*?)<\/article>/g)]
  .map(([, section, title, body]) => ({ section, title, words: words(body) }));
const contents = [...guide.matchAll(/data-guide-section="([^"]+)"/g)].map(([, section]) => section);

test('every guide page is read by the pager', () => {
  assert.equal(pages.length, (guide.match(/<article /g) ?? []).length);
  assert.ok(pages.every((page) => page.title.trim()));
});

test('the Quick start comes first, so a new player sees only it', () => {
  const quick = pages.filter((page) => page.section === 'quick').length;
  assert.ok(quick > 0 && quick <= 4);
  assert.ok(pages.slice(0, quick).every((page) => page.section === 'quick'));
  assert.equal(contents[0], 'quick');
});

test('the contents list every section, in page order', () => {
  assert.deepEqual(contents, [...new Set(pages.map((page) => page.section))]);
});

test('the guide stays short enough to read before playing', () => {
  const total = (list) => list.reduce((sum, page) => sum + page.words, 0);
  assert.ok(total(pages.filter((page) => page.section === 'quick')) <= 100);
  assert.ok(total(pages) <= 700);
  for (const page of pages) assert.ok(page.words <= 80, `${page.title}: ${page.words} words`);
});
