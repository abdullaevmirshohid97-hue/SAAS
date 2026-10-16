import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 5174, host: true },
  // Sourcemap faqat so'ralganda (CLARY_SOURCEMAP=1) — web-clinic'dagi OOM sababi.
  build: { sourcemap: process.env.CLARY_SOURCEMAP === '1', target: 'es2022' },
});
