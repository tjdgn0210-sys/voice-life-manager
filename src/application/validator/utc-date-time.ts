import type { ISODateTime } from '../../domain/common/primitives';

/** UTC ISO timestamps with seconds and optional millisecond precision. No local-time guessing. */
export function isUtcDateTime(value: unknown): value is ISODateTime {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
  return new Date(milliseconds).toISOString() === canonical;
}
