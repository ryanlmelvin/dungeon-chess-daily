// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
// Optional background music, off by default. Each floor has its own CC0 loop
// (credits in public/licenses/music.txt). Tracks download only once a player
// turns music on, so the offline precache stays small for everyone else.

export const MUSIC_TRACKS = [
  'music/old-tower-inn.mp3',
  'music/haunted-house.mp3',
  'music/perilous-dungeon.mp3',
];
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
  function load(index) {
    if (!buffers.has(index)) {
      const pending = fetch(new URL(MUSIC_TRACKS[index], document.baseURI))
        .then((response) => { if (!response.ok) throw new Error(`Music ${response.status}`); return response.arrayBuffer(); })
        .then((data) => new Promise((resolve, reject) => audio().decodeAudioData(data, resolve, reject)));
      // A failed download (offline before it was ever cached) can be retried later.
      pending.catch(() => buffers.delete(index));
      buffers.set(index, pending);
    }
    return buffers.get(index);
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
    if ((playing?.index ?? null) === target) return;
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
    playing = { index: target, source, gain };
  }

  return {
    /** Turn music on or off. Creating the audio context waits for a real choice. */
    setEnabled(on) { enabled = on; if (on) audio(); sync(); },
    /** The floor whose loop should play, or null for silence. */
    setTrack(index) { wanted = Number.isInteger(index) && MUSIC_TRACKS[index] ? index : null; sync(); },
    /** Browsers start audio only after a tap or key press. */
    unlock() { if (enabled && context?.state === 'suspended') context.resume().catch(() => {}); },
  };
}
