/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    open: false,
  },
  test: {
    testTimeout: 900_000,
    hookTimeout: 120_000,
    pool: 'threads',
  },
});
