import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 상대 경로로 빌드해서 GitHub Pages 같은 하위 경로에서도 열리게 한다.
  base: './',
  build: {
    // 실제 앱(index.html)과 검증실(lab.html)을 따로 빌드한다
    rollupOptions: { input: { main: 'index.html', lab: 'lab.html' } },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
