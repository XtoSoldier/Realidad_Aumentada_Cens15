import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function loadTlsOptions({ env = process.env, rootDir = projectRoot } = {}) {
  const root = path.resolve(rootDir);
  const forbidden = [path.join(root, 'dist'), path.join(root, 'public')];
  const resolvedForbidden = await Promise.all(forbidden.map(async (directory) => {
    try {
      return await realpath(directory);
    } catch (error) {
      if (error.code === 'ENOENT') return directory;
      throw error;
    }
  }));

  async function load(name, fallback) {
    const filename = path.resolve(root, env[name] ?? fallback);
    if (!env[name] && env[name] !== undefined) throw new Error(`${name} must not be empty`);
    if (forbidden.some((directory) => isWithin(directory, filename))) {
      throw new Error(`${name} must be outside dist/public`);
    }
    try {
      const resolved = await realpath(filename);
      if ([...forbidden, ...resolvedForbidden].some((directory) => isWithin(directory, resolved))) {
        throw new Error(`${name} must be outside dist/public`);
      }
      if (isWithin(await realpath(root), resolved)) throw new Error(`${name} must be outside the project/repository`);
      return await readFile(resolved);
    } catch (error) {
      throw new Error(`Cannot load ${name}: ${error.message}`, { cause: error });
    }
  }

  const [cert, key] = await Promise.all([
    load('TLS_CERT', '../el-peaton-certs/cert.pem'),
    load('TLS_KEY', '../el-peaton-certs/key.pem'),
  ]);
  return { cert, key, minVersion: 'TLSv1.2' };
}
