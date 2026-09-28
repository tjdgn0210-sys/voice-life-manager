/** Reject SQLite's negative-LIMIT meaning (unbounded reads). Zero returns no rows. */
export function assertQueryLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError('Repository limit must be a non-negative safe integer.');
  }
}
