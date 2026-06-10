import { defineConfig } from 'vitest/config';

// Without this file Vitest walks up and resolves the game's root vite.config,
// whose `test.include` points at the web tests — and finds nothing here.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    reporters: 'default',
  },
});
