import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = new URL('../public/vendor/', import.meta.url);
const resources = [
  ['aframe-1.5.0.min.js', 'https://aframe.io/releases/1.5.0/aframe.min.js'],
  ['mindar-image-1.2.5.prod.js', 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js'],
];
await mkdir(directory, { recursive: true });
let previous = [];
try { previous = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const manifest = [];
for (const [filename, url] of resources) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const contents = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(contents).digest('hex');
  const expected = previous.find((entry) => entry.filename === filename)?.sha256;
  if (expected && expected !== sha256) throw new Error(`Checksum changed for ${filename}; review the upstream distribution before updating`);
  await writeFile(new URL(filename, directory), contents);
  manifest.push({ filename, url, bytes: contents.length, sha256 });
  console.log(`${filename}: ${contents.length} bytes, SHA-256 ${sha256}`);
}
await writeFile(new URL('manifest.json', directory), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Distributions saved in ${fileURLToPath(directory)}; original license headers retained.`);
