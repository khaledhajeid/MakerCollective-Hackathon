import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in dev too, so cookies/CSRF behave exactly like production behind Caddy.
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Fails loudly if a surface bloats; voter route budget is enforced in review (plan §2.2).
    chunkSizeWarningLimit: 200,
  },
});
