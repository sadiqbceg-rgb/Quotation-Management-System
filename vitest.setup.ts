import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * A test endpoint so `getEnv()` resolves during component and service tests.
 * This is configuration, not data, and never reaches a build.
 */
vi.stubEnv('VITE_GAS_ENDPOINT', 'https://script.google.com/macros/s/test-only/exec');
vi.stubEnv('VITE_APP_ENV', 'development');

afterEach(() => {
  cleanup();
});
