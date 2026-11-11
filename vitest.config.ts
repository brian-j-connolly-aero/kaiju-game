import { defineConfig } from 'vitest/config';

// One test run for the whole repo (`npm test`). Each workspace keeps its tests in `test/`.
// Tests run in plain Node; a client test that needs a DOM should say so with a
// `// @vitest-environment` comment at the top of the file rather than changing this default.
export default defineConfig({
  test: {
    include: ['shared/test/**/*.test.ts', 'server/test/**/*.test.ts', 'client/test/**/*.test.ts'],
    environment: 'node',
    // Full bot-versus-bot matches run in tests; give them room on a busy 4-core machine.
    testTimeout: 30_000,
    passWithNoTests: false,
  },
});
