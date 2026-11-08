// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
export function hash(text) {
  return hashMore(2166136261, text) >>> 0;
}
/**
 * FNV-1a continued over `text` from a running `value` (2166136261 to start):
 * hash(a + b) === hashMore(hashMore(2166136261, a), b) >>> 0 whenever `a`
 * doesn't end in the first half of a surrogate pair. Lets a caller hash a
 * shared prefix once.
 */
export function hashMore(value, text) {
  // FNV-1a over each character's first UTF-16 unit, as `for (const char of
  // text)` with char.charCodeAt(0) once did, without a string per character:
  // a surrogate pair is one character, so its second unit is skipped.
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    value = Math.imul(value ^ unit, 16777619);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
  }
  return value;
}
export function random(seed) {
  let value = seed;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

