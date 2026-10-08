import { defineConfig } from "vite";
import { loadTlsOptions } from "./scripts/tls.mjs";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "./scripts/tls.mjs";

// Keep originals in public, but distribute only the three scene files in use.
function activityResources() {
  const sources = () => Array.from({ length: 3 }, (_, index) => {
    const original = `el_peaton${index + 1}.mp4`;
    const optimized = `media/el_peaton${index + 1}-720p.mp4`;
    const faded = `media/el_peaton${index + 1}-fade-2s.mp4`;
    const selected = [faded, optimized, original].find((filename) => existsSync(path.join(projectRoot, "public", filename)));
    return { original, selected };
  });
  return {
    name: "activity-resources",
    transformIndexHtml(html) {
      for (const { original, selected } of sources()) html = html.replace(`data-src="/${original}"`, `data-src="/${selected}"`);
      return html;
    },
    async closeBundle() {
      const resources = ["marcadores.mind", "marcador1.png", "marcador2.png", "marcador3.png", ...sources().map(({ selected }) => selected)];
      for (const filename of await readdir(path.join(projectRoot, "public/vendor"))) resources.push(`vendor/${filename}`);
      for (const filename of resources) {
        const destination = path.join(projectRoot, "dist", filename);
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(path.join(projectRoot, "public", filename), destination);
      }
    },
  };
}

export default defineConfig(async ({ command }) => {
  // El build no necesita certificados; los servidores dev y preview si.
  if (command === "build") {
    return { build: { copyPublicDir: false }, plugins: [activityResources()] };
  }

  const serverOptions = {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    https: await loadTlsOptions(),
  };

  return {
    plugins: [{ ...activityResources(), closeBundle: undefined }],
    server: serverOptions,
    preview: serverOptions,
  };
});
