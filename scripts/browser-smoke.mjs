// Desktop integration smoke test, not a substitute for Android/iPhone trials.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStaticHandler } from './serve.mjs';

const base = path.join(tmpdir(), 'opencode');
await mkdir(base, { recursive: true });
const profile = await mkdtemp(path.join(base, 'el-peaton-browser-'));
const server = createServer(createStaticHandler());
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const activityUrl = process.argv.find((arg) => arg.startsWith('--url='))?.slice(6) ?? `http://127.0.0.1:${server.address().port}/`;
const testUrl = new URL(activityUrl);
testUrl.searchParams.set('diagnostico', '1');
const executable = process.env.BROWSER_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
  '--remote-debugging-port=0', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
let browserEndpoint;
try {
  browserEndpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Browser startup timeout')), 15000);
    browser.once('error', (error) => { clearTimeout(timeout); reject(error); });
    browser.stderr.on('data', (chunk) => {
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(chunk.toString());
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  const origin = new URL(browserEndpoint).origin.replace('ws:', 'http:');
  const page = await (await fetch(`${origin}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  const exceptions = [];
  const requests = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (!message.id) return;
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timeout);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timeout`)); }, 10000);
    pending.set(requestId, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (expression, ms = 30000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timeout: ${expression}; state: ${await evaluate('document.querySelector("#mensaje")?.textContent')}; exceptions: ${JSON.stringify(exceptions)}; resources: ${JSON.stringify(await evaluate('performance.getEntriesByType("resource").map(e=>({url:e.name,bytes:e.transferSize}))'))}`);
  };
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Network.enable');
  await command('Page.navigate', { url: testUrl.href });
  await wait('!!window.elPeatonDiagnostics && document.querySelector("#comenzar")?.disabled === false');
  assert.equal(await evaluate('document.querySelectorAll(".a-enter-vr-button, .a-enter-ar-button, .a-orientation-modal").length'), 0);
  await evaluate('document.querySelector("a-scene").enterVR()');
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', windowsVirtualKeyCode: 70 });
  assert.equal(await evaluate('document.querySelector("a-scene").is("vr-mode")'), false);
  assert.equal(await evaluate('document.querySelector("a-scene").renderer.xr.enabled'), false);
  assert.ok(await evaluate('Array.from(document.querySelectorAll("video[data-src]")).every(video => video.dataset.src.endsWith("-fade-2s.mp4"))'));
  assert.equal(await evaluate('performance.getEntriesByType("resource").filter(e => /\\.mp4/.test(e.name)).length'), 0);
  const point = await evaluate('(() => { const r = document.querySelector("#comenzar").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  await wait('window.elPeatonDiagnostics.report().metrics.arReadyMs !== null', 50000);
  await evaluate('document.querySelectorAll("[mindar-image-target]")[0].emit("targetFound")');
  await wait('window.elPeatonDiagnostics.report().metrics.firstFrameMs[0] !== undefined');
  assert.equal(await evaluate('document.querySelector("#videoPeaton1").muted'), false);
  const time = await evaluate('document.querySelector("#videoPeaton1").currentTime');
  await evaluate('document.querySelectorAll("[mindar-image-target]")[0].emit("targetLost")');
  await wait('document.querySelector("#videoPeaton1").paused');
  await evaluate('document.querySelectorAll("[mindar-image-target]")[0].emit("targetFound")');
  await wait('!document.querySelector("#videoPeaton1").paused');
  assert.ok(await evaluate('document.querySelector("#videoPeaton1").currentTime') >= time);
  for (const index of [1, 2]) {
    await evaluate(`document.querySelectorAll('[mindar-image-target]')[${index}].emit('targetFound')`);
    await wait(`window.elPeatonDiagnostics.report().metrics.firstFrameMs[${index}] !== undefined`);
    assert.equal(await evaluate('Array.from(document.querySelectorAll("video[data-src]")).filter(v => !v.paused).length'), 1);
  }
  await evaluate('document.querySelector("#sonido").click()');
  assert.ok(await evaluate('Array.from(document.querySelectorAll("video[data-src]")).every(v => v.muted)'));
  await evaluate('document.querySelector("#sonido").click()');
  assert.ok(await evaluate('Array.from(document.querySelectorAll("video[data-src]")).every(v => !v.muted)'));
  await evaluate('Object.defineProperty(document, "hidden", {configurable:true, value:true}); document.dispatchEvent(new Event("visibilitychange"))');
  assert.ok(await evaluate('Array.from(document.querySelectorAll("video[data-src]")).every(v => v.paused)'));
  const report = await evaluate('window.elPeatonDiagnostics.report()');
  assert.deepEqual(exceptions, []);
  report.externalRequests = requests.filter((url) => /^https?:/.test(url) && new URL(url).hostname !== testUrl.hostname);
  assert.deepEqual(report.externalRequests, []);
  report.environment = `Edge headless, software WebGL, fake camera, ${testUrl.origin}; synthetic target events; not a mobile benchmark or audible audio test`;
  await mkdir(new URL('../docs/', import.meta.url), { recursive: true });
  await writeFile(new URL('../docs/browser-smoke.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  console.log('Desktop browser smoke passed; no VR button or entry, no initial MP4 requests, arReady, first frames of all scenes, no rewind, exclusivity, mute and background pause.');
  console.log(JSON.stringify(report.durations, null, 2));
} finally {
  socket?.close();
  if (browserEndpoint) {
    const connection = new WebSocket(browserEndpoint);
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      connection.addEventListener('open', () => connection.send(JSON.stringify({ id: 1, method: 'Browser.close' })));
      connection.addEventListener('close', () => { clearTimeout(timer); resolve(); });
      connection.addEventListener('error', () => { clearTimeout(timer); resolve(); });
    });
    connection.close();
  }
  if (browser.exitCode === null && browser.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
    else browser.kill();
  }
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
