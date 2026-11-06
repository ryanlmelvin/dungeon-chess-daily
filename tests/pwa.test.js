import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const builder = fileURLToPath(new URL('../scripts/build-sw.mjs', import.meta.url));

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dungeon-pwa-'));
  await mkdir(join(directory, 'dist/assets'), { recursive: true });
  await writeFile(join(directory, 'dist/index.html'), '<html>Daily dungeon</html>');
  await writeFile(join(directory, 'dist/assets/game-abc123.js'), 'play();');
  await writeFile(join(directory, 'dist/update.html'), 'independent recovery');
  const build = async () => {
    execFileSync(process.execPath, [builder], { cwd: directory, stdio: 'pipe' });
    return {
      code: await readFile(join(directory, 'dist/sw.js'), 'utf8'),
      version: JSON.parse(await readFile(join(directory, 'dist/release.json'), 'utf8')).version,
    };
  };
  return { directory, build, clean: () => rm(directory, { recursive: true, force: true }) };
}

function workerEnvironment(code, { failAsset = false, offline = false } = {}) {
  const scope = 'https://example.test/dungeon-chess-daily/';
  const listeners = {};
  const data = new Map();
  const deleted = [];
  const requests = [];
  let activated = 0;
  const caches = {
    async open(name) {
      if (!data.has(name)) data.set(name, new Map());
      const entries = data.get(name);
      return {
        async put(key, response) { entries.set(String(key), response); },
        async match(key) { return entries.get(String(key)); },
      };
    },
    async delete(name) { deleted.push(name); return data.delete(name); },
    async keys() { return [...data.keys()]; },
  };
  const self = {
    registration: { scope },
    clients: { async claim() {} },
    addEventListener(type, handler) { listeners[type] = handler; },
    skipWaiting() { activated++; },
  };
  vm.runInNewContext(code, {
    self, caches, URL, Request, Response,
    fetch: async (request) => {
      const url = typeof request === 'string' ? request : request.url;
      requests.push(request);
      if (offline || (failAsset && url.endsWith('.js'))) throw new Error('network unavailable');
      return new Response(url.endsWith('update.html') ? 'fresh recovery' : `content for ${url}`);
    },
  });
  return {
    scope, data, requests, deleted,
    get activated() { return activated; },
    offline(value) { offline = value; },
    async lifecycle(type) {
      let promise;
      listeners[type]({ waitUntil(value) { promise = value; } });
      await promise;
    },
    message(data, ports = []) { listeners.message({ data, ports }); },
    async request(path, mode = 'cors') {
      let response;
      const request = new Request(new URL(path, scope));
      Object.defineProperty(request, 'mode', { value: mode });
      listeners.fetch({ request, respondWith(value) { response = value; } });
      return await response;
    },
  };
}

test('release fingerprint changes with an asset but is stable across repeated builds', async () => {
  const f = await fixture();
  try {
    const first = await f.build();
    assert.equal((await f.build()).version, first.version);
    await writeFile(join(f.directory, 'dist/assets/game-abc123.js'), 'playBetter();');
    assert.notEqual((await f.build()).version, first.version);
  } finally { await f.clean(); }
});

test('offline project-path navigation and query strings use a complete verified shell', async () => {
  const f = await fixture();
  try {
    const built = await f.build();
    const env = workerEnvironment(built.code);
    await env.lifecycle('install');
    assert.ok(env.requests.every((request) => request.integrity.startsWith('sha256-')));
    assert.equal(env.activated, 0, 'a downloaded update must wait for consent');
    env.offline(true);
    const page = await env.request('./?shared=1', 'navigate');
    assert.match(await page.text(), /index\.html/);
    const asset = await env.request('./assets/game-abc123.js');
    assert.equal(asset.status, 200);
    env.message({ type: 'SKIP_WAITING' });
    assert.equal(env.activated, 1);
  } finally { await f.clean(); }
});

test('failed offline download removes its incomplete release and preserves other apps', async () => {
  const f = await fixture();
  try {
    const env = workerEnvironment((await f.build()).code, { failAsset: true });
    env.data.set('another-app-cache', new Map([['saved', new Response('keep')]]));
    await assert.rejects(env.lifecycle('install'), /network unavailable/);
    assert.ok(env.data.has('another-app-cache'));
    assert.equal(env.deleted.length, 1);
    assert.ok(env.deleted[0].startsWith('dungeon-chess-daily:/dungeon-chess-daily/:'));
  } finally { await f.clean(); }
});

test('recovery reaches network and older hashed assets remain available to open tabs', async () => {
  const f = await fixture();
  try {
    const env = workerEnvironment((await f.build()).code);
    await env.lifecycle('install');
    const oldAsset = `${env.scope}assets/older-456.js`;
    env.data.set('dungeon-chess-daily:/dungeon-chess-daily/:old', new Map([[oldAsset, new Response('old bundle')]]));
    await env.lifecycle('activate');
    assert.equal(await (await env.request('./update.html')).text(), 'fresh recovery');
    assert.equal(env.requests.at(-1).cache, 'no-store');
    env.offline(true);
    assert.equal(await (await env.request('./assets/older-456.js')).text(), 'old bundle');
    assert.equal(env.deleted.length, 0);
  } finally { await f.clean(); }
});

test('optional music stays out of the precache and is kept offline after its first play', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.directory, 'dist/music'), { recursive: true });
    await writeFile(join(f.directory, 'dist/music/floor.mp3'), 'chiptune');
    const built = await f.build();
    const withoutMusic = built.version;
    await writeFile(join(f.directory, 'dist/music/floor.mp3'), 'another chiptune');
    assert.equal((await f.build()).version, withoutMusic, 'music never forces a new release');
    const env = workerEnvironment(built.code);
    await env.lifecycle('install');
    assert.ok(env.requests.every((request) => !request.url.includes('/music/')), 'install must not download music');
    const first = await env.request('./music/floor.mp3');
    assert.equal(first.status, 200);
    env.offline(true);
    const again = await env.request('./music/floor.mp3');
    assert.equal(again.status, 200);
  } finally { await f.clean(); }
});
