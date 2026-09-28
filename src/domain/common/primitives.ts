/** Stable UUID-style identifier. Format validation belongs at the input boundary. */
export type EntityId = string;
/** Absolute UTC ISO 8601 timestamp, serialized with a Z suffix; never local wall time. */
export type ISODateTime = string;
/** ISO currency code. Default to KRW when creating a transaction; allow future codes. */
export type CurrencyCode = string;
export type InputMethod = 'MANUAL' | 'VOICE' | 'TEXT';
/** IANA timezone identifier, retained separately from UTC timestamps. */
export type Timezone = string;
