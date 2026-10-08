import { spawnSync } from 'node:child_process';
import { mkdir, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

const executable = process.env.FFMPEG ?? ffmpeg.path;
const available = spawnSync(executable, ['-version'], { encoding: 'utf8', timeout: 10000 });
if (available.error || available.status !== 0) {
  console.error('FFmpeg is unavailable. No videos changed. Install FFmpeg or set FFMPEG to its executable; see README conversion commands.');
  process.exitCode = 1;
} else {
  await mkdir(new URL('../public/media/', import.meta.url), { recursive: true });
  for (let index = 1; index <= 3; index++) {
    const source = fileURLToPath(new URL(`../public/el_peaton${index}.mp4`, import.meta.url));
    const output = fileURLToPath(new URL(`../public/media/el_peaton${index}-720p.mp4`, import.meta.url));
    const temporary = `${output}.partial.mp4`;
    const args = ['-y', '-i', source, '-map', '0:v:0', '-map', '0:a:0',
      '-vf', "scale=w='trunc(iw*min(1,min(1280/iw,1280/ih))/2)*2':h='trunc(ih*min(1,min(1280/iw,1280/ih))/2)*2',fps=30",
      '-c:v', 'libx264', '-preset', 'medium', '-b:v', '1200k', '-maxrate', '1800k', '-bufsize', '3600k',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', temporary];
    console.log(`Converting scene ${index}; original audio mapped, original file untouched.`);
    const result = spawnSync(executable, args, { stdio: 'inherit', timeout: 300000 });
    if (result.error || result.status !== 0) {
      await rm(temporary, { force: true });
      throw new Error(`Scene ${index} conversion failed: ${result.error?.message ?? result.status}`);
    }
    await rename(temporary, output);
  }
  console.log('Copies generated. Run pnpm media:audit and pnpm build; Vite selects existing 720p copies. Validate quality/audio on phones.');
}
