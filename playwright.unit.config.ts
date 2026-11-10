import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch:
    /(validation|reader-geometry|storage-modular|image-lifecycle|concurrency-diagnostics|image-pipeline)\.spec\.ts/,
});
