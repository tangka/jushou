import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// dashboard 挂在 Hono 的 /dashboard 子路径下,故 base=/dashboard/;build 产物落 web/dist,由 Hono serveStatic。
// dev 时(pnpm dev)把 /api 代理到本地 Hono(默认 3333),便于热更新调试。
export default defineConfig({
  plugins: [react()],
  base: '/dashboard/',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:3333' } },
});
