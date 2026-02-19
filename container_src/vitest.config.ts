import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from parent directory (clarity_ai/.env)
config({ path: resolve(__dirname, '../.env') });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['dist/**'],
    },
    testTimeout: 60000, // 60s for real SDK integration tests
    hookTimeout: 10000,
    env: {
      NODE_ENV: 'test',
    },
  },
});
