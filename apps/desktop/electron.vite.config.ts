import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    // @gather/core is TypeScript source in this workspace, so bundle it into
    // the main process instead of asking Node to resolve its .ts entry.
    plugins: [externalizeDepsPlugin({ exclude: ['@gather/core'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'workspace-search-worker': resolve(__dirname, 'src/main/workspace-search-worker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
  },
});
