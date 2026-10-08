import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { inspect } from './media.mjs';

const executable = process.env.FFMPEG ?? ffmpeg.path;
const verifyOnly = process.argv.includes('--verify');
const fadeSeconds = 2;
function run(args) {
  const result = spawnSync(executable, ['-hide_banner', '-loglevel', 'error', ...args], { timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr.toString());
  return result.stdout;
}
async function fileHash(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
function rms(filename, start, seconds = 0.2) {
  const pcm = run(['-i', filename, '-ss', String(start), '-t', String(seconds), '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 's16le', '-']);
  assert.ok(pcm.length > 0, 'Audio must decode to nonempty PCM');
  let energy = 0;
  for (let offset = 0; offset + 2 <= pcm.length; offset += 2) energy += (pcm.readInt16LE(offset) / 32768) ** 2;
  return Math.sqrt(energy / (pcm.length / 2));
}
const report = [];
await mkdir(new URL('../public/media/', import.meta.url), { recursive: true });
for (let index = 1; index <= 3; index++) {
  const original = `el_peaton${index}.mp4`;
  const optimized = `media/el_peaton${index}-720p.mp4`;
  const sourceName = existsSync(new URL(`../public/${optimized}`, import.meta.url)) ? optimized : original;
  const source = fileURLToPath(new URL(`../public/${sourceName}`, import.meta.url));
  const outputName = `media/el_peaton${index}-fade-2s.mp4`;
  const output = fileURLToPath(new URL(`../public/${outputName}`, import.meta.url));
  const temporaryName = `${outputName}.partial.mp4`;
  const temporary = `${output}.partial.mp4`;
  const input = await inspect(sourceName);
  assert.ok(Number.isFinite(input.durationSeconds) && input.durationSeconds > fadeSeconds, 'A known duration longer than the fade is required');
  assert.ok(input.tracks.some((track) => track.kind === 'soun' && track.nonEmptyAudioTrack), 'Original audio track is required');
  const hashBefore = await fileHash(source);
  const fadeStart = +(input.durationSeconds - fadeSeconds).toFixed(3);
  try {
    if (!verifyOnly) {
      console.log(`Scene ${index}: fading final ${fadeSeconds}s from ${fadeStart}s, copying video without re-encoding.`);
      run(['-y', '-i', source, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy',
        '-af', `afade=t=out:st=${fadeStart}:d=${fadeSeconds}:curve=tri`,
        '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', temporary]);
    }
    const checkedFile = verifyOnly ? output : temporary;
    const checked = await inspect(verifyOnly ? outputName : temporaryName);
    const originalVideoHash = run(['-i', source, '-map', '0:v:0', '-c:v', 'copy', '-f', 'hash', '-hash', 'sha256', '-']).toString().trim();
    const fadedVideoHash = run(['-i', checkedFile, '-map', '0:v:0', '-c:v', 'copy', '-f', 'hash', '-hash', 'sha256', '-']).toString().trim();
    assert.equal(fadedVideoHash, originalVideoHash, 'The compressed video stream must be unchanged');
    assert.ok(Math.abs(input.durationSeconds - checked.durationSeconds) < 0.05, 'Mux duration must be preserved within audio packet rounding');
    assert.ok(checked.faststart, 'Output must have faststart');
    // Compare like-for-like decoded windows, not loudness of different words/music.
    const audioWindows = [0.25, 0.9, 1.7].map((elapsed) => {
      const start = fadeStart + elapsed;
      const originalRms = rms(source, start);
      const fadedRms = rms(checkedFile, start);
      return { startSeconds: +start.toFixed(3), originalRms, fadedRms, gainRatio: originalRms > 1e-6 ? fadedRms / originalRms : null };
    });
    const last = audioWindows.at(-1);
    assert.ok(last.gainRatio === null || last.gainRatio < 0.3, 'Final audio window must be substantially attenuated');
    const gains = audioWindows.map((window) => window.gainRatio).filter((gain) => gain !== null);
    assert.ok(gains.every((gain, position) => position === 0 || gain < gains[position - 1]), 'Measured gain must decrease through the fade');
    assert.equal(await fileHash(source), hashBefore, 'Source file must remain untouched');
    if (!verifyOnly) await rename(temporary, output);
    report.push({ scene: index, source: sourceName, output: outputName, fadeSeconds, fadeStartSeconds: fadeStart,
      sourceSha256: hashBefore, compressedVideoUnchanged: true, sourceBytes: input.bytes, outputBytes: checked.bytes,
      sourceDurationSeconds: input.durationSeconds, outputDurationSeconds: checked.durationSeconds,
      faststart: checked.faststart, audioWindows });
    console.log(`Scene ${index}: verified unchanged picture, decoded audio, end attenuation and faststart.`);
  } catch (error) {
    if (!verifyOnly) await rm(temporary, { force: true });
    throw error;
  }
}
await mkdir(new URL('../docs/', import.meta.url), { recursive: true });
await writeFile(new URL('../docs/fade-report.json', import.meta.url), `${JSON.stringify({ fadeSeconds, method: 'Embedded AAC fade; compressed video stream copied; PCM windows compared with source', scenes: report }, null, 2)}\n`);
console.log('Fade verified in all three scenes. Report: docs/fade-report.json');
