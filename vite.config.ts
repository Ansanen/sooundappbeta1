import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // Worker configuration for Web Workers and AudioWorklets
    worker: {
      format: 'es',
      plugins: () => [react()],
    },
    // Optimizations
    optimizeDeps: {
      exclude: ['@aspect/wtransport'],
    },
    build: {
      target: 'esnext',
      rollupOptions: {
        output: {
          // Ensure WASM files are properly handled
          assetFileNames: (assetInfo) => {
            if (assetInfo.name?.endsWith('.wasm')) {
              return 'assets/wasm/[name][extname]';
            }
            return 'assets/[name]-[hash][extname]';
          },
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      headers: {
        // For local dev: Cross-Origin Isolation headers
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
    },
  };
});
