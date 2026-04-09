import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared/types.ts'),
    },
  },
  server: {
    port: 5173,
    /** Lets phones / other PCs on your Wi‑Fi open http://YOUR_IP:5173 (not just localhost). */
    host: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
    fs: {
      allow: ['..'],
    },
  },
});
