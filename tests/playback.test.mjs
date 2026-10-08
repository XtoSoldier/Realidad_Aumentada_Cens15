import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaybackController } from '../src/app.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));
function setup() {
  const states = [];
  const events = [];
  const timers = new Map();
  let timerId = 0;
  const videos = Array.from({ length: 3 }, (_, index) => ({
    dataset: { src: `/video${index}.mp4` }, src: '', paused: true,
    currentTime: 17, muted: false, volume: 1, playCalls: 0,
    pause() { this.paused = true; },
    play() { this.playCalls++; this.paused = false; return Promise.resolve(); },
  }));
  const controller = createPlaybackController({
    videos, lossDelay: 750,
    onState: (...state) => states.push(state), log: (...event) => events.push(event),
    setTimer(callback, delay) { assert.equal(delay, 750); timers.set(++timerId, callback); return timerId; },
    clearTimer(id) { timers.delete(id); },
  });
  return { controller, videos, states, events, timers, expire() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((callback) => callback()); } };
}

test('only the detected video receives a source and plays with original audio', async () => {
  const { controller, videos } = setup();
  assert.ok(videos.every((video) => !video.src));
  controller.found(1);
  await flush();
  assert.equal(videos[1].src, '/video1.mp4');
  assert.equal(videos[1].muted, false);
  assert.equal(videos[1].volume, 1);
  assert.equal(videos[1].currentTime, 17);
  assert.equal(videos[0].src, '');
  assert.equal(videos[2].src, '');
  assert.ok(videos[0].paused && videos[2].paused);
});

test('brief tracking loss cancels pause and never rewinds', async () => {
  const { controller, videos, timers } = setup();
  controller.found(0);
  await flush();
  controller.lost(0);
  assert.equal(timers.size, 1);
  assert.equal(videos[0].paused, false);
  controller.found(0);
  assert.equal(timers.size, 0);
  assert.equal(videos[0].playCalls, 1);
  assert.equal(videos[0].currentTime, 17);
});

test('long tracking loss pauses and reacquisition reuses the source and position', async () => {
  const { controller, videos, events, expire } = setup();
  controller.found(0);
  await flush();
  controller.lost(0);
  expire();
  assert.equal(videos[0].paused, true);
  controller.found(0);
  await flush();
  assert.equal(videos[0].paused, false);
  assert.equal(videos[0].currentTime, 17);
  assert.equal(events.filter(([event]) => event === 'videoRequest').length, 1);
});

test('switching scenes cancels the previous loss timer and pauses previous audio', async () => {
  const { controller, videos, timers } = setup();
  controller.found(0);
  await flush();
  controller.lost(0);
  controller.found(2);
  await flush();
  assert.equal(timers.size, 0);
  assert.equal(controller.active, 2);
  assert.equal(videos.filter((video) => !video.paused).length, 1);
  assert.ok(videos[0].paused);
  controller.lost(0);
  assert.equal(timers.size, 0);
});

test('audio policy rejection is explicit and retry invokes play in the new interaction', async () => {
  const { controller, videos, states } = setup();
  videos[0].play = function () { this.paused = true; return Promise.reject(Object.assign(new Error('Gesture required'), { name: 'NotAllowedError' })); };
  controller.found(0);
  await flush();
  assert.equal(states.at(-1)[0], 'blocked');
  assert.equal(videos[0].muted, false);
  videos[0].play = function () { this.paused = false; return Promise.resolve(); };
  controller.retryWithAudio();
  assert.equal(videos[0].paused, false);
  await flush();
  assert.equal(states.at(-1)[0], 'playing');
});

test('background pauses every scene, defers new downloads, and resumes the latest target without rewind', async () => {
  const { controller, videos } = setup();
  controller.found(0);
  await flush();
  controller.setVisible(false);
  assert.ok(videos.every((video) => video.paused));
  controller.found(2);
  assert.equal(videos[2].src, '');
  controller.setVisible(true);
  await flush();
  assert.equal(controller.active, 2);
  assert.equal(videos[0].currentTime, 17);
  assert.equal(videos.filter((video) => !video.paused).length, 1);
});

test('mute and unmute preserve the same media timeline', async () => {
  const { controller, videos } = setup();
  controller.found(0);
  await flush();
  controller.setMuted(true);
  await flush();
  assert.ok(videos.every((video) => video.muted));
  controller.setMuted(false);
  await flush();
  assert.ok(videos.every((video) => !video.muted && video.volume === 1));
  assert.equal(videos[0].currentTime, 17);
});

test('late play resolution cannot reactivate a previous scene', async () => {
  const { controller, videos } = setup();
  let resolve;
  videos[0].play = () => new Promise((done) => { resolve = () => { videos[0].paused = false; done(); }; });
  controller.found(0);
  controller.found(1);
  resolve();
  await flush();
  assert.ok(videos[0].paused);
  assert.equal(videos[1].paused, false);
});

test('repeated detections do not duplicate a pending play and retry can cancel it', async () => {
  const { controller, videos } = setup();
  let calls = 0;
  videos[0].play = () => { calls++; return new Promise(() => {}); };
  controller.found(0);
  controller.found(0);
  assert.equal(calls, 1);
  videos[0].play = function () { calls++; this.paused = false; return Promise.resolve(); };
  controller.retryWithAudio();
  await flush();
  assert.equal(calls, 2);
  assert.equal(videos[0].paused, false);
});
