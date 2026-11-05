// Production-only local preview at the same project prefix as GitHub Pages.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const prefix = '/dungeon-chess-daily/';
const port = Number(process.env.PORT || 4320);
const host = process.env.HOST || '127.0.0.1';
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
    }
    const url = new URL(request.url, `http://${host}:${port}`);
    if (url.pathname === '/' || url.pathname === prefix.slice(0, -1)) {
      response.writeHead(302, { Location: prefix }); response.end(); return;
    }
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith(prefix)) { response.writeHead(404); response.end('Not found'); return; }
    const relative = pathname.slice(prefix.length) || 'index.html';
    const file = resolve(directory, relative);
    if (!file.startsWith(directory + sep) || !(await stat(file)).isFile()) {
      response.writeHead(404); response.end('Not found'); return;
    }
    const data = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    response.writeHead(error instanceof URIError ? 400 : 404);
    response.end('Not found');
  }
});

server.listen(port, host, () => console.log(`Production preview: http://${host}:${port}${prefix}`));
