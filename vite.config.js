import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  publicDir: 'public',
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
