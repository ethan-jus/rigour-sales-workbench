import { defineConfig } from 'vitest/config';
import { createViteConfig } from './vite.config';

export default defineConfig(({ mode }) => ({
  ...createViteConfig(mode),
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
}));
