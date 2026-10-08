import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createStaticHandler, startServer } from '../scripts/serve.mjs';
import { loadTlsOptions } from '../scripts/tls.mjs';

let temporary;
let dist;
let server;
let port;
let versioned;
const video = '0123456789';

function get(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: url, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'ar-server-'));
  dist = path.join(temporary, 'dist');
  await mkdir(path.join(dist, 'assets'), { recursive: true });
  await mkdir(path.join(dist, 'vendored'));
  await mkdir(path.join(temporary, 'public'));
  const script = 'export const version = 1;';
  const digest = createHash('sha256').update(script).digest('hex');
  versioned = `/assets/app.${digest}.js`;
  await Promise.all([
    writeFile(path.join(dist, 'index.html'), '<html>production</html>'),
    writeFile(path.join(dist, 'clip.mp4'), video),
    writeFile(path.join(dist, 'image.png'), 'png'),
    writeFile(path.join(dist, 'target.mind'), 'mind'),
    writeFile(path.join(dist, 'app.js'), script),
    writeFile(path.join(dist, 'style.css'), 'body {}'),
    writeFile(path.join(dist, 'empty.mp4'), ''),
    writeFile(path.join(dist, versioned.slice(1)), script),
    writeFile(path.join(dist, 'assets', 'unversioned.js'), script),
    writeFile(path.join(dist, 'vendored', `wrong.${'a'.repeat(64)}.js`), script),
    writeFile(path.join(temporary, 'secret.txt'), 'private'),
  ]);
  server = createServer(createStaticHandler({ distDir: dist }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('serves dist index, expected MIME types, and query strings', async () => {
  for (const [url, mime] of [
    ['/', 'text/html; charset=utf-8'], ['/clip.mp4?rev=2', 'video/mp4'],
    ['/image.png', 'image/png'], ['/target.mind', 'application/octet-stream'],
    ['/app.js', 'text/javascript; charset=utf-8'], ['/style.css', 'text/css; charset=utf-8'],
  ]) {
    const response = await get(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], mime);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
  }
});

test('single closed, open, suffix, and clipped ranges return 206', async () => {
  for (const [range, expected, contentRange] of [
    ['bytes=2-5', '2345', 'bytes 2-5/10'], ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=8-99', '89', 'bytes 8-9/10'],
    ['bytes=-99', video, 'bytes 0-9/10'],
  ]) {
    const response = await get('/clip.mp4', { headers: { Range: range } });
    assert.equal(response.status, 206);
    assert.equal(response.body, expected);
    assert.equal(response.headers['content-range'], contentRange);
    assert.equal(Number(response.headers['content-length']), expected.length);
  }
});

test('invalid or multiple ranges and empty files return 416', async () => {
  for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'items=0-1', 'bytes=abc', 'bytes=9007199254740992-']) {
    const response = await get('/clip.mp4', { headers: { Range: range } });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers['content-range'], 'bytes */10');
    assert.equal(response.body, '');
  }
  assert.equal((await get('/empty.mp4', { headers: { Range: 'bytes=0-' } })).status, 416);
  assert.equal((await get('/empty.mp4')).headers['content-length'], '0');
});

test('HEAD preserves GET headers without a response body', async () => {
  for (const headers of [{}, { Range: 'bytes=2-5' }, { Range: 'bytes=99-' }]) {
    const head = await get('/clip.mp4', { method: 'HEAD', headers });
    const full = await get('/clip.mp4', { headers });
    assert.equal(head.status, full.status);
    assert.equal(head.headers['content-length'], full.headers['content-length']);
    assert.equal(head.headers['content-range'], full.headers['content-range']);
    assert.equal(head.headers.etag, full.headers.etag);
    assert.equal(head.body, '');
  }
  const missing = await get('/missing', { method: 'HEAD' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body, '');
});

test('ETag revalidation, precedence, and If-Range use the current content', async () => {
  const initial = await get('/clip.mp4');
  for (const tag of [initial.headers.etag, `W/${initial.headers.etag}`, `"other", ${initial.headers.etag}`, '*']) {
    const response = await get('/clip.mp4', { headers: { 'If-None-Match': tag, Range: 'bytes=99-' } });
    assert.equal(response.status, 304);
    assert.equal(response.body, '');
    assert.equal(response.headers['content-length'], undefined);
  }
  assert.equal((await get('/clip.mp4', { headers: { Range: 'bytes=0-2', 'If-Range': initial.headers.etag } })).status, 206);
  for (const tag of ['"old"', `W/${initial.headers.etag}`, 'Wed, 01 Jan 2025 00:00:00 GMT']) {
    assert.equal((await get('/clip.mp4', { headers: { Range: 'bytes=0-2', 'If-Range': tag } })).status, 200);
  }
  await writeFile(path.join(dist, 'clip.mp4'), 'abcdefghij');
  try {
    const changed = await get('/clip.mp4', { headers: { 'If-None-Match': initial.headers.etag } });
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.etag, initial.headers.etag);
    assert.equal(changed.body, 'abcdefghij');
    assert.equal((await get('/clip.mp4', { headers: { Range: 'bytes=0-2', 'If-Range': initial.headers.etag } })).status, 200);
  } finally {
    await writeFile(path.join(dist, 'clip.mp4'), video);
  }
});

test('only content-verified versioned assets are immutable', async () => {
  assert.equal((await get('/')).headers['cache-control'], 'no-cache');
  for (const url of ['/clip.mp4', '/image.png', '/assets/unversioned.js', `/vendored/wrong.${'a'.repeat(64)}.js`]) {
    assert.equal((await get(url)).headers['cache-control'], 'public, no-cache');
  }
  assert.equal((await get(versioned)).headers['cache-control'], 'public, max-age=31536000, immutable');
});

test('rejects traversal, malformed URI, and non-GET methods; missing files are 404', async () => {
  for (const url of ['/../secret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt']) {
    assert.equal((await get(url)).status, 403, url);
  }
  for (const url of ['/%ZZ', '/%C0%AF', '/%00', '/%5c..%5csecret.txt', '/C:/secret.txt']) {
    assert.equal((await get(url)).status, 400, url);
  }
  for (const url of ['/missing.js', '/secret.txt', '/public/secret.txt', '/app.js/child']) {
    assert.equal((await get(url)).status, 404, url);
  }
  const response = await get('/', { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'GET, HEAD');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('rejects symlink escapes from dist', async (t) => {
  const link = path.join(dist, 'escape');
  try {
    await symlink(temporary, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip(`Symlinks unavailable: ${error.code}`);
    throw error;
  }
  assert.equal((await get('/escape/secret.txt')).status, 403);
});

test('unexpected filesystem errors return 500 without filesystem details', async (t) => {
  const mocked = t.mock.method(fs, 'open', async () => {
    throw Object.assign(new Error('private filesystem details'), { code: 'EIO' });
  });
  try {
    const response = await get('/clip.mp4');
    assert.equal(response.status, 500);
    assert.equal(response.body, 'Internal Server Error\n');
    assert.equal(response.headers['cache-control'], 'no-store');
  } finally {
    mocked.mock.restore();
  }
});

test('TLS defaults are outside the project and dist/public credentials are forbidden', async () => {
  const root = path.join(temporary, 'project');
  const certs = path.join(temporary, 'el-peaton-certs');
  await mkdir(root);
  await mkdir(certs);
  await writeFile(path.join(certs, 'cert.pem'), 'test-cert');
  await writeFile(path.join(certs, 'key.pem'), 'test-key');
  const options = await loadTlsOptions({ env: {}, rootDir: root });
  assert.equal(options.cert.toString(), 'test-cert');
  assert.equal(options.key.toString(), 'test-key');
  assert.equal(options.minVersion, 'TLSv1.2');
  for (const name of ['TLS_CERT', 'TLS_KEY']) {
    for (const folder of ['dist', 'public']) {
      await assert.rejects(loadTlsOptions({ rootDir: temporary, env: { [name]: `${folder}/secret.pem` } }), /outside dist\/public/);
    }
    await assert.rejects(loadTlsOptions({ rootDir: root, env: { [name]: '' } }), /must not be empty/);
  }
  await assert.rejects(loadTlsOptions({ rootDir: root, env: { TLS_CERT: 'absent.pem' } }), /Cannot load TLS_CERT/);
});

test('TLS rejects symlink aliases pointing into dist/public', async (t) => {
  const alias = path.join(temporary, 'certificate-alias');
  try {
    await symlink(dist, alias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip(`Symlinks unavailable: ${error.code}`);
    throw error;
  }
  await assert.rejects(loadTlsOptions({ rootDir: temporary, env: { TLS_CERT: 'certificate-alias/app.js', TLS_KEY: 'secret.txt' } }), /outside dist\/public/);
});

test('TLS also rejects credentials inside the repository but outside public/dist', async () => {
  await assert.rejects(loadTlsOptions({ rootDir: temporary, env: { TLS_CERT: 'secret.txt', TLS_KEY: 'secret.txt' } }), /outside the project\/repository/);
});

test('concurrent range requests share the digest and do not read the entire video repeatedly', async (t) => {
  await writeFile(path.join(dist, 'digest-test.mp4'), video);
  const original = fs.open;
  let opens = 0;
  const mocked = t.mock.method(fs, 'open', async (...args) => { opens++; return original(...args); });
  try {
    const responses = await Promise.all(Array.from({ length: 5 }, () => get('/digest-test.mp4', { headers: { Range: 'bytes=0-1' } })));
    assert.ok(responses.every((response) => response.status === 206 && response.body === '01'));
    assert.equal(opens, 6, 'one open per response and a single extra open for the shared hash');
    await get('/digest-test.mp4', { method: 'HEAD' });
    assert.equal(opens, 7);
  } finally { mocked.mock.restore(); }
});

test('invalid PORT fails before attempting HTTPS startup', async () => {
  for (const PORT of ['', '0', '65536', '5173x', '1.5', '-1']) {
    await assert.rejects(startServer({ env: { PORT } }), /PORT must be an integer/);
  }
});
