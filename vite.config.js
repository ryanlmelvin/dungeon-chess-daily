import { defineConfig } from 'vite';
export default defineConfig({ base: './', server: { port: 4319, watch: { usePolling: true, interval: 300 } }, build: { chunkSizeWarningLimit: 650 } });
