import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: {
    alias: {
      'doom-headless-engine': resolve(
        existsSync('public/engines/doom/verify.js')
          ? 'public/engines/doom/verify.js'
          : 'src/server/platform/doom-unavailable.ts',
      ),
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
