// Metadata-only MP4 inspection when ffprobe is unavailable. Never reads mdat.
import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function audioCodec(buffer, sample) {
  if (sample.type !== 'mp4a') return sample.type;
  const esds = boxes(buffer, sample.data + 28, sample.end).find((box) => box.type === 'esds');
  let objectType;
  let audioObjectType;
  function descriptors(start, end) {
    while (start < end) {
      const tag = buffer[start++];
      let length = 0;
      let next;
      let count = 0;
      do {
        next = buffer[start++];
        length = length * 128 + (next & 127);
        if (++count > 4) throw new Error('Invalid ES descriptor');
      } while (next & 128);
      const last = start + length;
      if (last > end) throw new Error('Invalid ES descriptor length');
      if (tag === 3) {
        const flags = buffer[start + 2];
        let nested = start + 3;
        if (flags & 128) nested += 2;
        if (flags & 64) nested += 1 + buffer[nested];
        if (flags & 32) nested += 2;
        descriptors(nested, last);
      } else if (tag === 4) {
        objectType = buffer[start];
        descriptors(start + 13, last);
      } else if (tag === 5) audioObjectType = buffer[start] >> 3;
      start = last;
    }
  }
  if (esds) descriptors(esds.data + 4, esds.end);
  return objectType === 0x40 ? ({ 2: 'AAC LC', 5: 'HE-AAC', 29: 'HE-AAC v2' }[audioObjectType] ?? `MPEG-4 audio object type ${audioObjectType}`) : 'mp4a (profile unverified)';
}

function boxes(buffer, start = 0, end = buffer.length) {
  const result = [];
  while (start + 8 <= end) {
    let size = buffer.readUInt32BE(start);
    const type = buffer.toString('ascii', start + 4, start + 8);
    let header = 8;
    if (size === 1) { size = Number(buffer.readBigUInt64BE(start + 8)); header = 16; }
    if (size === 0) size = end - start;
    if (size < header || start + size > end) throw new Error(`Invalid ${type} box`);
    result.push({ type, data: start + header, end: start + size });
    start += size;
  }
  return result;
}
function child(buffer, parent, type) {
  return boxes(buffer, parent.data, parent.end).find((box) => box.type === type);
}
function trackMetadata(buffer, track) {
  const mdia = child(buffer, track, 'mdia');
  const mdhd = child(buffer, mdia, 'mdhd');
  const hdlr = child(buffer, mdia, 'hdlr');
  const kind = buffer.toString('ascii', hdlr.data + 8, hdlr.data + 12);
  const version = buffer[mdhd.data];
  const timescale = buffer.readUInt32BE(mdhd.data + (version ? 20 : 12));
  const ticks = version ? Number(buffer.readBigUInt64BE(mdhd.data + 24)) : buffer.readUInt32BE(mdhd.data + 16);
  const durationSeconds = ticks / timescale;
  const stbl = child(buffer, child(buffer, mdia, 'minf'), 'stbl');
  const stsd = child(buffer, stbl, 'stsd');
  const samples = boxes(buffer, stsd.data + 8, stsd.end);
  const sample = samples[0];
  const stsz = child(buffer, stbl, 'stsz');
  const sampleCount = stsz ? buffer.readUInt32BE(stsz.data + 8) : null;
  let bytes = stsz ? buffer.readUInt32BE(stsz.data + 4) * sampleCount : null;
  if (stsz && bytes === 0) {
    for (let i = 0; i < sampleCount; i++) bytes += buffer.readUInt32BE(stsz.data + 12 + i * 4);
  }
  const result = { kind, sampleEntry: sample?.type, durationSeconds: +durationSeconds.toFixed(3), sampleCount, bitrateKbps: bytes === null ? null : +(bytes * 8 / durationSeconds / 1000).toFixed(1) };
  if (kind === 'vide') {
    result.codec = { avc1: 'H.264', avc3: 'H.264', hvc1: 'HEVC', hev1: 'HEVC', av01: 'AV1' }[sample.type] ?? sample.type;
    result.width = buffer.readUInt16BE(sample.data + 24);
    result.height = buffer.readUInt16BE(sample.data + 26);
    const stts = child(buffer, stbl, 'stts');
    let count = 0;
    let duration = 0;
    if (stts) {
      for (let offset = stts.data + 8; offset + 8 <= stts.end; offset += 8) {
        const n = buffer.readUInt32BE(offset);
        count += n;
        duration += n * buffer.readUInt32BE(offset + 4);
      }
    }
    result.averageFps = duration ? +(count * timescale / duration).toFixed(3) : null;
  }
  if (kind === 'soun') {
    result.codec = audioCodec(buffer, sample);
    result.channels = buffer.readUInt16BE(sample.data + 16);
    result.sampleRateHz = buffer.readUInt32BE(sample.data + 24) / 65536;
    result.nonEmptyAudioTrack = sampleCount > 0 && bytes > 0;
  }
  return result;
}
export async function inspect(filename) {
  const url = new URL(`../public/${filename}`, import.meta.url);
  const file = await open(url, 'r');
  try {
    const { size } = await file.stat();
    const top = [];
    let position = 0;
    let moov;
    while (position + 8 <= size) {
      const header = Buffer.alloc(16);
      await file.read(header, 0, Math.min(16, size - position), position);
      let length = header.readUInt32BE(0);
      const type = header.toString('ascii', 4, 8);
      const headerSize = length === 1 ? 16 : 8;
      if (length === 1) length = Number(header.readBigUInt64BE(8));
      if (length === 0) length = size - position;
      if (length < headerSize || position + length > size) throw new Error(`Invalid ${type} in ${filename}`);
      top.push({ type, position, bytes: length });
      if (type === 'moov') {
        if (length > 64 * 1024 * 1024) throw new Error('moov metadata exceeds 64 MiB');
        moov = Buffer.alloc(length - headerSize);
        const { bytesRead } = await file.read(moov, 0, moov.length, position + headerSize);
        if (bytesRead !== moov.length) throw new Error('Incomplete moov metadata');
      }
      position += length;
    }
    if (!moov) throw new Error(`No moov box in ${filename}`);
    const tracks = boxes(moov).filter((box) => box.type === 'trak').map((box) => trackMetadata(moov, box));
    const fragmented = top.some((box) => box.type === 'moof');
    const durationSeconds = fragmented ? null : Math.max(...tracks.map((track) => track.durationSeconds));
    if (fragmented) {
      tracks.forEach((track) => {
        track.durationSeconds = null;
        track.sampleCount = null;
        track.bitrateKbps = null;
        if (track.kind === 'soun') track.nonEmptyAudioTrack = null;
      });
    }
    return { filename, bytes: size, mebibytes: +(size / 1024 / 1024).toFixed(2), fragmented, durationSeconds, totalBitrateKbps: durationSeconds ? +(size * 8 / durationSeconds / 1000).toFixed(1) : null, faststart: top.findIndex((box) => box.type === 'moov') < top.findIndex((box) => box.type === 'mdat'), tracks, ...(fragmented ? { limitation: 'Fragment sample metadata is not inspected; duration/audio validation require ffprobe. This file is unused by the app.' } : {}) };
  } finally { await file.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const videos = [];
  for (const name of ['el_peaton1.mp4', 'el_peaton2.mp4', 'el_peaton3.mp4', 'el_peaton.mp4']) {
    const metadata = await inspect(name);
    videos.push(metadata);
    console.log(JSON.stringify(metadata, null, 2));
  }
  for (let index = 1; index <= 3; index++) {
    for (const suffix of ['720p', 'fade-2s']) {
      try { videos.push(await inspect(`media/el_peaton${index}-${suffix}.mp4`)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  const resources = [];
  for (const filename of ['marcadores.mind', 'marcador1.png', 'marcador2.png', 'marcador3.png']) {
    resources.push({ filename, bytes: (await stat(new URL(`../public/${filename}`, import.meta.url))).size });
  }
  const report = { method: 'MP4 container metadata only; this audit does not decode or convert media', videos, resources, pending: ['ffprobe codec profile/pixel format verification', 'Audible/synchronized playback on phones', '720p conversion quality and actual startup benchmarks'] };
  await mkdir(new URL('../docs/', import.meta.url), { recursive: true });
  await writeFile(new URL('../docs/media-report.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  console.log('Metadata report: docs/media-report.json');
}
