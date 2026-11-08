// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import { drawGuideArt, animateGuideArt, hasAnimatedArt } from './guide-art.js';

// "How to play": a contents page, then short pages that each fit a phone screen
// without scrolling. The Quick start pages (data-section="quick") come first. A
// brand-new player gets only those, counted and ending in Play; the game
// explains the rest as it comes up. The menu opens the whole manual.
export function initGuide() {
  const $ = (id) => document.getElementById(id);
  const dialog = $('menu-dialog');
  const pages = [...document.querySelectorAll('.guide-page')];
  const quickPages = pages.filter((element) => element.dataset.section === 'quick').length;
  let page = -1;
  let quickStart = false;
  let frame = 0;

  // Explainer canvases play only while their page is showing (stills otherwise,
  // and always under reduced motion).
  function stopAnimation() { cancelAnimationFrame(frame); frame = 0; }
  function animate(element) {
    stopAnimation();
    if (!element || !hasAnimatedArt(element)) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = performance.now();
    const step = (now) => {
      if (element.hidden || !dialog.open) { frame = 0; return; }
      animateGuideArt(element, now - start);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  function showPage(index, focus = true) {
    page = index;
    const contents = index === -1;
    const last = (quickStart ? quickPages : pages.length) - 1;
    $('menu-home').hidden = true;
    $('guide').hidden = false;
    $('guide-contents').hidden = !contents;
    $('guide-back').hidden = !contents;
    $('guide-pagination').hidden = contents;
    pages.forEach((element, i) => { element.hidden = i !== index; });
    dialog.classList.toggle('guide-paging', !contents);
    dialog.classList.toggle('guide-quick-start', quickStart);
    animate(pages[index]);
    $('guide-title').textContent = contents ? 'How to play' : pages[index].dataset.title;
    $('guide-previous').disabled = index === 0;
    // The Quick start counts its pages and ends in Play; the manual offers its contents.
    $('guide-count').hidden = !quickStart;
    $('guide-count').textContent = `${index + 1} / ${quickPages}`;
    $('guide-toc').hidden = quickStart;
    $('guide-next').textContent = quickStart && index === last ? 'Play' : 'Next →';
    $('guide-next').disabled = !quickStart && index === last;
    dialog.setAttribute('aria-labelledby', 'guide-title');
    dialog.scrollTop = 0;
    if (focus) $('guide-title').focus({ preventScroll: true });
  }

  function showMenu(focus = true) {
    stopAnimation();
    quickStart = false;
    dialog.classList.remove('guide-paging', 'guide-quick-start');
    $('guide').hidden = true;
    $('menu-home').hidden = false;
    dialog.setAttribute('aria-labelledby', 'menu-title');
    dialog.scrollTop = 0;
    if (focus) $('guide-button').focus({ preventScroll: true });
  }

  const firstPage = (section) => pages.findIndex((element) => element.dataset.section === section);
  $('guide-button').addEventListener('click', () => { quickStart = false; showPage(-1); });
  document.querySelectorAll('[data-guide-section]').forEach((button) => {
    button.addEventListener('click', () => showPage(firstPage(button.dataset.guideSection)));
  });
  $('guide-back').addEventListener('click', () => showMenu());
  $('guide-toc').addEventListener('click', () => showPage(-1));
  $('guide-previous').addEventListener('click', () => showPage(page - 1));
  $('guide-next').addEventListener('click', () => (quickStart && page === quickPages - 1 ? dialog.close() : showPage(page + 1)));
  dialog.addEventListener('close', () => showMenu(false));
  drawGuideArt($('guide'));
  // A brand-new player's Quick start, inside an already-open menu dialog.
  return { openQuickStart: () => { quickStart = true; showPage(0); } };
}
