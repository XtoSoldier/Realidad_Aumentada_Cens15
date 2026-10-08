import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { createServer } from 'node:https';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { isWithin, loadTlsOptions, projectRoot } from './tls.mjs';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mind': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendError(req, res, status) {
  const messages = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 500: 'Internal Server Error' };
  const body = `${messages[status]}\n`;
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...(status === 405 ? { Allow: 'GET, HEAD' } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
  if (first === null) return last > 0 ? [Math.max(0, size - last), size - 1] : null;
  if (first >= size || (last !== null && last < first)) return null;
  return [first, last === null ? size - 1 : Math.min(last, size - 1)];
}

export function createStaticHandler({ distDir = path.join(projectRoot, 'dist') } = {}) {
  const root = path.resolve(distDir);
  const hashes = new Map();
  return async function staticHandler(req, res) {
    let file;
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(req, res, 405);
      let pathname;
      try {
        // Do not let URL normalization hide traversal before validating it.
        pathname = decodeURIComponent(req.url.split('?')[0]);
      } catch {
        return sendError(req, res, 400);
      }
      if (!pathname.startsWith('/') || /[\x00-\x1f\x7f\\:]/.test(pathname)) return sendError(req, res, 400);
      if (pathname.split('/').includes('..')) return sendError(req, res, 403);
      const candidate = path.resolve(root, `.${pathname}`);
      if (!isWithin(root, candidate)) return sendError(req, res, 403);
      if ((await fs.lstat(root)).isSymbolicLink()) return sendError(req, res, 403);
      const realRoot = await fs.realpath(root);
      let filename = await fs.realpath(candidate);
      if (!isWithin(realRoot, filename)) return sendError(req, res, 403);
      if ((await fs.lstat(filename)).isDirectory()) {
        filename = await fs.realpath(path.join(filename, 'index.html'));
        if (!isWithin(realRoot, filename)) return sendError(req, res, 403);
      }
      file = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await file.stat();
      if (!stat.isFile()) return sendError(req, res, 404);

      // Do not reread the entire MP4 for every range or every user. Concurrent
      // requests share one digest; changed filesystem metadata invalidates it.
      const signature = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      let cached = hashes.get(filename);
      if (!cached || cached.signature !== signature) {
        const digestPromise = (async () => {
          const hash = createHash('sha256');
          const source = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
          try {
            for await (const chunk of source.createReadStream({ autoClose: false })) hash.update(chunk);
            return hash.digest('hex');
          } finally { await source.close(); }
        })();
        cached = { signature, digestPromise };
        if (hashes.size >= 512) hashes.delete(hashes.keys().next().value);
        hashes.set(filename, cached);
        digestPromise.catch(() => { if (hashes.get(filename) === cached) hashes.delete(filename); });
      }
      const digest = await cached.digestPromise;
      const etag = `"${digest}"`;
      const relative = path.relative(realRoot, filename).split(path.sep).join('/');
      const versioned = /^(assets|vendored)\//.test(relative)
        && path.basename(filename).split(/[._-]/).includes(digest);
      const headers = {
        'Content-Type': mimeTypes[path.extname(filename).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'bytes',
        ETag: etag,
      };
      if (path.basename(filename) === 'index.html') headers['Cache-Control'] = 'no-cache';
      const noneMatch = req.headers['if-none-match'];
      if (noneMatch && (noneMatch.trim() === '*' || noneMatch.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag))) {
        res.writeHead(304, headers);
        return res.end();
      }
      let range;
      if (req.headers.range && (!req.headers['if-range'] || req.headers['if-range'] === etag)) {
        range = parseRange(req.headers.range, stat.size);
        if (!range) {
          res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}`, 'Content-Length': 0 });
          return res.end();
        }
      }
      const [start, end] = range ?? [0, stat.size - 1];
      headers['Content-Length'] = range ? end - start + 1 : stat.size;
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === 'HEAD' || stat.size === 0) return res.end();
      await pipeline(file.createReadStream({ start, end, autoClose: false }), res);
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error);
      } else {
        const status = ['ENOENT', 'ENOTDIR'].includes(error.code) ? 404
          : ['EACCES', 'EPERM', 'ELOOP'].includes(error.code) ? 403 : 500;
        sendError(req, res, status);
      }
    } finally {
      await file?.close().catch(() => {});
    }
  };
}

export async function startServer({ env = process.env } = {}) {
  const portText = env.PORT ?? '5173';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const distDir = path.join(projectRoot, 'dist');
  const dist = await fs.lstat(distDir);
  if (!dist.isDirectory() || dist.isSymbolicLink()) throw new Error('dist must be a real directory; build before serving');
  const server = createServer(await loadTlsOptions({ env }), createStaticHandler({ distDir }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  console.log(`HTTPS static server listening on https://0.0.0.0:${port}`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer().catch((error) => {
    console.error(`Cannot start HTTPS server: ${error.message}`);
    process.exitCode = 1;
  });
}
