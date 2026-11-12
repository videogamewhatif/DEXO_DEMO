import { ProviderError } from "@/lib/integrations/errors";

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Esperas mayores no se hacen en línea: el trabajo se reprograma (run_after). */
  maxInlineWaitMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 60_000, maxInlineWaitMs: 60_000 };

/** Espera exponencial con variación aleatoria ("equal jitter"). */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number, rand: () => number = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(exp / 2 + rand() * (exp / 2));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  sleep: (ms: number) => Promise<void>,
  onRetry?: (info: { attempt: number; waitMs: number; error: ProviderError }) => void,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ProviderError) || !err.retryable || attempt >= policy.maxRetries) throw err;
      const wait = err.details.retryAfterMs ?? backoffDelay(attempt, policy.baseDelayMs, policy.maxDelayMs);
      if (wait > policy.maxInlineWaitMs) throw err;
      onRetry?.({ attempt, waitMs: wait, error: err });
      await sleep(wait);
    }
  }
}

/** Retraso para reprogramar un trabajo tras un error reintentable. */
export function rescheduleDelayMs(err: ProviderError, jobAttempts: number, rand: () => number = Math.random): number {
  if (err.details.retryAfterMs !== undefined) return Math.min(err.details.retryAfterMs, 6 * 60 * 60_000);
  return backoffDelay(jobAttempts, 60_000, 60 * 60_000, rand);
}
