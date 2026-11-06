// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
// Optional background music, off by default. Each edition draws three different
// CC0 loops from the library below, one per floor (credits in
// public/licenses/music.txt). A track downloads only when its floor is played
// with music on, so the offline precache stays small for everyone.
import { hash, random } from './random.js';

export const MUSIC_TRACKS = [
  'old-tower-inn', 'haunted-house', 'perilous-dungeon',
  'adventure-stage-1', 'adventure-stage-2', 'adventure-boss-fight', 'adventure-stage-select',
  'sinister-abode',
  'nes-02-doom', 'nes-02-incomplete', 'nes-03-blues', 'nes-03-cheery', 'nes-05-hectic', 'nes-07-jazz',
  'nes-07-lost-blues', 'nes-07-simple', 'nes-11-soft-then-loud', 'nes-19-upbeat', 'nes-23-chill',
].map((name) => `music/${name}.mp3`);

/**
 * The three floor tracks for an edition date, all different. Seeded separately
 * from generation, so the soundtrack never changes a certified dungeon.
 * Changing the library re-deals soundtracks, but never dungeons.
 */
export function editionTracks(date) {
  const next = random(hash(`music:${date}`));
  const pool = [...MUSIC_TRACKS];
  for (let i = 0; i < 3; i++) {
    const j = i + Math.floor(next() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

const VOLUME = 0.3;
const FADE = 0.8;

export function createMusic() {
  let context = null;
  let master = null;
  let enabled = false;
  let wanted = null;
  let playing = null;
  let request = 0;
  const buffers = new Map();

  function audio() {
    if (!context) {
      context = new (window.AudioContext || window.webkitAudioContext)();
      master = context.createGain();
      master.gain.value = VOLUME;
      master.connect(context.destination);
    }
    return context;
  }
  function load(path) {
    if (!buffers.has(path)) {
      const pending = fetch(new URL(path, document.baseURI))
        .then((response) => { if (!response.ok) throw new Error(`Music ${response.status}`); return response.arrayBuffer(); })
        .then((data) => new Promise((resolve, reject) => audio().decodeAudioData(data, resolve, reject)));
      // A failed download (offline before it was ever cached) can be retried later.
      pending.catch(() => buffers.delete(path));
      buffers.set(path, pending);
      // Keep only a few decoded tracks in memory across floors and editions.
      if (buffers.size > 4) buffers.delete(buffers.keys().next().value);
    }
    return buffers.get(path);
  }
  function fadeOut(track) {
    const now = context.currentTime;
    track.gain.gain.cancelScheduledValues(now);
    track.gain.gain.setValueAtTime(track.gain.gain.value, now);
    track.gain.gain.linearRampToValueAtTime(0, now + FADE);
    try { track.source.stop(now + FADE); } catch {}
  }
  async function sync() {
    const target = enabled ? wanted : null;
    if ((playing?.path ?? null) === target) return;
    const token = ++request;
    if (playing) { fadeOut(playing); playing = null; }
    if (target === null) return;
    let buffer;
    try { buffer = await load(target); } catch { return; }
    if (token !== request) return;
    const ctx = audio();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE);
    source.connect(gain);
    gain.connect(master);
    source.start();
    playing = { path: target, source, gain };
  }

  return {
    /** Turn music on or off. Creating the audio context waits for a real choice. */
    setEnabled(on) { enabled = on; if (on) audio(); sync(); },
    /** The track that should play, from editionTracks(), or null for silence. */
    setTrack(path) { wanted = MUSIC_TRACKS.includes(path) ? path : null; sync(); },
    /** Browsers start audio only after a tap or key press. */
    unlock() { if (enabled && context?.state === 'suspended') context.resume().catch(() => {}); },
  };
}
