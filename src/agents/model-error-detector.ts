// src/agents/model-error-detector.ts
/**
 * Model Error Detector
 *
 * Determines whether an error from a model API call is eligible for
 * automatic fallback to another model.
 *
 * Fallback-eligible errors:
 * - HTTP 429 (rate limit / quota)
 * - HTTP 500/502/503/504 (server errors)
 * - Network timeouts and connection failures
 *
 * NOT eligible:
 * - HTTP 401/403 (auth errors)
 * - HTTP 404 (model not found)
 */

export function isFallbackableError(error: unknown): boolean {
  if (!error) return false;

  // Prefer structured status code (more reliable, avoids false positives)
  const status = (error as any)?.status ??
                 (error as any)?.statusCode ??
                 (error as any)?.response?.status;

  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  // Fallback: string matching for network-level errors without a status code
  // Note: Bare numeric strings like '500' are intentionally excluded to avoid
  // matching user message content (e.g., "error 500", "500 dollars")
  // But "API Error: 429" style messages are explicit API errors
  const msg = String(error).toLowerCase();

  // API Error with status code pattern (e.g., "API Error: 429", "API Error: 503")
  if (/api error:\s*[45]\d{2}/.test(msg)) {
    return true;
  }

  // Rate limit / quota
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('quota exceeded')) {
    return true;
  }

  // Service state
  if (msg.includes('service unavailable') || msg.includes('overloaded') || msg.includes('over capacity')) {
    return true;
  }

  // Timeouts / network
  if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('gateway')) {
    return true;
  }

  return false;
}