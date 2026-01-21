import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  },
  server: {
    proxy: {
      '/upload': 'http://localhost:3000',
      '/status': 'http://localhost:3000',
      '/download': 'http://localhost:3000',
      '/zip': 'http://localhost:3000'
    }
  }
});