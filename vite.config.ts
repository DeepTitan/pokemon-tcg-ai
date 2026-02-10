import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/ui',
  },
  server: {
    port: 3000,
  },
  resolve: {
    // Allow .js imports to resolve to .ts files (Node16 moduleResolution compat)
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
});
