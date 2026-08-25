import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: 'dist/client', sourcemap: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787', '/openapi.json': 'http://localhost:8787' },
  },
});
