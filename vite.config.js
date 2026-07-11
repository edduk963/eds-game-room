import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

function getCommitHash() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT_HASH__: JSON.stringify(getCommitHash()),
  },
  server: {
    port: 5173,
    allowedHosts: true,
    // This project lives in a OneDrive folder, where native FS change events are
    // unreliable — Vite can keep serving stale modules after edits. Polling forces
    // the watcher to actually notice every save.
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      '/session': 'http://localhost:3001',
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
