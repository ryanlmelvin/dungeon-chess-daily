import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { MUSIC_TRACKS, editionTracks } from '../src/music.js';
import { getDaily } from '../src/game.js';

test('every library track ships in public/music', () => {
  assert.equal(new Set(MUSIC_TRACKS).size, MUSIC_TRACKS.length);
  for (const track of MUSIC_TRACKS) assert.ok(existsSync(new URL(`../public/${track}`, import.meta.url)), track);
});

test('each edition draws three different tracks, the same on every device', () => {
  const seen = new Set();
  const start = Date.parse('2026-01-01');
  for (let day = 0; day < 365; day++) {
    const date = new Date(start + day * 86_400_000).toISOString().slice(0, 10);
    const tracks = editionTracks(date);
    assert.equal(tracks.length, 3);
    assert.equal(new Set(tracks).size, 3, date);
    assert.deepEqual(editionTracks(date), tracks);
    tracks.forEach((track) => seen.add(track));
  }
  assert.equal(seen.size, MUSIC_TRACKS.length, 'a year of editions uses the whole library');
});

test('the soundtrack never changes the generated dungeon', () => {
  const before = JSON.stringify(getDaily('2026-11-05'));
  editionTracks('2026-11-05');
  assert.equal(JSON.stringify(getDaily('2026-11-05')), before);
});
