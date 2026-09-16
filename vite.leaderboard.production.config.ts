import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Public assets are explicitly selected by build-leaderboard-pages.ts.
export default defineConfig({
  plugins: [react()],
  base: '/trace/leaderboard-static/',
  publicDir: false,
  define: { 'import.meta.env.VITE_TRACE_LEADERBOARD_BASE': JSON.stringify('/trace') },
  build: { outDir: 'dist-leaderboard', rollupOptions: { input: 'leaderboard.html' } },
});
