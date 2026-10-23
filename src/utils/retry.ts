import { RateLimitError } from '../errors.js';

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 指数退避 + 抖动:base * 2^attempt,再叠加 0~50% 随机抖动(打散固定节奏,避开限流检测)。 */
export function backoffWithJitter(baseMs: number, attempt: number, capMs = 60_000): number {
  const exp = Math.min(baseMs * 2 ** attempt, capMs);
  return Math.floor(exp + Math.random() * baseMs * 0.5);
}

interface RetryOptions {
  /** 最大尝试次数(含首次)。 */
  attempts?: number;
  /** 基础退避(毫秒),按指数增长:base * 2^(n-1)。 */
  baseDelayMs?: number;
  /** 判断该错误是否值得重试;默认只重试限流。 */
  shouldRetry?: (error: unknown) => boolean;
  /** 每次重试前回调(用于日志)。 */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * 带指数退避的重试。默认仅对 {@link RateLimitError} 重试 —— 限流退避、其他错误立刻抛。
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 2000;
  const shouldRetry = options.shouldRetry ?? (error => error instanceof RateLimitError);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error)) throw error;
      const delayMs = backoffWithJitter(baseDelayMs, attempt - 1);
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastError;
}
