import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': fileURLToPath(new URL('./src/renderer', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
});
