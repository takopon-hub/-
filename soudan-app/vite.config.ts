import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 開発時は dev/api-shim.mjs(ローカルPostgres上のPostgREST相当)に /rest/v1 を転送する。
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/rest/v1': 'http://localhost:54321' } },
  test: { include: ['src/**/*.test.ts'] },
});
