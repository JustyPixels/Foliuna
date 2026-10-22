import { defineConfig } from '@playwright/test';
// Resolve the pinned runtime before per-test deadlines, including Electron's cold-cache download.
import 'electron';

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 30000,
  use: { trace: 'retain-on-failure' },
});
