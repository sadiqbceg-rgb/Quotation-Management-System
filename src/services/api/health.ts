import { callAction } from './client';
import type { HealthResponse } from './actions';

/**
 * Backend liveness and configuration check.
 *
 * The only action wired in Phase 01. It reports whether every required Script
 * Property is present, without ever revealing a value (§14 Validation).
 */
export async function checkHealth(): Promise<HealthResponse> {
  return callAction<Record<string, never>, HealthResponse>('health', {}, { timeoutMs: 15_000 });
}
