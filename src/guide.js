// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import { drawGuideArt, animateGuideArt } from './guide-art.js';

export function initGuide() {
  const $ = (id) => document.getElementById(id);
  const dialog = $('menu-dialog');
  const pages = [...document.querySelectorAll('.guide-page')];
  const links = [...document.querySelectorAll('[data-guide-page]')];
  let page = -1;
  let frame = 0;

  // Explainer canvases play only while their page is showing (stills otherwise,
  // and always under reduced motion).
  function stopAnimation() { cancelAnimationFrame(frame); frame = 0; }
  function animate(element) {
    stopAnimation();
    if (!element?.querySelector('canvas[data-guide-art^="en-passant"], canvas[data-guide-art="castle"], canvas[data-guide-art="fork"], canvas[data-guide-art="combo"]')) return;
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
    $('menu-home').hidden = true;
    $('guide').hidden = false;
    $('guide-contents').hidden = index !== -1;
    $('guide-pagination').hidden = index === -1;
    pages.forEach((element, i) => { element.hidden = i !== index; });
    animate(pages[index]);
    $('guide-title').textContent = index === -1 ? 'How to play' : links[index].firstChild.textContent.trim();
    $('guide-back').textContent = index === -1 ? '← Menu' : '← Contents';
    $('guide-previous').disabled = index === 0;
    $('guide-next').textContent = index === pages.length - 1 ? 'Contents →' : 'Next →';
    dialog.setAttribute('aria-labelledby', 'guide-title');
    dialog.scrollTop = 0;
    if (focus) $('guide-title').focus({ preventScroll: true });
  }

  function showMenu(focus = true) {
    stopAnimation();
    $('guide').hidden = true;
    $('menu-home').hidden = false;
    dialog.setAttribute('aria-labelledby', 'menu-title');
    dialog.scrollTop = 0;
    if (focus) $('guide-button').focus({ preventScroll: true });
  }

  $('guide-button').addEventListener('click', () => showPage(-1));
  links.forEach((button, index) => button.addEventListener('click', () => showPage(index)));
  $('guide-back').addEventListener('click', () => page === -1 ? showMenu() : showPage(-1));
  $('guide-previous').addEventListener('click', () => showPage(page - 1));
  $('guide-next').addEventListener('click', () => showPage(page === pages.length - 1 ? -1 : page + 1));
  dialog.addEventListener('close', () => showMenu(false));
  drawGuideArt($('guide'));
  // Opens the guide on its first section inside an already-open menu dialog.
  return { openFirstPage: () => showPage(0) };
}
