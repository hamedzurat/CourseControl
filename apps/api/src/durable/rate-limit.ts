/**
 * Simple token-bucket rate limiter (in-memory).
 * - capacity: max tokens
 * - refillPerSec: tokens added per second
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private capacity: number,
    private refillPerSec: number,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }

  take(tokens = 1): boolean {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  private refill() {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillMs) / 1000;
    if (elapsedSec <= 0) return;

    const refill = elapsedSec * this.refillPerSec;
    this.tokens = Math.min(this.capacity, this.tokens + refill);
    this.lastRefillMs = now;
  }
}
